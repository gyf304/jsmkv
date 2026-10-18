import { parseMatroskaInfoFromSource, MatroskaSegmentMuxer } from "../transmuxer/index.js";
import type { MatroskaInfo } from "../transmuxer/metadata.js";
import type { MatroskaContentType } from "../transmuxer/segment-muxer.js";
import type {
	ShakaSegmentReference,
	ShakaStream,
	ShakaTransmuxer,
	ShakaTransmuxerOutput,
} from "./types.js";

const MATROSKA_MIME_TYPE = "video/x-matroska";

export class MatroskaShakaTransmuxer implements ShakaTransmuxer {
	private muxer: MatroskaSegmentMuxer | undefined;
	private initSent = false;

	constructor(
		private readonly infoCache?: Map<string, MatroskaInfo>,
	) {}

	public destroy(): void {
		this.muxer = undefined;
		this.initSent = false;
	}

	public isSupported(mimeType: string, contentType?: string): boolean {
		const base = mimeType.toLowerCase().split(";")[0].trim();
		if (base !== MATROSKA_MIME_TYPE && base !== "audio/x-matroska") {
			return false;
    }
    const MediaSource = window.MediaSource ?? (window as any).ManagedMediaSource;
		if (typeof MediaSource === "undefined") {
			return false;
		}
		const types: MatroskaContentType[] = [];
		if (contentType !== undefined) {
			types.push(this.contentType(contentType));
		} else {
			const codecs = this.extractCodecs(mimeType);
			if (codecs.some((codec) => this.isAudioCodec(codec))) {
				types.push("audio");
			}
			if (codecs.some((codec) => this.isVideoCodec(codec))) {
				types.push("video");
			}
			if (types.length === 0) {
				types.push("video", "audio");
			}
		}
		return types.some((type) => MediaSource.isTypeSupported(this.convertCodecs(type, mimeType)));
	}

	public convertCodecs(contentType: string, mimeType: string): string {
		const type = this.contentType(contentType);
		const codecs = this.extractCodecs(mimeType);
		if (type === "audio") {
			const audio = codecs.find((codec) => this.isAudioCodec(codec));
			return `audio/mp4${audio === undefined ? "" : `; codecs="${audio}"`}`;
		}
		const video = codecs.find((codec) => this.isVideoCodec(codec));
		return `video/mp4${video === undefined ? "" : `; codecs="${video}"`}`;
	}

	public getOriginalMimeType(): string {
		return MATROSKA_MIME_TYPE;
	}

	public async transmux(
		data: ArrayBuffer | ArrayBufferView,
		_stream: ShakaStream,
		reference: ShakaSegmentReference | null,
		duration: number,
		contentType: string,
	): Promise<Uint8Array | ShakaTransmuxerOutput> {
		const bytes = data instanceof Uint8Array ?
			data :
			ArrayBuffer.isView(data) ?
				new Uint8Array(data.buffer, data.byteOffset, data.byteLength) :
				new Uint8Array(data);
		const type = this.contentType(contentType);

		if (reference === null) {
			const info = await parseMatroskaInfoFromSource(new Blob([bytes]));
			this.muxer = new MatroskaSegmentMuxer(info);
			this.initSent = true;
			return {
				data: this.muxer.initSegment(type),
				init: null,
			};
		}

		if (this.muxer === undefined) {
			const info = await this.loadInfo(reference.getUris()[0]);
			this.muxer = new MatroskaSegmentMuxer(info);
		}

		const output = await this.muxer.mux(bytes, {
			contentType: type,
			endTime: reference.getEndTime(),
		});
		const init = this.initSent ? null : this.muxer.initSegment(type);
		this.initSent = true;
		return {
			data: output,
			init,
		};
	}

	private async loadInfo(uri: string): Promise<MatroskaInfo> {
		const cached = this.infoCache?.get(uri);
		if (cached !== undefined) {
			return cached;
		}
		throw new Error(
			`Matroska metadata for ${uri} is not available. ` +
			"Metadata must be loaded by the manifest parser before transmuxing.");
	}

	private contentType(contentType: string): MatroskaContentType {
		return contentType.toLowerCase().includes("audio") ? "audio" : "video";
	}

	private isAudioCodec(codec: string): boolean {
		return codec.startsWith("mp4a") ||
			codec.startsWith("opus") ||
			codec.startsWith("ac-3") ||
			codec.startsWith("ec-3");
	}

	private isVideoCodec(codec: string): boolean {
		return codec.startsWith("avc1") ||
			codec.startsWith("hvc1") ||
			codec.startsWith("hev1") ||
			codec.startsWith("av01");
	}

	private extractCodecs(mimeType: string): string[] {
		const match = /codecs="([^"]*)"/i.exec(mimeType) ?? /codecs=([^;]+)/i.exec(mimeType);
		if (match === null) {
			return [];
		}
		return match[1].split(",").map((codec) => codec.trim()).filter((codec) => codec.length > 0);
	}
}
