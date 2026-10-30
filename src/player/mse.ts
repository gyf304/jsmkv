import type { AudioTrack, VideoTrack } from "media-tracks";
import * as mkve from "../matroska/elements/index.js";
import { MatroskaTrackToFMP4Remuxer } from "../remuxer/index.js";
import type { PlayerMediaTrack, Track } from "./types.js";

export class MseTrack implements Track<VideoTrack | AudioTrack> {
	public static readonly supports = [
		{ codecType: "video", codecId: "V_MPEG4/ISO/AVC" },
		{ codecType: "video", codecId: "V_MPEGH/ISO/HEVC" },
		{ codecType: "audio", codecId: "A_AAC" },
		{ codecType: "audio", codecId: "A_OPUS" },
		{ codecType: "audio", codecId: "A_FLAC" },
	] as const;

	public static mimeType(
		entry: mkve.TrackEntry,
	): Promise<string | undefined> {
		return MatroskaTrackToFMP4Remuxer.mimeType(entry);
	}

	public static async create(
		entry: mkve.TrackEntry,
		sink: VideoTrack | AudioTrack,
	): Promise<MseTrack> {
		const remuxer = await MatroskaTrackToFMP4Remuxer.create(entry);
		if (remuxer === undefined) {
			throw new Error("Unsupported media track");
		}
		const mediaTrack = sink;
		const sourceBuffer = mediaTrack.sourceBuffer;
		if (sourceBuffer === undefined) {
			throw new Error("Media track has no SourceBuffer");
		}
		return new MseTrack(remuxer, mediaTrack, sourceBuffer, entry);
	}

	private operations: Promise<void> = Promise.resolve();
	private initialized = false;

	private constructor(
		private readonly remuxer: MatroskaTrackToFMP4Remuxer,
		public readonly sink: VideoTrack | AudioTrack,
		private readonly sourceBuffer: SourceBuffer,
		private readonly entry: mkve.TrackEntry,
	) {}

	public add(cluster: mkve.Cluster): Promise<void> {
		return this.enqueue(async () => {
			if (!this.isSelected()) {
				if (this.initialized && this.sourceBuffer.buffered.length > 0) {
					await this.clear(0, await this.duration());
				}
				return;
			}
			if (!this.initialized) {
				await this.append(this.remuxer.initSegment);
				this.initialized = true;
			}
			const data = await clusterData(cluster);
			async function* input(): AsyncGenerator<ArrayBuffer> {
				yield data;
			}
			for await (const fragment of this.remuxer.remux(input())) {
				await this.append(fragment);
			}
		});
	}

	public remove(start: number, end: number): Promise<void> {
		return this.enqueue(async () => {
			const duration = await this.duration();
			if (end >= duration) {
				this.remuxer.reset();
			}
			await this.clear(start, end);
		});
	}

	private isSelected(): boolean {
		return this.remuxer.targetMimeType.startsWith("audio/") ?
			(this.sink as AudioTrack).enabled :
			(this.sink as VideoTrack).selected;
	}

	private enqueue(operation: () => Promise<void>): Promise<void> {
		const result = this.operations.then(() => operation());
		this.operations = result.then(() => {}, () => {});
		return result;
	}

	private async duration(): Promise<number> {
		const info = await this.entry.parent.parent.info;
		return (await info.duration) *
			(await info.timestampScale) / 1e9;
	}

	private async clear(start: number, end: number): Promise<void> {
		if (!this.initialized) {
			return;
		}
		const duration = await this.duration();
		const from = Math.max(0, Math.min(start, duration));
		const to = Math.max(from, Math.min(end, duration));
		if (to <= from) {
			return;
		}
		const buffered = this.sourceBuffer.buffered;
		let intersects = false;
		for (let i = 0; i < buffered.length; i++) {
			if (buffered.start(i) < to && buffered.end(i) > from) {
				intersects = true;
				break;
			}
		}
		if (!intersects) {
			return;
		}
		await this.waitForUpdate();
		this.sourceBuffer.remove(from, to);
		await this.waitForUpdate();
	}

	private async append(data: ArrayBuffer): Promise<void> {
		await this.waitForUpdate();
		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				this.sourceBuffer.removeEventListener("updateend", onEnd);
				this.sourceBuffer.removeEventListener("error", onError);
			};
			const onEnd = () => {
				cleanup();
				resolve();
			};
			const onError = () => {
				cleanup();
				reject(new Error("Failed to append media segment"));
			};
			this.sourceBuffer.addEventListener("updateend", onEnd);
			this.sourceBuffer.addEventListener("error", onError);
			try {
				this.sourceBuffer.appendBuffer(data);
			} catch (error) {
				cleanup();
				reject(error);
			}
		});
	}

	private waitForUpdate(): Promise<void> {
		if (!this.sourceBuffer.updating) {
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			const onEnd = () => {
				this.sourceBuffer.removeEventListener("updateend", onEnd);
				resolve();
			};
			this.sourceBuffer.addEventListener("updateend", onEnd);
		});
	}
}

async function clusterData(cluster: mkve.Cluster): Promise<ArrayBuffer> {
	const id = cluster.element.id.bytes;
	const size = cluster.element.dataSize.bytes;
	const payload = new Uint8Array(await cluster.element.data.arrayBuffer());
	const data = new Uint8Array(id.length + size.length + payload.length);
	data.set(id, 0);
	data.set(size, id.length);
	data.set(payload, id.length + size.length);
	return data.buffer as ArrayBuffer;
}
