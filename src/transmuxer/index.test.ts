import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MatroskaSegmentMuxer } from "./segment-muxer.js";
import { parseMatroskaInfo, readMatroskaSegment } from "./metadata.js";
import { buildMatroskaSegmentIndex } from "./segments.js";

let file: Blob;

beforeAll(async () => {
	const dir = await mkdtemp(join(tmpdir(), "jsmkv-transmuxer-"));
	const output = join(dir, "test.mkv");
	const ffmpegCommand = [
		"ffmpeg",
		"-y",
		"-f", "lavfi",
		"-i", "testsrc=duration=2:size=160x120:rate=30",
		"-f", "lavfi",
		"-i", "sine=frequency=440:duration=2",
		"-c:v", "libx264",
		"-g", "15",
		"-c:a", "aac",
		"-b:v", "200k",
		"-b:a", "64k",
		"-cluster_time_limit", "500",
		"-f", "matroska",
		output,
	];
	const proc = Bun.spawn(ffmpegCommand, {
		stderr: "ignore",
		stdout: "ignore",
	});
	await proc.exited;
	file = new Blob([await Bun.file(output).arrayBuffer()]);
	await rm(dir, { recursive: true, force: true });
	if (file.size === 0) {
		throw new Error("File is empty");
	}
});

function boxType(data: Uint8Array, offset: number): string {
	return String.fromCharCode(...data.subarray(offset + 4, offset + 8));
}

describe("Transmuxer Tests", () => {
	test("parses tracks and codecs", async () => {
		const segment = await readMatroskaSegment(file);
		const info = await parseMatroskaInfo(segment);
		expect(info.duration).toBeGreaterThan(1);
		expect(info.tracks.some((track) => track.type === "video" && track.codecs.startsWith("avc1"))).toBe(true);
		expect(info.tracks.some((track) => track.type === "audio" && track.codecs === "mp4a.40.2")).toBe(true);
	});

	test("builds a segment index from Cues", async () => {
		const segment = await readMatroskaSegment(file);
		const info = await parseMatroskaInfo(segment);
		const index = await buildMatroskaSegmentIndex(file, segment, info);
		expect(index.segments.length).toBeGreaterThan(0);
		expect(index.initEnd).toBeGreaterThanOrEqual(index.initStart);
		for (const entry of index.segments) {
			expect(entry.startByte).toBeLessThan(entry.endByte);
			expect(entry.endByte).toBeLessThan(file.size);
			expect(entry.startTime).toBeLessThan(entry.endTime);
		}
	});

	test("muxes a Cluster into a single-track fragment", async () => {
		const segment = await readMatroskaSegment(file);
		const info = await parseMatroskaInfo(segment);
		const index = await buildMatroskaSegmentIndex(file, segment, info);
		const first = index.segments[0];
		const input = new Uint8Array(await file.slice(first.startByte, first.endByte + 1).arrayBuffer());
		const muxer = new MatroskaSegmentMuxer(info);

		const init = muxer.initSegment("video");
		expect(boxType(init, 0)).toBe("ftyp");
		const data = await muxer.mux(input, {
			contentType: "video",
			endTime: first.endTime,
		});
		expect(boxType(data, 0)).toBe("moof");
	});
});
