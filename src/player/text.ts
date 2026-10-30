import * as mkve from "../matroska/elements/index.js";
import type { PlayerMediaTrack, Track } from "./types.js";

type TextMimeType = "text/srt" | "text/vtt";

interface TextBlock {
	timestamp: number;
	duration?: number;
	frames: AsyncGenerator<Uint8Array>;
}

export class TextPlayerTrack implements Track<TextTrack> {
	public static readonly supports = [
		{ codecType: "subtitle", codecId: "S_TEXT/UTF8" },
		{ codecType: "subtitle", codecId: "S_TEXT/ASCII" },
		{ codecType: "subtitle", codecId: "S_TEXT/WEBVTT" },
	] as const;

	public static async mimeType(
		entry: mkve.TrackEntry,
	): Promise<string | undefined> {
		return textMimeType(await entry.codecID);
	}

	public static async create(
		entry: mkve.TrackEntry,
		sink: TextTrack,
	): Promise<TextPlayerTrack> {
		return new TextPlayerTrack(entry, sink as TextTrack);
	}

	private constructor(
		private readonly entry: mkve.TrackEntry,
		public readonly sink: TextTrack,
	) {}

	public async add(cluster: mkve.Cluster): Promise<void> {
		const trackNumber = await this.entry.trackNumber;
		const contentEncodings = await this.entry.maybeOne(mkve.ContentEncodings);
		const info = await this.entry.parent.parent.info;
		const blocks: TextBlock[] = [];
		const clusterTimestamp = await cluster.timestamp;
		for await (const child of cluster.children) {
			let block: mkve.SimpleBlock | undefined;
			let duration: number | undefined;
			if (child instanceof mkve.SimpleBlock) {
				block = child;
			} else if (child instanceof mkve.BlockGroup) {
				block = await child.block;
				duration = await child.duration;
			}
			if (block === undefined || await block.trackNumber !== trackNumber) {
				continue;
			}
			blocks.push({
				timestamp: clusterTimestamp + await block.timestamp,
				duration,
				frames: block.frames,
			});
		}
		blocks.sort((a, b) => a.timestamp - b.timestamp);

		const scale = (await info.timestampScale) / 1e9;
		for (let i = 0; i < blocks.length; i++) {
			const block = blocks[i];
			const startTime = block.timestamp * scale;
			const endTime = block.duration !== undefined ?
				startTime + block.duration * scale :
				i + 1 < blocks.length ?
					blocks[i + 1].timestamp * scale :
					startTime + Math.max(
						0.001,
						i > 0 ? startTime - blocks[i - 1].timestamp * scale : 1,
					);
			for await (const frame of block.frames) {
				const data = contentEncodings === undefined ?
					frame :
					new Uint8Array(await contentEncodings.decode(toArrayBuffer(frame)));
				const text = this.format(textDecoder.decode(data));
				if (text.length === 0) {
					continue;
				}
				const cue = new VTTCue(
					startTime,
					Math.max(startTime + 0.001, endTime),
					text,
				);
				this.sink.addCue(cue);
			}
		}
	}

	public async remove(start: number, end: number): Promise<void> {
		const cues = this.sink.cues;
		if (cues === null) {
			return;
		}
		for (let i = cues.length - 1; i >= 0; i--) {
			const cue = cues[i];
			if (cue.startTime >= start && cue.endTime <= end) {
				this.sink.removeCue(cue);
			}
		}
	}

	private format(text: string): string {
		return text.replace(/\r\n?/g, "\n").trim();
	}
}

const textDecoder = new TextDecoder();

function textMimeType(codecID: string): TextMimeType | undefined {
	switch (codecID) {
		case "S_TEXT/UTF8":
		case "S_TEXT/ASCII":
			return "text/srt";
		case "S_TEXT/WEBVTT":
			return "text/vtt";
	}
	return undefined;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
	return data.buffer.slice(
		data.byteOffset,
		data.byteOffset + data.byteLength,
	) as ArrayBuffer;
}
