import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as ebml from "../ebml/index.js";
import { Segment } from "../matroska/elements/index.js";
import { File } from "../matroska/index.js";
import { MatroskaTrackToFMP4Remuxer } from "./matroska.js";

let segment: Segment;

beforeAll(async () => {
	const dir = await mkdtemp(join(tmpdir(), "jsmkv-remuxer-"));
	const output = join(dir, "test.mkv");
	const proc = Bun.spawn([
		"ffmpeg",
		"-y",
		"-f", "lavfi",
		"-i", "testsrc=duration=3:size=160x120:rate=30",
		"-f", "lavfi",
		"-i", "sine=frequency=440:duration=3",
		"-c:v", "libx264",
		"-g", "60",
		"-c:a", "aac",
		"-b:v", "200k",
		"-b:a", "64k",
		"-cluster_time_limit", "500",
		"-f", "matroska",
		output,
	], {
		stderr: "ignore",
		stdout: "ignore",
	});
	await proc.exited;
	const bytes = await Bun.file(output).arrayBuffer();
	await rm(dir, { recursive: true, force: true });
	if (bytes.byteLength === 0) {
		throw new Error("File is empty");
	}
	const mkv = new File(new ebml.Stream(new Blob([bytes])));
	segment = await mkv.one(Segment);
});

function boxType(data: Uint8Array): string {
	return String.fromCharCode(...data.subarray(4, 8));
}

describe("MatroskaTrackToFMP4Remuxer", () => {
	test("remuxes video and audio tracks", async () => {
		const tracks = await segment.tracks;
		if (tracks === undefined) {
			throw new Error("Tracks not found");
		}
		let count = 0;
		for await (const entry of tracks.tracks) {
			const remuxer = await MatroskaTrackToFMP4Remuxer.create(entry);
			if (remuxer === undefined) {
				continue;
			}
			count++;
			expect(remuxer.sourceMimeType).toMatch(/^(video|audio)\/x-matroska$/);
			expect(remuxer.targetMimeType).toMatch(/^(video|audio)\/mp4/);
			expect(boxType(new Uint8Array(remuxer.initSegment))).toBe("ftyp");

			const chunks: ArrayBuffer[] = [];
			for await (const cluster of segment.clusters) {
				const start = cluster.element.offset - segment.element.dataOffset;
				chunks.push(await segment.element.data.slice(
					start,
					start + cluster.element.size,
				).arrayBuffer());
				if (chunks.length >= 3) {
					break;
				}
			}

			async function* source(): AsyncGenerator<ArrayBuffer> {
				for (const chunk of chunks) {
					yield chunk;
				}
			}

			const fragments: Uint8Array[] = [];
			for await (const fragment of remuxer.remux(source())) {
				fragments.push(new Uint8Array(fragment));
			}
			expect(fragments.length).toBeGreaterThan(0);
			for (const fragment of fragments) {
				expect(boxType(fragment)).toBe("moof");
			}
		}
		expect(count).toBe(2);
	});
});
