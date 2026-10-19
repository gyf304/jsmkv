import type { BlobLike } from "../bloblike/index.js";
import * as ebml from "../ebml/index.js";
import * as mkve from "../matroska/elements/index.js";
import * as m from "../mp4/box.js";
import { audioMimeCodec, videoMimeCodec } from "../mp4/codecs.js";
import { CuePointTransmuxer } from "./cue.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface SegmentInfo {
	timestampScale: number;
	durationTicks: number;
	duration: number;
}

export async function readSegmentInfo(segment: mkve.Segment): Promise<SegmentInfo> {
	const info = await segment.info;
	const timestampScale = await info.timestampScale;
	const durationTicks = await info.duration;
	return {
		timestampScale,
		durationTicks,
		duration: durationTicks * timestampScale / 1e9,
	};
}

interface TrackInfoBase {
	number: number;
	language: string;
}

export interface VideoTrackInfo extends TrackInfoBase {
	type: "video";
	codecs: string;
	width?: number;
	height?: number;
}

export interface AudioTrackInfo extends TrackInfoBase {
	type: "audio";
	codecs: string;
	sampleRate?: number;
	channels?: number;
	bitDepth?: number;
}

export type TextMimeType = "text/x-ssa" | "text/srt" | "text/vtt";

export interface TextTrackInfo extends TrackInfoBase {
	type: "text";
	mimeType: TextMimeType;
	name?: string;
}

export type AudioVideoTrackInfo = VideoTrackInfo | AudioTrackInfo;
export type TrackInfo = AudioVideoTrackInfo | TextTrackInfo;

interface Block {
	readonly trackNumber: Promise<number>;
	readonly timestamp: Promise<number>;
	readonly keyframe: Promise<boolean>;
	readonly frames: AsyncGenerator<Uint8Array>;
}

export class TrackMuxer {
	private readonly timescale: number;
	private readonly duration: number;
	private readonly trak?: m.ArrayBuilder;
	private init?: Uint8Array;

	public static async from(
		entry: mkve.TrackEntry,
		segmentInfo: SegmentInfo,
	): Promise<TrackMuxer | undefined> {
		const type = await entry.trackType;
		if (type !== "video" && type !== "audio" && type !== "subtitle") {
			return undefined;
		}
		const data = entry.parent.parent.element.data;
		if (type === "video" || type === "audio") {
			const codecID = await entry.codecID;
			const codecPrivate = await entry.codecPrivate;
			if (codecPrivate === undefined) {
				return undefined;
			}
			const language = (await entry.languageIETF) ?? (await entry.language) ?? "und";
			const number = await entry.trackNumber;
			const contentEncodings = await entry.maybeOne(mkve.ContentEncodings);

			if (type === "video") {
				const codecs = videoMimeCodec(codecID, codecPrivate);
				const video = await entry.video;
				if (codecs === undefined || video === undefined) {
					return undefined;
				}
				return new TrackMuxer(
					data,
					segmentInfo,
					{
						number,
						type: "video",
						codecs,
						width: await video.pixelWidth,
						height: await video.pixelHeight,
						language,
					},
					new Uint8Array(codecPrivate),
					contentEncodings,
				);
			}

			const codecs = audioMimeCodec(codecID);
			const audio = await entry.audio;
			if (codecs === undefined || audio === undefined) {
				return undefined;
			}
			return new TrackMuxer(
				data,
				segmentInfo,
				{
					number,
					type: "audio",
					codecs,
					sampleRate: await audio.samplingFrequency,
					channels: await audio.channels,
					bitDepth: await audio.bitDepth,
					language,
				},
				new Uint8Array(codecPrivate),
				contentEncodings,
			);
		}

		if (type === "subtitle") {
			const mimeType = textMimeType(await entry.codecID);
			if (mimeType === undefined) {
				return undefined;
			}
			const codecPrivate = await entry.codecPrivate;
			if (mimeType === "text/x-ssa" && (codecPrivate === undefined || codecPrivate.byteLength === 0)) {
				return undefined;
			}
			const language = (await entry.languageIETF) ?? (await entry.language) ?? "und";
			return new TrackMuxer(
				data,
				segmentInfo,
				{
					number: await entry.trackNumber,
					type: "text",
					mimeType,
					language,
					name: await entry.trackName,
				},
				codecPrivate === undefined ? undefined : new Uint8Array(codecPrivate),
				await entry.maybeOne(mkve.ContentEncodings),
			);
		}

		return undefined;
	}

	private constructor(
		private readonly data: BlobLike,
		private readonly segmentInfo: SegmentInfo,
		public readonly info: TrackInfo,
		private readonly codecPrivate?: Uint8Array,
		private readonly contentEncodings?: mkve.ContentEncodings,
	) {
		if (info.type === "text") {
			this.timescale = 0;
			this.duration = 0;
		} else {
			if (codecPrivate === undefined) {
				throw new Error("CodecPrivate not found");
			}
			this.timescale = info.type === "audio" && info.sampleRate !== undefined ?
				Math.round(info.sampleRate) :
				Math.round(1e9 / segmentInfo.timestampScale);
			this.duration = Math.round(segmentInfo.duration * this.timescale);
			this.trak = this.buildTrak(info, codecPrivate);
		}
	}

	public initSegment(): Uint8Array {
		if (this.init === undefined) {
			if (this.info.type === "text") {
				this.init = this.info.mimeType === "text/x-ssa" ?
					this.codecPrivate ?? new Uint8Array(0) :
					this.info.mimeType === "text/vtt" ?
						textEncoder.encode("WEBVTT\n\n") :
						new Uint8Array(0);
			} else {
				this.init = m.ArrayBuilder.concat(
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
						this.trak!,
						m.mvex(
							m.trex({
								trackId: 1,
								defaultSampleDescriptionIndex: 1,
							}),
						),
					),
				).valueOf();
			}
		}
		return this.init;
	}

	public async *streamFragments(
		startByte: number,
		endByte: number,
		endTime: number,
		sequenceNumber: number = 0,
	): AsyncGenerator<Uint8Array> {
		if (this.info.type === "text") {
			yield* this.streamTextFragments(this.info, startByte, endByte, endTime);
			return;
		}
		const endTicks = Math.round(endTime * 1e9 / this.segmentInfo.timestampScale);
		const stream = new ebml.Stream(this.data.slice(startByte, endByte + 1));
		const clusters: mkve.Cluster[] = [];
		for await (const element of stream.children) {
			if (element.id.id === mkve.Cluster.id) {
				clusters.push(new mkve.Cluster(element, undefined as unknown as mkve.Segment));
			}
		}
		if (clusters.length > 0) {
			const fragment = await this.muxClusters(clusters, endTicks, sequenceNumber);
			if (fragment !== undefined) {
				yield fragment;
			}
		}
	}

	private async *streamTextFragments(
		info: TextTrackInfo,
		startByte: number,
		endByte: number,
		endTime: number,
	): AsyncGenerator<Uint8Array> {
		const scale = this.segmentInfo.timestampScale / 1e9;
		const stream = new ebml.Stream(this.data.slice(startByte, endByte + 1));
		const blocks: TextBlock[] = [];
		for await (const element of stream.children) {
			if (element.id.id !== mkve.Cluster.id) {
				continue;
			}
			const cluster = new mkve.Cluster(element, undefined as unknown as mkve.Segment);
			const clusterTimestamp = await cluster.timestamp;
			for await (const child of cluster.children) {
				if (child instanceof mkve.SimpleBlock) {
					if (await child.trackNumber === info.number) {
						blocks.push({
							timestamp: clusterTimestamp + await child.timestamp,
							frames: child.frames,
						});
					}
				} else if (child instanceof mkve.BlockGroup) {
					const block = await child.block;
					if (block !== undefined && await block.trackNumber === info.number) {
						blocks.push({
							timestamp: clusterTimestamp + await block.timestamp,
							duration: await child.duration,
							frames: block.frames,
						});
					}
				}
			}
		}
		blocks.sort((a, b) => a.timestamp - b.timestamp);

		let index = 1;
		for (let i = 0; i < blocks.length; i++) {
			const block = blocks[i];
			const start = block.timestamp * scale;
			const end = block.duration !== undefined ?
				start + block.duration * scale :
				(i + 1 < blocks.length ? blocks[i + 1].timestamp * scale : endTime);
			for await (const frame of block.frames) {
				const data = this.contentEncodings === undefined ?
					frame :
					new Uint8Array(await this.contentEncodings.decode(
						frame.buffer as ArrayBuffer,
					));
				const fragment = this.formatText(
					info,
					start,
					Math.max(start, end),
					textDecoder.decode(data),
					index,
				);
				if (fragment !== undefined) {
					index++;
					yield textEncoder.encode(fragment);
				}
			}
		}
	}

	private formatText(
		info: TextTrackInfo,
		start: number,
		end: number,
		text: string,
		index: number,
	): string | undefined {
		if (info.mimeType === "text/x-ssa") {
			const fields = splitFirst(text, ",", 9);
			if (fields.length < 9) {
				return undefined;
			}
			const [, layer, style, name, marginL, marginR, marginV, effect, payload] = fields;
			return "Dialogue: " + [
				layer,
				formatAssTime(start),
				formatAssTime(end),
				style,
				name,
				marginL,
				marginR,
				marginV,
				effect,
				payload,
			].join(",") + "\n";
		}
		if (info.mimeType === "text/vtt") {
			return `${formatVttTime(start)} --> ${formatVttTime(end)}\n${normalizeText(text)}\n\n`;
		}
		return `${index}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${normalizeText(text)}\n\n`;
	}

	private async muxClusters(
		clusters: mkve.Cluster[],
		endTicks: number,
		sequenceNumber: number,
	): Promise<Uint8Array | undefined> {
		const blocks: { block: Block, timestamp: number }[] = [];
		for (const cluster of clusters) {
			const clusterTimestamp = await cluster.timestamp;
			for await (const child of cluster.children) {
				let block: Block | undefined;
				if (child instanceof mkve.SimpleBlock) {
					block = child;
				} else if (child instanceof mkve.BlockGroup) {
					block = await child.block;
				}
				if (block === undefined || await block.trackNumber !== this.info.number) {
					continue;
				}
				const timestamp = await block.timestamp;
				if (this.info.type === "audio" && timestamp < 0) {
					continue;
				}
				blocks.push({ block, timestamp: clusterTimestamp + timestamp });
			}
		}
		if (blocks.length === 0) {
			return undefined;
		}

		const ptses = blocks.map((block) => block.timestamp);
		const dtses = [...ptses, endTicks];
		for (let i = dtses.length - 2; i >= 0; i--) {
			dtses[i] = Math.min(dtses[i], dtses[i + 1]);
		}
		for (let i = 1; i < dtses.length; i++) {
			dtses[i] = Math.max(dtses[i], dtses[i - 1] + 1);
		}

		const samples: m.TRUN["samples"] = [];
		const dataParts: m.ArrayBuilderPart[] = [];
		for (let i = 0; i < blocks.length; i++) {
			const block = blocks[i].block;
			const pts = ptses[i];
			const dts = dtses[i];
			const duration = dtses[i + 1] - dtses[i];
			if (duration < 0) {
				throw new Error(`Invalid duration: pts=${pts}, dts=${dts}, duration=${duration}`);
			}

			const keyframe = await block.keyframe;
			const frames: Uint8Array[] = [];
			for await (const frame of block.frames) {
				frames.push(frame);
			}
			if (frames.length === 0) {
				continue;
			}
			const videoFrameDuration = this.toTrackTime(duration);
			const frameDuration = this.info.type === "audio" ?
				1024 :
				Math.floor(videoFrameDuration / frames.length);
			const lastFrameDuration = this.info.type === "audio" ?
				1024 :
				videoFrameDuration - frameDuration * (frames.length - 1);
			for (let j = 0; j < frames.length; j++) {
				let frameData = frames[j];
				if (this.contentEncodings !== undefined) {
					frameData = new Uint8Array(await this.contentEncodings.decode(
						frameData.buffer as ArrayBuffer,
					));
				}
				dataParts.push(frameData);
				samples.push({
					duration: j === frames.length - 1 ? lastFrameDuration : frameDuration,
					size: frameData.byteLength,
					compositionTimeOffset: this.info.type === "audio" ?
						0 :
						this.toTrackTime(pts - dts),
					sampleFlags: {
						dependsOn: keyframe ? 2 : 1,
						isNonSyncSample: keyframe ? 0 : 1,
					},
				});
			}
		}

		const baseMediaDecodeTime = Math.max(0, this.toTrackTime(dtses[0]));
		const traf = (offset: number) => m.traf(
			m.tfhd({ trackId: 1 }),
			m.tfdt({ baseMediaDecodeTime }),
			m.trun({ dataOffset: offset, samples }),
		);
		const moofSize = m.moof(m.mfhd({ sequenceNumber }), traf(0)).byteLength;
		const moof = m.moof(m.mfhd({ sequenceNumber }), traf(moofSize + 8));
		const mdat = m.mdat(m.ArrayBuilder.concat(...dataParts));
		return m.ArrayBuilder.concat(moof, mdat).valueOf();
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

		const sampleRate = Math.round(info.sampleRate ?? 0);
		return m.trak(
			m.tkhd({ trackId: 1 }),
			m.mdia(
				m.mdhd({ timeScale: this.timescale, duration: this.duration }),
				m.hdlr({ handlerType: "soun", handlerName: "SoundHandler" }),
				m.minf(
					m.smhd({}),
					m.dinf(m.dref(m.url())),
					m.stbl(
						m.stsd(
							m.mp4a(
								{
									channelCount: info.channels ?? 2,
									sampleRate,
									sampleSize: info.bitDepth ?? 16,
								},
								m.esds({ codecPrivate }),
							),
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
}

interface TextBlock {
	timestamp: number;
	duration?: number;
	frames: AsyncGenerator<Uint8Array>;
}


export class TrackTransmuxer {
	constructor(
		public readonly info: TrackInfo,
		public readonly init: Uint8Array,
		public readonly cuePoints: CuePointTransmuxer[],
	) {}
}

function textMimeType(codecID: string): TextMimeType | undefined {
	switch (codecID) {
		case "S_TEXT/UTF8":
		case "S_TEXT/ASCII":
			return "text/srt";
		case "S_TEXT/ASS":
		case "S_TEXT/SSA":
			return "text/x-ssa";
		case "S_TEXT/WEBVTT":
			return "text/vtt";
	}
	return undefined;
}

function normalizeText(text: string): string {
	return text.replace(/\r\n?/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

function splitFirst(text: string, separator: string, count: number): string[] {
	const parts: string[] = [];
	let start = 0;
	while (parts.length < count - 1) {
		const end = text.indexOf(separator, start);
		if (end < 0) {
			break;
		}
		parts.push(text.substring(start, end));
		start = end + separator.length;
	}
	parts.push(text.substring(start));
	return parts;
}

function formatSrtTime(seconds: number): string {
	const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
	const milliseconds = totalMilliseconds % 1000;
	const totalSeconds = Math.floor(totalMilliseconds / 1000);
	const pad = (value: number, length: number) => String(value).padStart(length, "0");
	return pad(Math.floor(totalSeconds / 3600), 2) + ":" +
		pad(Math.floor(totalSeconds / 60) % 60, 2) + ":" +
		pad(totalSeconds % 60, 2) + "," + pad(milliseconds, 3);
}

function formatVttTime(seconds: number): string {
	return formatSrtTime(seconds).replace(",", ".");
}

function formatAssTime(seconds: number): string {
	const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
	const milliseconds = totalMilliseconds % 1000;
	const totalSeconds = Math.floor(totalMilliseconds / 1000);
	const pad = (value: number, length: number) => String(value).padStart(length, "0");
	return Math.floor(totalSeconds / 3600) + ":" +
		pad(Math.floor(totalSeconds / 60) % 60, 2) + ":" +
		pad(totalSeconds % 60, 2) + "." + pad(milliseconds, 3);
}
