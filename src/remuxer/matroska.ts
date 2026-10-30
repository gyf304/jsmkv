import * as ebml from "../ebml/index.js";
import * as mkve from "../matroska/elements/index.js";
import * as m from "../mp4/box.js";
import { audioMimeCodec, videoMimeCodec } from "./codecs.js";
import type { Remuxer } from "./types.js";

interface SegmentInfo {
	readonly timestampScale: number;
	readonly durationTicks: number;
	readonly duration: number;
}

interface VideoTrackInfo {
	readonly type: "video";
	readonly codecs: string;
	readonly width?: number;
	readonly height?: number;
}

interface AudioTrackInfo {
	readonly type: "audio";
	readonly codecs: string;
	readonly sampleRate?: number;
	readonly channels?: number;
	readonly bitDepth?: number;
}

type AudioVideoTrackInfo = VideoTrackInfo | AudioTrackInfo;

interface Block {
	readonly trackNumber: Promise<number>;
	readonly timestamp: Promise<number>;
	readonly keyframe: Promise<boolean>;
	readonly frames: AsyncGenerator<Uint8Array>;
}

export class MatroskaTrackToFMP4Remuxer implements Remuxer {
	public static async mimeType(
		entry: mkve.TrackEntry,
	): Promise<string | undefined> {
		const type = await entry.trackType;
		if (type === "video") {
			const codecPrivate = await entry.codecPrivate;
			if (codecPrivate === undefined) {
				return undefined;
			}
			const codec = videoMimeCodec(await entry.codecID, codecPrivate);
			return codec === undefined ?
				undefined :
				`video/mp4; codecs="${codec}"`;
		}
		if (type === "audio") {
			const codec = audioMimeCodec(await entry.codecID);
			return codec === undefined ?
				undefined :
				`audio/mp4; codecs="${codec}"`;
		}
		return undefined;
	}

	public static async create(
		entry: mkve.TrackEntry,
	): Promise<MatroskaTrackToFMP4Remuxer | undefined> {
		const type = await entry.trackType;
		if (type !== "video" && type !== "audio") {
			return undefined;
		}
		const codecPrivate = await entry.codecPrivate;
		if (codecPrivate === undefined) {
			return undefined;
		}
		const info = await entry.parent.parent.info;
		const timestampScale = await info.timestampScale;
		const durationTicks = await info.duration;
		const segmentInfo: SegmentInfo = {
			timestampScale,
			durationTicks,
			duration: durationTicks * timestampScale / 1e9,
		};
		const defaultDuration = await entry.defaultDuration;

		if (type === "video") {
			const codecs = videoMimeCodec(await entry.codecID, codecPrivate);
			const video = await entry.video;
			if (codecs === undefined || video === undefined) {
				return undefined;
			}
			return new MatroskaTrackToFMP4Remuxer(
				segmentInfo,
				{
					type: "video",
					codecs,
					width: await video.pixelWidth,
					height: await video.pixelHeight,
				},
				new Uint8Array(codecPrivate),
				entry,
				defaultDuration,
			);
		}

		const codecs = audioMimeCodec(await entry.codecID);
		const audio = await entry.audio;
		if (codecs === undefined || audio === undefined) {
			return undefined;
		}
		return new MatroskaTrackToFMP4Remuxer(
			segmentInfo,
			{
				type: "audio",
				codecs,
				sampleRate: await audio.samplingFrequency,
				channels: await audio.channels,
				bitDepth: await audio.bitDepth,
			},
			new Uint8Array(codecPrivate),
			entry,
			defaultDuration,
		);
	}

	public readonly sourceMimeType: string;
	public readonly targetMimeType: string;
	private readonly timescale: number;
	private readonly duration: number;
	private readonly trak: m.ArrayBuilder;
	private cachedInit?: ArrayBuffer;
	private lastVideoDts?: number;
	private lastAudioTime?: number;
	private inferredFrameDuration?: number;

	private constructor(
		private readonly segmentInfo: SegmentInfo,
		private readonly info: AudioVideoTrackInfo,
		private readonly codecPrivate: Uint8Array,
		private readonly entry: mkve.TrackEntry,
		private readonly defaultDuration: number | undefined,
	) {
		this.timescale = info.type === "audio" ?
			(info.codecs === "opus" ? 48000 : Math.round(info.sampleRate ?? 48000)) :
			Math.round(1e9 / segmentInfo.timestampScale);
		this.duration = Math.round(segmentInfo.duration * this.timescale);
		this.trak = this.buildTrak(info, codecPrivate);
		this.sourceMimeType = `${info.type}/x-matroska`;
		this.targetMimeType = `${info.type}/mp4; codecs="${info.codecs}"`;
	}

	public reset(): void {
		this.lastVideoDts = undefined;
		this.lastAudioTime = undefined;
		this.inferredFrameDuration = undefined;
	}

	public get initSegment(): ArrayBuffer {
		if (this.cachedInit === undefined) {
			this.cachedInit = toArrayBuffer(m.ArrayBuilder.concat(
				m.ftyp({
					majorBrand: "isom",
					minorVersion: 0,
					compatibleBrands: [
						"isom", "iso2", "iso6", "mp41", "mp42",
						...(this.info.codecs.startsWith("avc1") ? ["avc1"] : []),
					],
				}),
				m.moov(
					m.mvhd({
						timeScale: Math.round(1e9 / this.segmentInfo.timestampScale),
						duration: this.segmentInfo.durationTicks,
						nextTrackId: 2,
					}),
					this.trak,
					m.mvex(
						m.trex({
							trackId: 1,
							defaultSampleDescriptionIndex: 1,
						}),
					),
				),
			).valueOf());
		}
		return this.cachedInit;
	}

	public async *remux(
		segments: AsyncIterable<ArrayBuffer>,
		signal?: AbortSignal,
	): AsyncIterable<ArrayBuffer> {
		const scale = this.segmentInfo.timestampScale / 1e9;
		for await (const data of segments) {
			if (signal?.aborted) {
				return;
			}
			const stream = new ebml.Stream(new Blob([data]));
			for await (const element of stream.children) {
				if (element.id.id !== mkve.Cluster.id) {
					continue;
				}
				const cluster = new mkve.Cluster(
					element,
					undefined as unknown as mkve.Segment,
				);
				const startTime = (await cluster.timestamp) * scale;
				const fragment = await this.muxCluster(
					cluster,
					Math.round(startTime * 1000),
				);
				if (fragment !== undefined) {
					yield fragment;
				}
				if (signal?.aborted) {
					return;
				}
			}
		}
	}

	private async muxCluster(
		cluster: mkve.Cluster,
		sequenceNumber: number,
	): Promise<ArrayBuffer | undefined> {
		const trackNumber = await this.entry.trackNumber;
		const contentEncodings = await this.entry.maybeOne(mkve.ContentEncodings);
		const blocks: {
			timestamp: number;
			keyframe: boolean;
			frames: Uint8Array[];
		}[] = [];
		const clusterTimestamp = await cluster.timestamp;
		for await (const child of cluster.children) {
			let block: Block | undefined;
			if (child instanceof mkve.SimpleBlock) {
				block = child;
			} else if (child instanceof mkve.BlockGroup) {
				block = await child.block;
			}
			if (block === undefined || await block.trackNumber !== trackNumber) {
				continue;
			}
			const timestamp = await block.timestamp;
			if (this.info.type === "audio" && timestamp < 0) {
				continue;
			}
			const frames: Uint8Array[] = [];
			for await (const frame of block.frames) {
				frames.push(frame);
			}
			if (frames.length === 0) {
				continue;
			}
			blocks.push({
				timestamp: clusterTimestamp + timestamp,
				keyframe: await block.keyframe,
				frames,
			});
		}
		if (blocks.length === 0) {
			return undefined;
		}

		const frameCounts = blocks.map((block) => block.frames.length);
		const ptses = blocks.map((block) => block.timestamp);
		const audioFrame = this.info.type === "audio" ?
			this.audioFrameDuration(ptses, frameCounts) :
			undefined;
		const dtses = new Array<number>(blocks.length);
		if (this.info.type === "video") {
			const frameDuration = this.frameDuration(ptses);
			let cumulative = 0;
			let provisional = Number.POSITIVE_INFINITY;
			for (let i = 0; i < ptses.length; i++) {
				provisional = Math.min(
					provisional,
					ptses[i] - cumulative * frameDuration,
				);
				cumulative += frameCounts[i];
			}
			const continuous = this.lastVideoDts !== undefined &&
				this.lastVideoDts <= provisional + 1e-6 &&
				this.lastVideoDts >= provisional - frameDuration * 4;
			const base = continuous ? this.lastVideoDts! : provisional;
			cumulative = 0;
			for (let i = 0; i < ptses.length; i++) {
				dtses[i] = base + cumulative * frameDuration;
				cumulative += frameCounts[i];
			}
			dtses.push(base + cumulative * frameDuration);
			this.lastVideoDts = dtses[dtses.length - 1];
		} else if (audioFrame !== undefined) {
			const base = ptses[0];
			let cumulative = 0;
			for (let i = 0; i < ptses.length; i++) {
				dtses[i] = base + cumulative * audioFrame;
				cumulative += frameCounts[i];
			}
			dtses.push(base + cumulative * audioFrame);
		} else {
			const last = ptses[ptses.length - 1];
			const previous = ptses.length > 1 ? ptses[ptses.length - 2] : last;
			dtses.length = 0;
			dtses.push(...ptses, last + Math.max(1, last - previous));
			for (let i = dtses.length - 2; i >= 0; i--) {
				dtses[i] = Math.min(dtses[i], dtses[i + 1]);
			}
			for (let i = 1; i < dtses.length; i++) {
				dtses[i] = Math.max(dtses[i], dtses[i - 1] + 1);
			}
		}

		const ptsTimes = ptses.map((pts) => this.toTrackTime(pts));
		let dtsTimes = dtses.map((dts) => this.toTrackTime(dts));
		if (audioFrame !== undefined) {
			dtsTimes.length = blocks.length;
			const frameSamples = Math.max(1, this.toTrackTime(audioFrame));
			const start = this.toTrackTime(ptses[0]);
			const continuous = this.lastAudioTime !== undefined &&
				Math.abs(this.lastAudioTime - start) <= this.timescale / 1000;
			const base = continuous ? this.lastAudioTime! : start;
			let cumulative = 0;
			for (let i = 0; i < ptses.length; i++) {
				dtsTimes[i] = base + cumulative * frameSamples;
				cumulative += frameCounts[i];
			}
			dtsTimes.push(base + cumulative * frameSamples);
			this.lastAudioTime = dtsTimes[dtsTimes.length - 1];
		}
		const samples: m.TRUN["samples"] = [];
		const dataParts: m.ArrayBuilderPart[] = [];
		for (let i = 0; i < blocks.length; i++) {
			const block = blocks[i];
			const duration = dtsTimes[i + 1] - dtsTimes[i];
			if (duration < 0) {
				throw new Error(`Invalid duration: pts=${ptses[i]}, dts=${dtses[i]}`);
			}

			const sampleCount = Math.max(block.frames.length, duration);
			const frameDuration = Math.floor(sampleCount / block.frames.length);
			const lastFrameDuration = sampleCount - frameDuration * (block.frames.length - 1);
			for (let j = 0; j < block.frames.length; j++) {
				let frameData = block.frames[j];
				if (contentEncodings !== undefined) {
					frameData = new Uint8Array(await contentEncodings.decode(
						frameData.buffer as ArrayBuffer,
					));
				}
				dataParts.push(frameData);
				samples.push({
					duration: j === block.frames.length - 1 ? lastFrameDuration : frameDuration,
					size: frameData.byteLength,
					compositionTimeOffset: this.info.type === "audio" ?
						0 :
						Math.max(0, ptsTimes[i] - dtsTimes[i]),
					sampleFlags: {
						dependsOn: block.keyframe ? 2 : 1,
						isNonSyncSample: block.keyframe ? 0 : 1,
					},
				});
			}
		}

		const baseMediaDecodeTime = Math.max(0, dtsTimes[0]);
		const traf = (offset: number) => m.traf(
			m.tfhd({ trackId: 1 }),
			m.tfdt({ baseMediaDecodeTime }),
			m.trun({ dataOffset: offset, samples }),
		);
		const moofSize = m.moof(m.mfhd({ sequenceNumber }), traf(0)).byteLength;
		const moof = m.moof(m.mfhd({ sequenceNumber }), traf(moofSize + 8));
		const mdat = m.mdat(m.ArrayBuilder.concat(...dataParts));
		return toArrayBuffer(m.ArrayBuilder.concat(moof, mdat).valueOf());
	}

	private audioFrameDuration(
		ptses: readonly number[],
		frameCounts: readonly number[],
	): number | undefined {
		if (this.defaultDuration !== undefined) {
			return this.defaultDuration / this.segmentInfo.timestampScale;
    }
    if (this.info.type !== "audio") {
      return undefined;
    }
		if (this.info.codecs === "mp4a.40.2") {
      const sampleRate = this.info.sampleRate ?? 48000;
			return 1024 / sampleRate * 1e9 / this.segmentInfo.timestampScale;
		}
		const estimates: number[] = [];
		for (let i = 1; i < ptses.length; i++) {
			const delta = ptses[i] - ptses[i - 1];
			if (delta > 0 && frameCounts[i - 1] > 0) {
				estimates.push(delta / frameCounts[i - 1]);
			}
		}
		if (estimates.length > 0) {
			estimates.sort((a, b) => a - b);
			const median = estimates[Math.floor(estimates.length / 2)];
			const min = estimates[0];
			const max = estimates[estimates.length - 1];
			if (max - min <= median * 0.1) {
				this.inferredFrameDuration = median;
				return median;
			}
			return undefined;
		}
		if (this.inferredFrameDuration !== undefined) {
			return this.inferredFrameDuration;
		}
		if (this.info.codecs === "opus") {
			return 20 * 1e6 / this.segmentInfo.timestampScale;
		}
		return undefined;
	}

	private frameDuration(ptses: readonly number[]): number {
		if (this.defaultDuration !== undefined) {
			return this.defaultDuration / this.segmentInfo.timestampScale;
		}
		const sorted = [...ptses].sort((a, b) => a - b);
		let sum = 0;
		let count = 0;
		for (let i = 1; i < sorted.length; i++) {
			const delta = sorted[i] - sorted[i - 1];
			if (delta > 0) {
				sum += delta;
				count++;
			}
		}
		if (count > 0) {
			this.inferredFrameDuration = sum / count;
		}
		return this.inferredFrameDuration ?? 1;
	}

	private toTrackTime(ticks: number): number {
		return Math.round(
			ticks * this.segmentInfo.timestampScale * this.timescale / 1e9,
		);
	}

	private buildTrak(
		info: AudioVideoTrackInfo,
		codecPrivate: Uint8Array,
	): m.ArrayBuilder {
		if (info.type === "video") {
			const width = info.width ?? 0;
			const height = info.height ?? 0;
			return m.trak(
				m.tkhd({ trackId: 1, width, height }),
				m.mdia(
					m.mdhd({ timeScale: this.timescale, duration: this.duration }),
					m.hdlr({ handlerType: "vide", handlerName: "VideoHandler" }),
					m.minf(
						m.vmhd({}),
						m.dinf(m.dref(m.url())),
						m.stbl(
							m.stsd(
								info.codecs.startsWith("hvc1") ?
									m.hvc1({ width, height }, m.hvcc(codecPrivate)) :
									m.avc1({ width, height }, m.avcc(codecPrivate)),
							),
							m.stts(),
							m.stsc(),
							m.stsz(),
							m.stco(),
						),
					),
				),
			);
		}

		const sampleRate = info.codecs === "opus" ?
			48000 :
			Math.round(info.sampleRate ?? 48000);
		const sampleSize = info.codecs === "flac" ? info.bitDepth ?? 24 : 16;
		const sampleEntry = info.codecs === "opus" ?
			m.opus(
				{
					channelCount: info.channels ?? 2,
					sampleRate,
					sampleSize,
				},
				m.dOps(opusConfig(codecPrivate)),
			) :
			info.codecs === "flac" ?
				m.flac(
					{
						channelCount: info.channels ?? 2,
						sampleRate,
						sampleSize,
					},
					m.dfLa(flacMetadata(codecPrivate)),
				) :
				m.mp4a(
					{
						channelCount: info.channels ?? 2,
						sampleRate,
						sampleSize: info.bitDepth ?? 16,
					},
					m.esds({ codecPrivate }),
				);
		return m.trak(
			m.tkhd({ trackId: 1 }),
			m.mdia(
				m.mdhd({ timeScale: this.timescale, duration: this.duration }),
				m.hdlr({ handlerType: "soun", handlerName: "SoundHandler" }),
				m.minf(
					m.smhd({}),
					m.dinf(m.dref(m.url())),
					m.stbl(
						m.stsd(sampleEntry),
						m.stts(),
						m.stsc(),
						m.stsz(),
						m.stco(),
					),
				),
			),
		);
	}
}

function opusConfig(codecPrivate: Uint8Array): m.DOPS {
	if (codecPrivate.byteLength < 19) {
		throw new Error("Invalid Opus CodecPrivate");
	}
	const view = new DataView(
		codecPrivate.buffer,
		codecPrivate.byteOffset,
		codecPrivate.byteLength,
	);
	const mappingFamily = view.getUint8(18);
	return {
		channels: view.getUint8(9),
		preSkip: view.getUint16(10, true),
		inputSampleRate: view.getUint32(12, true),
		outputGain: view.getInt16(16, true),
		mappingFamily,
		mapping: mappingFamily === 0 ? undefined : codecPrivate.subarray(19),
	};
}

function flacMetadata(codecPrivate: Uint8Array): Uint8Array {
	if (codecPrivate.byteLength >= 4 &&
		codecPrivate[0] === 0x66 &&
		codecPrivate[1] === 0x4c &&
		codecPrivate[2] === 0x61 &&
		codecPrivate[3] === 0x43) {
		const blocks = codecPrivate.subarray(4);
		if (blocks.byteLength >= 4) {
			const length = (blocks[1] << 16) | (blocks[2] << 8) | blocks[3];
			if (blocks.byteLength >= 4 + length) {
				const streamInfo = blocks.slice(0, 4 + length);
				streamInfo[0] |= 0x80;
				return streamInfo;
			}
		}
	}
	return codecPrivate;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
	return data.buffer.slice(
		data.byteOffset,
		data.byteOffset + data.byteLength,
	) as ArrayBuffer;
}
