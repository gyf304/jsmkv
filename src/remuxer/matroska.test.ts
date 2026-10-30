import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as ebml from "../ebml/index.js";
import { Segment } from "../matroska/elements/index.js";
import { File } from "../matroska/index.js";
import { MatroskaTrackRemuxer } from "./matroska.js";

let segment: Segment;

beforeAll(async () => {
	const dir = await mkdtemp(join(tmpdir(), "jsmkv-webm-"));
	const output = join(dir, "test.mkv");
	const proc = Bun.spawn([
		"ffmpeg",
		"-y",
		"-f", "lavfi",
		"-i", "sine=frequency=440:duration=4",
		"-c:a", "libopus",
		"-b:a", "64k",
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

describe("MatroskaTrackRemuxer", () => {
	test("extracts a single Opus track as WebM", async () => {
		const tracks = await segment.tracks;
		if (tracks === undefined) {
			throw new Error("Tracks not found");
		}
		let entry;
		for await (const candidate of tracks.tracks) {
			if (await candidate.trackType === "audio") {
				entry = candidate;
				break;
			}
		}
		if (entry === undefined) {
			throw new Error("Audio track not found");
		}
		const mimeType = await MatroskaTrackRemuxer.webmMimeType(entry);
		expect(mimeType).toBe('audio/webm; codecs="opus"');
		const remuxer = await MatroskaTrackRemuxer.create(
			entry,
			mimeType!,
			"webm",
		);
		if (remuxer === undefined) {
			throw new Error("Remuxer not created");
		}
		expect(remuxer.sourceMimeType).toBe("audio/x-matroska");
		expect([...new Uint8Array(remuxer.initSegment).subarray(0, 4)])
			.toEqual([0x1a, 0x45, 0xdf, 0xa3]);

		const chunks: ArrayBuffer[] = [];
		for await (const cluster of segment.clusters) {
			chunks.push(await cluster.element.toBlobLike().arrayBuffer());
			if (chunks.length >= 2) {
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
			expect([...fragment.subarray(0, 4)])
				.toEqual([0x1f, 0x43, 0xb6, 0x75]);
		}
	});
});
