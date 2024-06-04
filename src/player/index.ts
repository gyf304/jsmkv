import * as ebml from "../ebml";
import { BlobLike } from "../bloblike";
import { File } from "../matroska";
import * as mkve from "../matroska/elements";

import { Muxer, MuxerOptions, StreamTarget } from "mp4-muxer";

const videoCodecMapping = {
	"V_VP9": "vp9",
	"V_AV1": "av1",
	"V_MPEG4/ISO/AVC": "avc",
	"V_MPEGH/ISO/HEVC": "hevc",
} as const;

const audioCodecMapping = {
	"A_OPUS": "opus",
	"A_AAC": "aac",
} as const;

interface VideoOptions {
	codec: "avc" | "hevc" | "vp9" | "av1",
	width: number,
	height: number,
}

interface AudioOptions {
	codec: "aac" | "opus",
	numberOfChannels: number,
	sampleRate: number,
}

interface SeekCluster {
	time: number; // in seconds
	clusterPosition: number;
}

interface InitData {
	segment: mkve.Segment;
	timestampScale: number;

	videoOptions: VideoOptions;
	videoTrackNumber: number;
	videoCodecPrivateData?: ArrayBuffer;

	audioOptions?: AudioOptions;
	audioTrackNumber?: number;
	audioCodecPrivateData?: ArrayBuffer;

	seeks: SeekCluster[];
	duration: number; // in seconds

	mimeType: string;
}

interface TimestampedData {
	keyframe: boolean;
	data: ArrayBuffer;
	timestamp: number;
}

interface Options {
	maxBufferSeconds?: number;
}

function hexString(buffer: ArrayBuffer) {
	return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export class MKVVideoPlayer {
	constructor(private readonly source: BlobLike, private readonly video: HTMLVideoElement, private options?: Options) {
		this.init();
	}

	private async init(): Promise<InitData> {
		const mp4Timescale = 11520;
		const stream = new ebml.Stream(this.source);
		const mkv = new File(stream);
		const segment = await mkv.one(mkve.Segment, { before: mkve.Cluster });
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
		const durationSeconds = duration * (timestampScale / 1e9);

		let videoOptions: VideoOptions | undefined;
		let videoTrackNumber: number | undefined;
		let videoCodecPrivateData: ArrayBuffer | undefined;

		let audioOptions: AudioOptions | undefined;
		let audioTrackNumber: number | undefined;
		let audioCodecPrivateData: ArrayBuffer | undefined;

		// parse track data
		for await (const track of tracks.tracks) {
			const trackType = await track.trackType;
			const codecID = await track.codecID;
			switch (trackType) {
				case "video": {
					const video = await track.video;
					if (video === undefined) {
						throw new Error("Video not found");
					}
					const codec = videoCodecMapping[codecID as keyof typeof videoCodecMapping];
					if (codec === undefined) {
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
					videoTrackNumber = await track.trackNumber;
					const codecPrivate = await track.maybeOne(mkve.CodecPrivate);
					if (codecPrivate === undefined) {
						throw new Error("CodecPrivate not found");
					}
					const codecPrivateData = await codecPrivate.element.data.arrayBuffer();
					videoOptions = {
						codec,
						width,
						height,
					};
					videoCodecPrivateData = codecPrivateData;
					break;
				}
				case "audio": {
					const audio = await track.audio;
					if (audio === undefined) {
						throw new Error("Audio not found");
					}
					const audioCodec = audioCodecMapping[codecID as keyof typeof audioCodecMapping];
					if (audioCodec === undefined) {
						// throw new Error(`Unsupported audio codec: ${codecID}`)
						console.warn(`Unsupported audio codec: ${codecID}, ignored`);
						continue;
					}
					audioOptions = {
						codec: audioCodec,
						numberOfChannels: await audio.channels,
						sampleRate: await audio.samplingFrequency,
					};
					audioTrackNumber = await track.trackNumber;
					const codecPrivate = await track.maybeOne(mkve.CodecPrivate);
					if (codecPrivate !== undefined) {
						audioCodecPrivateData = await codecPrivate.element.data.arrayBuffer();
					}
					break;
				}
			}
		}

		if (videoOptions === undefined) {
			throw new Error("No suitable video track found");
		}

		let videoMimeCodec: string | undefined;
		let audioMimeCodec: string | undefined;

		switch (videoOptions.codec) {
			case "avc": {
				let level = "64001E";
				if (videoCodecPrivateData !== undefined && videoCodecPrivateData.byteLength >= 4) {
					level = hexString(videoCodecPrivateData.slice(1, 4));
				}
				videoMimeCodec = `avc1.${level}`;
				break;
			}
			case "hevc": {
				let level = "1.6.L93.90";
				// TODO: parse HEVC codec private data
				videoMimeCodec = `hvc1.${level}`;
				break;
			}
			case "vp9":
				videoMimeCodec = "vp09.00.10.08";
				break;
			case "av1":
				videoMimeCodec = "av01.0.05M.08";
				break;
		}

		if (audioOptions !== undefined) {
			switch (audioOptions.codec) {
				case "aac":
					audioMimeCodec = "mp4a.40.2";
					break;
				case "opus":
					audioMimeCodec = "opus";
					break;
			}
		}

		let mimeType: string;
		if (audioOptions !== undefined) {
			mimeType = `video/mp4; codecs="${videoMimeCodec}, ${audioMimeCodec}"`;
		} else {
			mimeType = `video/mp4; codecs="${videoMimeCodec}"`;
		}

		console.log("duration", durationSeconds);
		// create index for seeking

		const seeks: SeekCluster[] = [];
		for await (const cuePoint of cues.cuePoints) {
			const time = await cuePoint.cueTime; // in timestampScale
			const timeSeconds = time * (timestampScale / 1e9);
			const trackPositions = await cuePoint.cueTrackPositions;
			for await (const trackPosition of trackPositions) {
				if (await trackPosition.cueTrack === videoTrackNumber) {
					const clusterPosition = await trackPosition.cueClusterPosition;
					seeks.push({ time: timeSeconds, clusterPosition });
					break;
				}
			}
		}

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
		sourceBuffer.mode = "segments";

		// initialize muxer
		const muxer = new Muxer({
			target: new StreamTarget({
				onData: async (data: any) => {
					if (sourceBuffer.updating) {
						await new Promise<void>((resolve) => {
							const updateend = () => {
								sourceBuffer.removeEventListener("updateend", updateend);
								resolve();
							};
							sourceBuffer.addEventListener("updateend", updateend);
						});
					}
					sourceBuffer.appendBuffer(data);
				},
			}),
			video: videoOptions,
			audio: audioOptions,
			fastStart: "fragmented",
			firstTimestampBehavior: "keep",
		});

		const maxBufferSeconds = this.options?.maxBufferSeconds ?? 30;
		let seeked = false;
		video.addEventListener("seeking", () => {
			seeked = true;
		});

		let prevPts = 0;
		let prevDts: number = 0;

		let prevAudioTimestamp = 0;
		let prevAudioData: ArrayBuffer | undefined;

		while (true) {
			seeked = false;
			const videoTime = video.currentTime;

			let seekIndex = seeks.findIndex((seek) => seek.time >= videoTime) ?? seeks.length;
			seekIndex = Math.max(0, seekIndex - 1);
			const seek = seeks[seekIndex];

			for await (const cluster of segment.seekClusters(seek.clusterPosition)) {
				if (seeked) {
					break;
				}
				let firstVideoBlock = true;
				const clusterTimestamp = await cluster.timestamp;
				const clusterTimestampSeconds = clusterTimestamp * (timestampScale / 1e9);
				while (clusterTimestampSeconds > video.currentTime + maxBufferSeconds) {
					if (seeked) {
						break;
					}
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
				if (seeked) {
					break;
				}
				for await (const block of cluster.simpleBlocks) {
					if (seeked) {
						break;
					}
					const trackNumber = await block.trackNumber;
					if (trackNumber === videoTrackNumber) {
						const blockTimestamp = await block.timestamp;
						// console.log("blockTimestamp", blockTimestamp);
						const pts = clusterTimestamp + blockTimestamp; // PTS: Presentation Time Stamp
						// maxPtsRegression = Math.max(maxPtsRegression, pts - prevPts);
						const dts = Math.max(prevDts, pts); // DTS: Decode Time Stamp
						const delta = pts - dts;
						const ptsMicroseconds = pts * (timestampScale / 1e3);
						const deltaMicroseconds = delta * (timestampScale / 1e3);
						// console.log("pts", pts, "dts", dts, "delta", delta);
						const keyframe = (await block.keyframe) || firstVideoBlock;
						let data = await block.data;
						muxer.addVideoChunkRaw(
							new Uint8Array(data),
							keyframe ? "key" : "delta",
							ptsMicroseconds,   // PTS
							deltaMicroseconds, // PTS - DTS
							0,
							keyframe ? {
								decoderConfig: {
									codec: videoOptions!.codec,
									description: videoCodecPrivateData,
									optimizeForLatency: false,
								}
							} : undefined,
						);
						prevPts = pts;
						prevDts = dts;
						firstVideoBlock = false;
					} else if (trackNumber === audioTrackNumber) {
						const blockTimestamp = await block.timestamp;
						const timestamp = clusterTimestamp + blockTimestamp;
						if (prevAudioData !== undefined) {
							const duration = timestamp - prevAudioTimestamp;
							const prevTimestampMicroseconds = prevAudioTimestamp * (timestampScale / 1e3);
							const durationMicroseconds = duration * (timestampScale / 1e3);
							const data = await block.data;
							muxer.addAudioChunkRaw(
								new Uint8Array(data),
								"key",
								prevTimestampMicroseconds,
								durationMicroseconds,
								{
									decoderConfig: {
										codec: audioOptions!.codec,
										description: audioCodecPrivateData,
										optimizeForLatency: false,
									}
								},
							);
						}

						prevAudioData = await block.data;
						prevAudioTimestamp = timestamp;
					}
				}
			}
		}

		console.log("seek finalize");
		muxer.finalize();
	}
}

