import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as matroska from ".";
import { Segment } from "./elements/index.js";
import * as ebml from "../ebml/index.js";

let file: Blob;

beforeAll(async () => {
	const attachmentDir = await mkdtemp(join(tmpdir(), "jsmkv-test-"));
	const attachmentPath = join(attachmentDir, "attachment.txt");
	await Bun.write(attachmentPath, "jsmkv attachment");

	const ffmpegCommand = [
		"ffmpeg",
		"-f", "lavfi",
		"-i", "testsrc=duration=10:size=1280x720:rate=30",
		"-f", "lavfi",
		"-i", "sine=frequency=1000:duration=10",
		"-c:v", "libx264",
		"-c:a", "aac",
		"-b:v", "1M",
		"-b:a", "128k",
		"-attach", attachmentPath,
		"-metadata:s:t", "mimetype=text/plain",
		"-f", "matroska",
		"pipe:1",
	];
	const { stdout } = Bun.spawn(ffmpegCommand, {
		stderr: "ignore",
		stdout: "pipe",
	});
	file = await Bun.readableStreamToBlob(stdout);
	await rm(attachmentDir, { recursive: true, force: true });
	if (file.size === 0) {
		throw new Error("File is empty");
	}
});

describe("Matroska Tests", () => {
	test("creates a Matroska file", async () => {
		const doc = await new ebml.Stream(file);
		const mkv = new matroska.File(doc);
		expect(mkv).toBeInstanceOf(matroska.File);
	});

	test("can dump the Matroska file to XML", async () => {
		const doc = await new ebml.Stream(file);
		const mkv = new matroska.File(doc);
		const xml = await mkv.toXML();
		expect(xml).toMatch(/^<EBMLHead/);
		expect(xml).toMatch(/<Segment/);
		expect(xml).toMatch(/<Info/);
		expect(xml).toMatch(/<Attachments/);
		expect(xml).toMatch(/<Cluster/);
	});

	test("reads attachments", async () => {
		const mkv = new matroska.File(new ebml.Stream(file));
		const segment = await mkv.one(Segment);

		const attachments: {
			name: string;
			mediaType: string;
			description: string | undefined;
			data: string;
			uid: number;
		}[] = [];
		for await (const attachmentsElement of segment.attachments) {
			for await (const attachedFile of attachmentsElement.attachedFiles) {
				attachments.push({
					name: await attachedFile.fileName,
					mediaType: await attachedFile.fileMediaType,
					description: await attachedFile.fileDescription,
					data: new TextDecoder().decode(await attachedFile.fileData),
					uid: await attachedFile.fileUID,
				});
			}
		}

		expect(attachments).toHaveLength(1);
		expect(attachments[0]).toMatchObject({
			name: "attachment.txt",
			mediaType: "text/plain",
			description: undefined,
			data: "jsmkv attachment",
		});
		expect(typeof attachments[0].uid).toBe("number");
	});
});

describe("Matroska edge cases", () => {
	test("parses a headerless file with unknown-size segments and clusters", async () => {
		const bytes = new Uint8Array([
			0x18, 0x53, 0x80, 0x67, 0xff, // Segment, unknown size
			0x1f, 0x43, 0xb6, 0x75, 0xff, // Cluster 1, unknown size
			0xe7, 0x82, 0x00, 0x00, // Timestamp 0
			0x1f, 0x43, 0xb6, 0x75, 0xff, // Cluster 2, unknown size
			0xe7, 0x82, 0x00, 0x01, // Timestamp 1
		]);
		const mkv = new matroska.File(new ebml.Stream(new Blob([bytes])));
		const segments: Segment[] = [];
		for await (const segment of mkv.segments) {
			segments.push(segment);
		}
		expect(segments).toHaveLength(1);

		const timestamps: number[] = [];
		for await (const cluster of segments[0].seekClusters(0)) {
			timestamps.push(await cluster.timestamp);
		}
		expect(timestamps).toEqual([0, 1]);

		const allTimestamps: number[] = [];
		for await (const cluster of segments[0].clusters) {
			allTimestamps.push(await cluster.timestamp);
		}
		expect(allTimestamps).toEqual([0, 1]);
	});

	test("finds Cues by scanning when SeekHead is missing", async () => {
		const bytes = new Uint8Array([
			0x18, 0x53, 0x80, 0x67, 0x85, // Segment, size 5
			0x1c, 0x53, 0xbb, 0x6b, 0x80, // empty Cues
		]);
		const mkv = new matroska.File(new ebml.Stream(new Blob([bytes])));
		const segments: Segment[] = [];
		for await (const segment of mkv.segments) {
			segments.push(segment);
		}
		expect(segments).toHaveLength(1);
		expect(await segments[0].getCues(true)).toBeUndefined();
		expect(await segments[0].getCues()).toBeDefined();
	});

	test("splits Xiph-laced SimpleBlocks into frames", async () => {
		const bytes = new Uint8Array([
			0x18, 0x53, 0x80, 0x67, 0x96, // Segment, size 22
			0x1f, 0x43, 0xb6, 0x75, 0x91, // Cluster, size 17
			0xe7, 0x82, 0x00, 0x00, // Timestamp 0
			0xa3, 0x8b, 0x81, 0x00, 0x00, 0x82, // SimpleBlock, track 1, keyframe, Xiph lacing
			0x01, 0x03, // 2 frames, first frame size 3
			0x01, 0x02, 0x03, // frame 1
			0x04, 0x05, // frame 2
		]);
		const mkv = new matroska.File(new ebml.Stream(new Blob([bytes])));
		const segments: Segment[] = [];
		for await (const segment of mkv.segments) {
			segments.push(segment);
		}

		const frames: number[][] = [];
		for await (const cluster of segments[0].seekClusters(0)) {
			for await (const block of cluster.simpleBlocks) {
				for await (const frame of block.frames) {
					frames.push(Array.from(frame));
				}
			}
		}
		expect(frames).toEqual([[1, 2, 3], [4, 5]]);
	});
});
