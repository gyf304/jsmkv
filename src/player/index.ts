import * as ebml from "../ebml/index.js";
import { BlobLike, FetchBlobLike } from "../bloblike/index.js";
import { File } from "../matroska/index.js";
import * as mkve from "../matroska/elements/index.js";

import * as m from "./box";

const supportedVideoCodecs = [
	"V_MPEG4/ISO/AVC",
	"V_MPEGH/ISO/HEVC",
] as const;
const supportedAudioCodecs = ["A_AAC"] as const;

interface SeekCluster {
	time: number; // in seconds
	clusterPosition: number;
}

interface Options {
	maxBufferSeconds?: number;
}

interface Track {
	type: "video" | "audio";
	mimeCodec: string;
	mkvTrackNumber: number;
	mp4TrackId: number;
	trak: m.ArrayBuilder;
	contentEncodings?: mkve.ContentEncodings;
}

function bitReverse32(n: number) {
	n = ((n & 0x55555555) << 1) | ((n & 0xAAAAAAAA) >>> 1);
	n = ((n & 0x33333333) << 2) | ((n & 0xCCCCCCCC) >>> 2);
	n = ((n & 0x0F0F0F0F) << 4) | ((n & 0xF0F0F0F0) >>> 4);
	n = ((n & 0x00FF00FF) << 8) | ((n & 0xFF00FF00) >>> 8);
	n = ((n & 0x0000FFFF) << 16) | ((n & 0xFFFF0000) >>> 16);
	return n >>> 0;
}

function hexString(buffer: ArrayBuffer) {
	return Array
		.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("").toUpperCase();
}

function hevcMimeCodec(cpd: ArrayBuffer) {
	// see: https://www.w3.org/TR/webcodecs-hevc-codec-registration/
	// HEVCDecoderConfigurationRecord in ISO/IEC 14496-15 (8.3.3.1.2)
	const v = new DataView(cpd);
	// gp = general profile
	const gpSpace = ["", "A", "B", "C"][(v.getUint8(1) >> 6) & 0b11];
	const gpTierFlag = ["L", "H"][(v.getUint8(1) >> 5) & 1];
	const gpIDC = v.getUint8(1) & 0x1F;
	const gpCompatibility = bitReverse32(v.getUint32(2));
	const gpLevelIdc = v.getUint8(12);
	const gpConstraintFlags = hexString(cpd.slice(6, 12)).replace(/(00)*$/, "");
	return `hvc1.${gpSpace}${gpIDC}.${gpCompatibility}.${gpTierFlag}${gpLevelIdc}.${gpConstraintFlags}`;
}

async function *withNextAsync<T>(iterable: AsyncIterable<T>): AsyncIterable<[T, T | undefined]> {
	let prev: T | undefined;
	for await (const value of iterable) {
		if (prev !== undefined) {
			yield [prev, value];
		}
		prev = value;
	}
	if (prev !== undefined) {
		yield [prev, undefined];
	}
}

export class MKVToMP4Muxer {
	private initPromise: Promise<void> | undefined;
	private initializationSegment: ArrayBuffer | undefined;

	private duration: number | undefined;
	private mkvDuration: number | undefined;
	private mkvSegment: mkve.Segment | undefined;
	private mimeType: string | undefined;
	private seeks: SeekCluster[] | undefined;

	private mkvTracks: Map<number, Track> = new Map();

	constructor(private readonly source: BlobLike) {}

	public async getInitiationSegment(): Promise<ArrayBuffer> {
		await this.init();
		return this.initializationSegment!;
	}

	public async getMimeType(): Promise<string> {
		await this.init();
		return this.mimeType!;
	}

	public async getDuration(): Promise<number> {
		await this.init();
		return this.duration!;
	}

	public async readCluster(cluster: mkve.Cluster) {
		const blocks: mkve.SimpleBlock[] = [];
		for await (const block of cluster.simpleBlocks) {
			blocks.push(block);
		}
		const blocksByTrack: Map<number, mkve.SimpleBlock[]> = new Map();
		for (const block of blocks) {
			const trackNumber = await block.trackNumber;
			let blocks = blocksByTrack.get(trackNumber);
			if (blocks === undefined) {
				blocks = [];
				blocksByTrack.set(trackNumber, blocks);
			}
			blocks.push(block);
		}
		return blocksByTrack;
	}

	public async *streamFrom(timeInSeconds: number): AsyncIterable<ArrayBuffer> {
		await this.init();
		const segment = this.mkvSegment!;
		const duration = this.mkvDuration!;

		const seeks = this.seeks!;
		let seekIndex = seeks.findIndex((seek) => seek.time >= timeInSeconds) ?? seeks.length;
		seekIndex = Math.max(0, seekIndex - 1);
		const seek = seeks[seekIndex];
		const clusters = segment.seekClusters(seek.clusterPosition);

		let sequenceNumber = seekIndex;
		for await (const [cluster, nextCluster] of withNextAsync(clusters)) {
			sequenceNumber++;

			const clusterTimestamp = await cluster.timestamp;
			const nextClusterTimestamp = await nextCluster?.timestamp ?? duration;
			const clusterDuration = Math.max(0, nextClusterTimestamp - clusterTimestamp);

			const blocksByTrack = await this.readCluster(cluster);
			const blocksFirstTimestamps = new Map<number, number>();
			for (const [trackNumber, blocks] of blocksByTrack) {
				const firstTimestamp = await blocks[0].timestamp;
				blocksFirstTimestamps.set(trackNumber, firstTimestamp);
			}

			const nextBlocksByTrack = nextCluster === undefined ? undefined : await this.readCluster(nextCluster);
			const nextBlocksFirstTimestamps = new Map<number, number>();
			if (nextBlocksByTrack !== undefined) {
				for (const [trackNumber, blocks] of nextBlocksByTrack) {
					const firstTimestamp = await blocks[0].timestamp;
					nextBlocksFirstTimestamps.set(trackNumber, firstTimestamp);
				}
			}

			const trackNumbers = Array.from(this.mkvTracks.keys());

			const trackData: {
				trackNumber: number;
				traf: (offset: number) => m.ArrayBuilder,
				data: m.ArrayBuilder,
			}[] = [];
			for (const trackNumber of trackNumbers) {
				const track = this.mkvTracks.get(trackNumber)!;
				const mp4TrackId = track.mp4TrackId;

				const blocks = blocksByTrack.get(trackNumber) ?? [];
				const samples: m.TRUN["samples"] = [];
				const dataParts: m.ArrayBuilderPart[] = [];

				const ptses: number[] = [];
				for (let i = 0; i < blocks.length; i++) {
					const block = blocks[i];
					const pts = await block.timestamp;
					ptses.push(pts);
				}
				const nextPts = clusterDuration + (nextBlocksFirstTimestamps.get(trackNumber) ?? 0);
				ptses.push(nextPts);

				// make DTS monotonic
				let dtses = ptses.slice();
				let max = 0;
				for (let i = 1; i < dtses.length; i++) {
					if (dtses[i] < dtses[i-1]) {
						max = Math.max(max, dtses[i-1]);
						dtses[i] = max;
					}
				}

				const durations: number[] = [];
				for (let i = 0; i < blocks.length; i++) {
					durations.push(dtses[i+1] - dtses[i]);
				}

				for (let i = 0; i < blocks.length; i++) {
					const block = blocks[i];
					const pts = ptses[i]; // PTS: Presentation Time Stamp
					const dts = dtses[i]; // DTS: Decode Time Stamp
					const duration = durations[i];

					if (duration < 0) {
						console.log({ pts, dts, duration });
						throw new Error("Invalid duration");
					}

					const keyframe = await block.keyframe;
					let data = await block.data;
					if (track.contentEncodings !== undefined) {
						data = await track.contentEncodings.decode(data);
					}

					dataParts.push(new Uint8Array(data));
					samples.push({
						duration,
						size: data.byteLength,
						compositionTimeOffset: pts - dts,
						sampleFlags: {
							dependsOn: keyframe ? 2 : 1,
						},
					});
				}

				const traf = (offset: number) => m.traf(
					m.tfhd({
						trackId: mp4TrackId,
					}),
					m.tfdt({
						baseMediaDecodeTime: clusterTimestamp + (blocksFirstTimestamps.get(trackNumber) ?? 0),
					}),
					m.trun({
						dataOffset: offset,
						samples,
					}),
				);

				const data = m.ArrayBuilder.concat(...dataParts);
				trackData.push({ trackNumber, traf, data });
			}

			// we'll need to generate moof 2 times,
			// once for getting the size,
			// and once for the actual data
			const moofSize = m.moof(
				m.mfhd({ sequenceNumber }),
				...trackData.map(({ traf }) => traf(0)),
			).byteLength;

			const offsets = trackData.reduce(
				(acc, { data }) => [...acc, acc[acc.length-1] + data.byteLength],
				[moofSize + 8]
			);

			const moof = m.moof(
				m.mfhd({ sequenceNumber }),
				...trackData.map(({ traf }, i) => traf(offsets[i])),
			);

			const mdat = m.mdat(...trackData.map(({ data }) => data));

			yield m.ArrayBuilder.concat(moof, mdat).valueOf().buffer as ArrayBuffer;
		}
	}

	private init() {
		if (this.initPromise === undefined) {
			this.initPromise = this.initImpl();
		}
		return this.initPromise;
	}

	private async initImpl() {
		const stream = new ebml.Stream(this.source);
		const mkv = new File(stream);

		const segment = await mkv.one(mkve.Segment);
		this.mkvSegment = segment;

		const cues = await segment.getCues(true);
		if (cues === undefined) {
			throw new Error("Cues not found");
		}
		const info = await segment.info;
		const tracks = await segment.tracks;
		if (tracks === undefined) {
			throw new Error("Tracks not found");
		}
		const timestampScale = await info.timestampScale; // in ns
		const duration = await info.duration; // in timestampScale
		// console.log({ timestampScale, duration });
		const durationSeconds = duration * (timestampScale / 1e9);
		// console.log("Duration:", durationSeconds);
		this.mkvDuration = duration;
		this.duration = durationSeconds;

		let hasVideo = false;
		let hasAudio = false;

		// parse track data
		const convertedTracks: Track[] = [];

		for await (const track of tracks.tracks) {
			const trackType = await track.trackType;
			const codecID = await track.codecID;
			switch (trackType) {
				case "video": {
					if (hasVideo) {
						continue;
					}
					const video = await track.video;
					if (video === undefined) {
						throw new Error("Video not found");
					}
					if (!supportedVideoCodecs.includes(codecID as any)) {
						console.warn(`Unsupported video codec: ${codecID}, ignored`);
						continue;
					}
					const trackNumber = await track.trackNumber;
					const defaultDuration = await track.defaultDuration;
					if (defaultDuration === undefined) {
						throw new Error("DefaultDuration not found");
					}
					const width = await video.pixelWidth;
					const height = await video.pixelHeight;
					const codecPrivate = await track.maybeOne(mkve.CodecPrivate);
					if (codecPrivate === undefined) {
						throw new Error("CodecPrivate not found");
					}
					const codecPrivateData = await codecPrivate.element.data.arrayBuffer();
					convertedTracks.push({
						type: "video",
						mkvTrackNumber: trackNumber,
						mp4TrackId: convertedTracks.length + 1,
						mimeCodec:
							codecID === "V_MPEGH/ISO/HEVC" ?
							hevcMimeCodec(codecPrivateData) :
							`avc1.${hexString(codecPrivateData.slice(1, 4))}`,
						trak: m.trak(
							m.tkhd({
								trackId: trackNumber,
								width,
								height,
							}),
							m.mdia(
								m.mdhd({
									// 1e9 / timeScale = timestampScale
									timeScale: 1e9 / timestampScale,
									duration,
								}),
								m.hdlr({
									handlerType: "vide",
									handlerName: "VideoHandler",
								}),
								m.minf(
									m.vmhd({}),
									m.dinf(
										m.dref(
											m.url(),
										),
									),
									m.stbl(
										m.stsd(
											codecID === "V_MPEGH/ISO/HEVC" ? m.hev1(
												{ width, height },
												m.hvcc(new Uint8Array(codecPrivateData)),
											) : m.avc1(
												{ width, height },
												m.avcc(new Uint8Array(codecPrivateData)),
											),
										),
										m.stts(),
										m.stsc(),
										m.stsz(),
										m.stco(),
									),
								),
							)
						),
						contentEncodings: await track.maybeOne(mkve.ContentEncodings),
					});
					hasVideo = true;
					break;
				}
				case "audio": {
					if (hasAudio) {
						continue;
					}
					const audio = await track.audio;
					if (audio === undefined) {
						throw new Error("Audio not found");
					}
					if (!supportedAudioCodecs.includes(codecID as any)) {
						console.warn(`Unsupported audio codec: ${codecID}, ignored`);
						continue;
					}
					const trackNumber = await track.trackNumber;
					const channelCount = await audio.channels;
					const sampleRate = await audio.samplingFrequency;
					const sampleSize = await audio.bitDepth ?? 16;
					const codecPrivate = await track.maybeOne(mkve.CodecPrivate);
					if (codecPrivate === undefined) {
						throw new Error("CodecPrivate not found");
					}
					const codecPrivateData = await codecPrivate.element.data.arrayBuffer();

					convertedTracks.push({
						type: "audio",
						mkvTrackNumber: trackNumber,
						mp4TrackId: convertedTracks.length + 1,
						mimeCodec: "mp4a.40.2",
						trak: m.trak(
							m.tkhd({
								trackId: trackNumber,
							}),
							m.mdia(
								m.mdhd({
									timeScale: 1e9 / timestampScale,
									duration,
								}),
								m.hdlr({
									handlerType: "soun",
									handlerName: "SoundHandler",
								}),
								m.minf(
									m.smhd({}),
									m.dinf(
										m.dref(
											m.url(),
										),
									),
									m.stbl(
										m.stsd(
											m.mp4a(
												{ channelCount, sampleRate, sampleSize },
												m.esds({
													codecPrivate: new Uint8Array(codecPrivateData)
												}),
											),
										),
										m.stts(),
										m.stsc(),
										m.stsz(),
										m.stco(),
									),
								),
							)
						),
						contentEncodings: await track.maybeOne(mkve.ContentEncodings),
					});
					hasAudio = true;
					break;
				}
			}
		}

		const videoTrack = convertedTracks.find((track) => track.type === "video");
		const audioTrack = convertedTracks.find((track) => track.type === "audio");

		if (videoTrack === undefined) {
			throw new Error("Video track not found");
		}

		for (const track of convertedTracks) {
			this.mkvTracks.set(track.mkvTrackNumber, track);
		}

		let mimeCodecs: string[] = [];
		if (videoTrack !== undefined) {
			mimeCodecs.push(videoTrack.mimeCodec);
		}
		if (audioTrack !== undefined) {
			mimeCodecs.push(audioTrack.mimeCodec);
		}
		const mimeType = `video/mp4; codecs="${mimeCodecs.join(", ")}"`;
		this.mimeType = mimeType;

		// create index for seeking
		const seeks: SeekCluster[] = [];
		for await (const cuePoint of cues.cuePoints) {
			const time = await cuePoint.cueTime; // in timestampScale
			const timeSeconds = time * (timestampScale / 1e9);
			const trackPositions = await cuePoint.cueTrackPositions;
			for await (const trackPosition of trackPositions) {
				if (await trackPosition.cueTrack === videoTrack.mkvTrackNumber) {
					const clusterPosition = await trackPosition.cueClusterPosition;
					seeks.push({ time: timeSeconds, clusterPosition });
					break;
				}
			}
		}
		this.seeks = seeks;

		// initialize header
		const initializationSegment = m.ArrayBuilder.concat(
			m.ftyp({
				majorBrand: "isom",
				minorVersion: 0,
				compatibleBrands: ["isom", "iso2", "mp41", "mp42", ...(videoTrack.mimeCodec.startsWith("avc1") ? ["avc1"] : [])],
			}),
			m.moov(
				m.mvhd({
					timeScale: 1e9 / timestampScale,
					duration,
					nextTrackId: convertedTracks.length + 1,
				}),
				...convertedTracks.map((track) => track.trak),
				m.mvex(
					...convertedTracks.map((track) => m.trex({
						trackId: track.mp4TrackId,
						defaultSampleDescriptionIndex: 1,
					})),
				)
			),
		);

		this.initializationSegment = initializationSegment.valueOf().buffer as ArrayBuffer;
	}
}

class Signal<T> {
	private resolve: ((value: T) => void) | undefined;
	private reject: ((reason: any) => void) | undefined;

	constructor() {}

	public async wait(): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}

	public signal(value: T) {
		if (this.resolve === undefined) {
			throw new Error("Signal not waiting");
		}
		this.resolve(value);
	}

	public signalError(reason: any) {
		if (this.reject === undefined) {
			throw new Error("Signal not waiting");
		}
		this.reject(reason);
	}
}

export class MKVVideoPlayer {
	private destroyed = false;
	private destroySignal = new Signal<void>();

	constructor(private readonly source: BlobLike, private readonly video: HTMLVideoElement, private options?: Options) {
		this.init();
	}

	public async destroy() {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		await this.destroySignal.wait();
	}

	private async init() {
		// initialize muxer
		const muxer = new MKVToMP4Muxer(this.source);
		const mimeType = await muxer.getMimeType();
		console.log("MIME type:", mimeType);
		const durationSeconds = await muxer.getDuration();
		const initSegment = await muxer.getInitiationSegment();

		// initialize video element and media source
		const video = this.video;
		const mediaSource = new MediaSource();

		video.src = URL.createObjectURL(mediaSource);

		await new Promise<void>((resolve) => {
			const sourceopen = () => {
				mediaSource.removeEventListener("sourceopen", sourceopen);
				resolve();
			};
			mediaSource.addEventListener("sourceopen", sourceopen);
		});

		mediaSource.duration = durationSeconds;
		const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
		const waitForSourceBuffer = () => new Promise<void>((resolve) => {
			if (sourceBuffer.updating) {
				const updateend = () => {
					sourceBuffer.removeEventListener("updateend", updateend);
					resolve();
				};
				sourceBuffer.addEventListener("updateend", updateend);
			} else {
				resolve();
			}
		});
		sourceBuffer.mode = "segments";

		// initialize header
		sourceBuffer.appendBuffer(initSegment);
		await waitForSourceBuffer();

		const maxBufferSeconds = this.options?.maxBufferSeconds ?? 60;

		let seeked = true;
		const onSeeking = () => {
			seeked = true;
		};
		video.addEventListener("seeking", onSeeking);

		while (true) {
			seeked = false;

			const videoTime = video.currentTime;
			const stream = muxer.streamFrom(videoTime);

			for await (const chunk of stream) {
				if (seeked || this.destroyed) {
					break;
				}
				const timeRanges: [number, number][] = [];
				for (let i = 0; i < video.buffered.length; i++) {
					const start = video.buffered.start(i);
					const end = video.buffered.end(i);
					if (timeRanges.length > 0) {
						const last = timeRanges[timeRanges.length - 1];
						const threshold = 0.5;
						if (start - last[1] < threshold) {
							last[1] = end;
							continue;
						}
					}
					timeRanges.push([start, end]);
				}
				const currentTime = video.currentTime;
				const currentTimeRange = timeRanges.find(([start, end]) => start <= currentTime && currentTime <= end);
				while (currentTimeRange !== undefined && (video.currentTime + maxBufferSeconds) < currentTimeRange[1]) {
					if (seeked || this.destroyed) {
						break;
					}
					await new Promise<void>((resolve) => { window.setTimeout(resolve, 100); });
				}
				if (seeked || this.destroyed) {
					break;
				}
				sourceBuffer.appendBuffer(chunk);
				await waitForSourceBuffer();

				if (timeRanges.length > 0) {
					const currentTime = video.currentTime;
					const bufferStart = timeRanges[0][0];
					const bufferEnd = timeRanges[timeRanges.length - 1][1];

					const desiredBufferStart = Math.max(bufferStart, currentTime - maxBufferSeconds * 2);
					const desiredBufferEnd = Math.min(bufferEnd, currentTime + maxBufferSeconds * 2);

					if (bufferStart < desiredBufferStart) {
						sourceBuffer.remove(0, desiredBufferStart);
						await waitForSourceBuffer();
					}

					if (bufferEnd > desiredBufferEnd) {
						sourceBuffer.remove(desiredBufferEnd, bufferEnd);
						await waitForSourceBuffer();
					}
				}
			}

			if (this.destroyed) {
				break;
			}

			// end of stream, wait for seek
			while (!seeked) {
				await new Promise<void>((resolve) => { window.setTimeout(resolve, 100); });
			}
		}

		// cleanup
		video.removeEventListener("seeking", onSeeking);
		mediaSource.endOfStream();
		mediaSource.removeSourceBuffer(sourceBuffer);
		video.src = "";
		URL.revokeObjectURL(video.src);

		this.destroySignal.signal();
	}
}

export function polyfill() {
	const mkvUrls = new Map<HTMLVideoElement, string>(); // video element -> source URL
	const players = new Map<HTMLVideoElement, MKVVideoPlayer>(); // video element -> player
	const runOnce = async () => {
		const videos = document.querySelectorAll<HTMLVideoElement>("video.mkv-player");
		const newVideos: [HTMLVideoElement, string][] = [];
		for (const video of videos) {
			const sources = video.querySelectorAll("source");
			let mkvSource: string | undefined;
			for (const source of sources) {
				if (source.type === "video/x-matroska" || (source.type === "" && source.src.endsWith(".mkv"))) {
					mkvSource = source.src;
					break;
				}
			}
			if (mkvSource === undefined) {
				continue;
			}
			const prevSource = mkvUrls.get(video);
			if (prevSource === mkvSource) {
				continue;
			}
			players.get(video)?.destroy();
			mkvUrls.set(video, mkvSource);
			newVideos.push([video, mkvSource]);
		}
		for (const [video, mkvSource] of newVideos) {
			const blobLike = await FetchBlobLike.fromUrl(mkvSource);
			const player = new MKVVideoPlayer(blobLike, video);
			players.set(video, player);
		}
	};
	runOnce();
	setInterval(runOnce, 1000);
}
