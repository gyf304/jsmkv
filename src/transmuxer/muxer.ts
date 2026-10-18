import * as ebml from "../ebml/index.js";
import { BlobLike, FetchBlobLike } from "../bloblike/index.js";
import { File } from "../matroska/index.js";
import * as mkve from "../matroska/elements/index.js";

import * as m from "./box.js";
import { hevcMimeCodec, hexString } from "./codecs.js";

const supportedVideoCodecs = [
	"V_MPEG4/ISO/AVC",
	"V_MPEGH/ISO/HEVC",
] as const;
const supportedAudioCodecs = ["A_AAC"] as const;

interface SeekCluster {
	time: number; // in seconds
	clusterPosition: number;
}

interface Track {
	type: "video" | "audio";
	mimeCodec: string;
	mkvTrackNumber: number;
	mp4TrackId: number;
	trak: m.ArrayBuilder;
	contentEncodings?: mkve.ContentEncodings;
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

export class MatroskaToFmp4Muxer {
	private initPromise: Promise<void> | undefined;
	private initSegment: ArrayBuffer | undefined;

	private duration: number | undefined;
	private mkvDuration: number | undefined;
	private mkvSegment: mkve.Segment | undefined;
	private mimeType: string | undefined;
	private seeks: SeekCluster[] | undefined;

	private mkvTracks: Map<number, Track> = new Map();

	constructor(private readonly source: BlobLike) {}

	public async getInitSegment(): Promise<ArrayBuffer> {
		await this.init();
		return this.initSegment!;
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
		let seekIndex = seeks.findIndex((seek) => seek.time >= timeInSeconds);
		if (seekIndex === -1) seekIndex = seeks.length; // seeking past last cue point
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

			const nextBlocksByTrack = nextCluster === undefined ? undefined : await this.readCluster(nextCluster);
			const nextBlocksMinTimestamps = new Map<number, number>();
			if (nextBlocksByTrack !== undefined) {
				for (const [trackNumber, blocks] of nextBlocksByTrack) {
					let minTimestamp = Infinity;
					for (const block of blocks) {
						minTimestamp = Math.min(minTimestamp, await block.timestamp);
					}
					nextBlocksMinTimestamps.set(trackNumber, minTimestamp);
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
				if (blocks.length === 0) continue;
				const samples: m.TRUN["samples"] = [];
				const dataParts: m.ArrayBuilderPart[] = [];

				const ptses: number[] = [];
				for (let i = 0; i < blocks.length; i++) {
					const block = blocks[i];
					const pts = await block.timestamp;
					ptses.push(pts);
				}
				// Compute DTS from PTS: blocks are in decode order, PTS may be
				// non-monotonic due to B-frames. Backward clamping ensures
				// DTS[i] <= PTS[i], forward enforcement ensures positive durations.
				const nextDts = clusterDuration + (nextBlocksMinTimestamps.get(trackNumber) ?? 0);
				const dtses = [...ptses, nextDts];
				for (let i = dtses.length - 2; i >= 0; i--) {
					dtses[i] = Math.min(dtses[i], dtses[i + 1]);
				}
				for (let i = 1; i < dtses.length; i++) {
					dtses[i] = Math.max(dtses[i], dtses[i - 1] + 1);
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
						throw new Error(`Invalid duration: pts=${pts}, dts=${dts}, duration=${duration}`);
					}

					const keyframe = await block.keyframe;
					const frames: Uint8Array[] = [];
					for await (const frame of block.frames) {
						frames.push(frame);
					}
					if (frames.length === 0) continue;
					const frameDuration = Math.floor(duration / frames.length);
					const lastFrameDuration = duration - frameDuration * (frames.length - 1);
					for (let j = 0; j < frames.length; j++) {
						let data = frames[j];
						if (track.contentEncodings !== undefined) {
							data = new Uint8Array(await track.contentEncodings.decode(data.buffer as ArrayBuffer));
						}

						dataParts.push(data);
						samples.push({
							duration: j === frames.length - 1 ? lastFrameDuration : frameDuration,
							size: data.byteLength,
							compositionTimeOffset: pts - dts,
							sampleFlags: {
								dependsOn: keyframe ? 2 : 1,
								isNonSyncSample: keyframe ? 0 : 1,
							},
						});
					}
				}

				const traf = (offset: number) => m.traf(
					m.tfhd({
						trackId: mp4TrackId,
					}),
					m.tfdt({
						baseMediaDecodeTime: clusterTimestamp + dtses[0],
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

		const cues = await segment.getCues();
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
											codecID === "V_MPEGH/ISO/HEVC" ? m.hvc1(
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
		const initSegment = m.ArrayBuilder.concat(
			m.ftyp({
				majorBrand: "isom",
				minorVersion: 0,
				compatibleBrands: ["isom", "iso2", "iso6", "mp41", "mp42", ...(videoTrack.mimeCodec.startsWith("avc1") ? ["avc1"] : [])],
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

		this.initSegment = initSegment.valueOf().buffer as ArrayBuffer;
	}
}
