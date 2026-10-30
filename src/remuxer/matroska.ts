import { ConcatBlobLike } from "../bloblike/concat.js";
import * as ebml from "../ebml/index.js";
import * as mkve from "../matroska/elements/index.js";
import type { Remuxer } from "./types.js";

export class MatroskaTrackRemuxer implements Remuxer {
	public static async webmMimeType(
		entry: mkve.TrackEntry,
	): Promise<string | undefined> {
		const type = await entry.trackType;
		if (type === "audio" && await entry.codecID === "A_OPUS") {
			return 'audio/webm; codecs="opus"';
		}
		return undefined;
	}

	public static async create(
		entry: mkve.TrackEntry,
		targetMimeType: string,
		docType: "webm" | "matroska" = "webm",
	): Promise<MatroskaTrackRemuxer | undefined> {
		const type = await entry.trackType;
		if (type !== "video" && type !== "audio") {
			return undefined;
		}
		const info = await entry.segment.info;
		const timestampScale = await info.timestampScale;
		const durationTicks = await info.duration;
		const header = new ebml.EBMLHead(
			new ebml.EBMLVersion(1),
			new ebml.EBMLReadVersion(1),
			new ebml.EBMLMaxIDLength(4),
			new ebml.EBMLMaxSizeLength(8),
			new ebml.DocType(docType),
			new ebml.DocTypeVersion(4),
			new ebml.DocTypeReadVersion(2),
		);
		const infoElement = new mkve.Info(
			new mkve.TimestampScale(timestampScale),
			new mkve.MuxingApp("jsmkv"),
			new mkve.WritingApp("jsmkv"),
			new mkve.Duration(durationTicks),
		);
		const tracksElement = new mkve.Tracks(entry);
		const segment = new mkve.Segment(
			[infoElement, tracksElement],
			{ unknownSize: true },
		);
		const init = await new ConcatBlobLike([
			header.toBlobLike(),
			segment.toBlobLike(),
		]).arrayBuffer();
		return new MatroskaTrackRemuxer(
			entry,
			`${type}/x-matroska`,
			targetMimeType,
			init,
		);
	}

	private constructor(
		private readonly entry: mkve.TrackEntry,
		public readonly sourceMimeType: string,
		public readonly targetMimeType: string,
		public readonly initSegment: ArrayBuffer,
	) {}

	public async *remux(
		segments: AsyncIterable<ArrayBuffer>,
		signal?: AbortSignal,
	): AsyncIterable<ArrayBuffer> {
		const trackNumber = await this.entry.trackNumber;
		for await (const data of segments) {
			if (signal?.aborted) {
				return;
			}
			const element = await ebml.Element.fromBlobLike(new Blob([data]));
			if (element.id.id !== mkve.Cluster.id) {
				continue;
			}
			const cluster = new mkve.Cluster(element);
			const children: ebml.SchemaElement[] = [];
			for await (const child of cluster.children) {
				if (child instanceof mkve.Timestamp) {
					children.push(child);
				} else if (child instanceof mkve.SimpleBlock) {
					if (await child.trackNumber === trackNumber) {
						children.push(child);
					}
				} else if (child instanceof mkve.BlockGroup) {
					const block = await child.block;
					if (block !== undefined &&
						await block.trackNumber === trackNumber) {
						children.push(child);
					}
				}
			}
			if (children.length > 1) {
				yield await new mkve.Cluster(...children).toBlobLike().arrayBuffer();
			}
		}
	}
}
