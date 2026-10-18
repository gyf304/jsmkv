import * as ebml from "../ebml/index.js";
import * as mkve from "../matroska/elements/index.js";
import * as m from "./box.js";
import type { MatroskaInfo, MatroskaTrackInfo } from "./metadata.js";

export type MatroskaContentType = "video" | "audio";

export interface MatroskaMuxOptions {
	contentType: MatroskaContentType;
	endTime: number; // in seconds
	sequenceNumber?: number;
}

interface SegmentTrack {
	info: MatroskaTrackInfo;
	mp4TrackId: number;
	timescale: number;
	duration: number;
	trak: m.ArrayBuilder;
}

export class MatroskaSegmentMuxer {
	private readonly tracks = new Map<MatroskaContentType, SegmentTrack>();
	private readonly initSegments = new Map<MatroskaContentType, Uint8Array>();
	private sequenceNumber = 0;

	constructor(private readonly info: MatroskaInfo) {
		for (const track of info.tracks) {
			if (this.tracks.has(track.type)) {
				continue;
			}
			const mp4TrackId = this.tracks.size + 1;
			const timescale = track.type === "audio" && track.sampleRate !== undefined ?
				Math.round(track.sampleRate) :
				Math.round(1e9 / this.info.timestampScale);
			const duration = Math.round(this.info.duration * timescale);
			this.tracks.set(track.type, {
				info: track,
				mp4TrackId,
				timescale,
				duration,
				trak: this.buildTrak(track, mp4TrackId, timescale, duration),
			});
		}
	}

	public getMimeType(contentType?: MatroskaContentType): string {
		const codecs: string[] = [];
		if (contentType === undefined || contentType === "video") {
			const video = this.tracks.get("video");
			if (video) {
				codecs.push(video.info.codecs);
			}
		}
		if (contentType === undefined || contentType === "audio") {
			const audio = this.tracks.get("audio");
			if (audio) {
				codecs.push(audio.info.codecs);
			}
		}
		return `video/mp4; codecs="${codecs.join(", ")}"`;
	}

	public initSegment(contentType: MatroskaContentType): Uint8Array {
		const cached = this.initSegments.get(contentType);
		if (cached !== undefined) {
			return cached;
		}
		const track = this.tracks.get(contentType);
		if (track === undefined) {
			throw new Error(`Track not found: ${contentType}`);
		}
		const timeScale = Math.round(1e9 / this.info.timestampScale);
		const init = m.ArrayBuilder.concat(
			m.ftyp({
				majorBrand: "isom",
				minorVersion: 0,
				compatibleBrands: [
					"isom", "iso2", "iso6", "mp41", "mp42",
					...(track.info.codecs.startsWith("avc1") ? ["avc1"] : []),
				],
			}),
			m.moov(
				m.mvhd({
					timeScale,
					duration: this.info.durationTicks,
					nextTrackId: track.mp4TrackId + 1,
				}),
				track.trak,
				m.mvex(
					m.trex({
						trackId: track.mp4TrackId,
						defaultSampleDescriptionIndex: 1,
					}),
				),
			),
		).valueOf();
		this.initSegments.set(contentType, init);
		return init;
	}

	public async mux(data: Uint8Array, options: MatroskaMuxOptions): Promise<Uint8Array> {
		const track = this.tracks.get(options.contentType);
		if (track === undefined) {
			throw new Error(`Track not found: ${options.contentType}`);
		}
		const endTicks = Math.round(options.endTime * 1e9 / this.info.timestampScale);
		const stream = new ebml.Stream(new Blob([data]));
		const clusters: mkve.Cluster[] = [];
		for await (const element of stream.children) {
			if (element.id.id === mkve.Cluster.id) {
				clusters.push(new mkve.Cluster(element, undefined as unknown as mkve.Segment));
			}
		}

		const fragments: Uint8Array[] = [];
		for (let i = 0; i < clusters.length; i++) {
			const cluster = clusters[i];
			const nextCluster = clusters[i + 1];
			const fragment = await this.muxCluster(track, cluster, nextCluster, endTicks, options.sequenceNumber);
			if (fragment !== undefined) {
				fragments.push(fragment);
			}
		}
		return m.ArrayBuilder.concat(...fragments).valueOf();
	}

	private async muxCluster(
		track: SegmentTrack,
		cluster: mkve.Cluster,
		nextCluster: mkve.Cluster | undefined,
		endTicks: number,
		sequenceNumber: number | undefined,
	): Promise<Uint8Array | undefined> {
		const clusterTimestamp = await cluster.timestamp;
		const nextBoundary = nextCluster === undefined ?
			endTicks - clusterTimestamp :
			(await nextCluster.timestamp) - clusterTimestamp + await this.minTimestamp(nextCluster, track.info.number);

		const blocks: mkve.SimpleBlock[] = [];
		for await (const block of cluster.simpleBlocks) {
			if (await block.trackNumber === track.info.number) {
				// Negative timestamps are codec priming (typically AAC). Dropping
				// them aligns the first real audio sample with the presentation.
				if (track.info.type === "audio" && await block.timestamp < 0) {
					continue;
				}
				blocks.push(block);
			}
		}
		if (blocks.length === 0) {
			return undefined;
		}

		const ptses: number[] = [];
		for (const block of blocks) {
			ptses.push(await block.timestamp);
		}
		const dtses = [...ptses, nextBoundary];
		for (let i = dtses.length - 2; i >= 0; i--) {
			dtses[i] = Math.min(dtses[i], dtses[i + 1]);
		}
		for (let i = 1; i < dtses.length; i++) {
			dtses[i] = Math.max(dtses[i], dtses[i - 1] + 1);
		}

		const samples: m.TRUN["samples"] = [];
		const dataParts: m.ArrayBuilderPart[] = [];
		for (let i = 0; i < blocks.length; i++) {
			const block = blocks[i];
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
			const videoFrameDuration = this.toTrackTime(duration, track);
			const frameDuration = track.info.type === "audio" ?
				1024 :
				Math.floor(videoFrameDuration / frames.length);
			const lastFrameDuration = track.info.type === "audio" ?
				1024 :
				videoFrameDuration - frameDuration * (frames.length - 1);
			for (let j = 0; j < frames.length; j++) {
				let frameData = frames[j];
				if (track.info.contentEncodings !== undefined) {
					frameData = new Uint8Array(await track.info.contentEncodings.decode(frameData.buffer as ArrayBuffer));
				}
				dataParts.push(frameData);
				samples.push({
					duration: j === frames.length - 1 ? lastFrameDuration : frameDuration,
					size: frameData.byteLength,
					compositionTimeOffset: track.info.type === "audio" ?
						0 :
						this.toTrackTime(pts - dts, track),
					sampleFlags: {
						dependsOn: keyframe ? 2 : 1,
						isNonSyncSample: keyframe ? 0 : 1,
					},
				});
			}
		}

		const sequence = sequenceNumber ?? this.sequenceNumber++;
		const baseMediaDecodeTime = Math.max(0, this.toTrackTime(clusterTimestamp + dtses[0], track));
		const traf = (offset: number) => m.traf(
			m.tfhd({ trackId: track.mp4TrackId }),
			m.tfdt({ baseMediaDecodeTime }),
			m.trun({ dataOffset: offset, samples }),
		);
		const moofSize = m.moof(m.mfhd({ sequenceNumber: sequence }), traf(0)).byteLength;
		const moof = m.moof(m.mfhd({ sequenceNumber: sequence }), traf(moofSize + 8));
		const mdat = m.mdat(m.ArrayBuilder.concat(...dataParts));
		return m.ArrayBuilder.concat(moof, mdat).valueOf();
	}

	private async minTimestamp(cluster: mkve.Cluster, trackNumber: number): Promise<number> {
		let min = Infinity;
		for await (const block of cluster.simpleBlocks) {
			if (await block.trackNumber === trackNumber) {
				min = Math.min(min, await block.timestamp);
			}
		}
		return min === Infinity ? 0 : min;
	}

	private toTrackTime(ticks: number, track: SegmentTrack): number {
		return Math.round(ticks * this.info.timestampScale * track.timescale / 1e9);
	}

	private buildTrak(info: MatroskaTrackInfo, mp4TrackId: number, timescale: number, duration: number): m.ArrayBuilder {
		if (info.type === "video") {
			const width = info.width ?? 0;
			const height = info.height ?? 0;
			const codecPrivate = info.codecPrivate.buffer as ArrayBuffer;
			return m.trak(
				m.tkhd({ trackId: mp4TrackId, width, height }),
				m.mdia(
					m.mdhd({ timeScale: timescale, duration }),
					m.hdlr({ handlerType: "vide", handlerName: "VideoHandler" }),
					m.minf(
						m.vmhd({}),
						m.dinf(m.dref(m.url())),
						m.stbl(
							m.stsd(
								info.codecs.startsWith("hvc1") ?
									m.hvc1({ width, height }, m.hvcc(new Uint8Array(codecPrivate))) :
									m.avc1({ width, height }, m.avcc(new Uint8Array(codecPrivate))),
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
			m.tkhd({ trackId: mp4TrackId }),
			m.mdia(
				m.mdhd({ timeScale: timescale, duration }),
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
								m.esds({ codecPrivate: info.codecPrivate }),
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
