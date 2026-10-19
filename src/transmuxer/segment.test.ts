import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as ebml from "../ebml/index.js";
import { File } from "../matroska/index.js";
import { Segment } from "../matroska/elements/index.js";
import { Transmuxer } from "./segment.js";

let segment: Segment;

beforeAll(async () => {
	const dir = await mkdtemp(join(tmpdir(), "jsmkv-transmuxer-"));
	const output = join(dir, "test.mkv");
	const subtitle = join(dir, "test.srt");
	const attachment = join(dir, "attachment.txt");
	await Bun.write(subtitle, [
		"1",
		"00:00:00,000 --> 00:00:01,000",
		"Hello",
		"",
		"2",
		"00:00:01,000 --> 00:00:02,000",
		"World",
		"",
	].join("\n"));
	await Bun.write(attachment, "jsmkv attachment");
	const proc = Bun.spawn([
		"ffmpeg",
		"-y",
		"-f", "lavfi",
		"-i", "testsrc=duration=2:size=160x120:rate=30",
		"-f", "lavfi",
		"-i", "sine=frequency=440:duration=2",
		"-i", subtitle,
		"-map", "0:v:0",
		"-map", "1:a:0",
		"-map", "2:s:0",
		"-c:v", "libx264",
		"-g", "60",
		"-c:a", "aac",
		"-c:s", "srt",
		"-attach", attachment,
		"-metadata:s:t", "mimetype=text/plain",
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

describe("transmuxer", () => {
	test("builds track init segments and fragments", async () => {
		const transmuxer = await Transmuxer.from(segment);
		expect(transmuxer.info.duration).toBeGreaterThan(1);
		const tracks = transmuxer.tracks.filter((track) => track.info.type !== "text");
		expect(tracks.length).toBeGreaterThan(0);

		for (const track of tracks) {
			expect(track.init.byteLength).toBeGreaterThan(0);
			expect(boxType(track.init)).toBe("ftyp");
			expect(track.cuePoints.length).toBeGreaterThan(0);
		}

		const fragments: Uint8Array[] = [];
		for await (const fragment of tracks[0].cuePoints[0].streamFragments()) {
			fragments.push(fragment);
		}
		expect(fragments.length).toBe(1);
		expect(boxType(fragments[0])).toBe("moof");
	});

	test("extracts attachments", async () => {
		const transmuxer = await Transmuxer.from(segment);
		expect(transmuxer.attachments).toHaveLength(1);
		const attachment = transmuxer.attachments[0];
		expect(attachment.name).toBe("attachment.txt");
		expect(attachment.mediaType).toBe("text/plain");
		expect(attachment.description).toBeUndefined();
		expect(new TextDecoder().decode(await attachment.data.arrayBuffer())).toBe("jsmkv attachment");
		expect(typeof attachment.uid).toBe("number");
	});

	test("extracts text tracks", async () => {
		const transmuxer = await Transmuxer.from(segment);
		const textTrack = transmuxer.tracks.find((track) => track.info.type === "text");
		if (textTrack === undefined || textTrack.info.type !== "text") {
			throw new Error("Text track not found");
		}
		expect(textTrack.info.mimeType).toBe("text/srt");
		expect(textTrack.cuePoints.length).toBeGreaterThan(0);

		const fragments: string[] = [];
		for await (const fragment of textTrack.cuePoints[0].streamFragments()) {
			fragments.push(new TextDecoder().decode(fragment));
		}
		expect(fragments.join("")).toContain("Hello");
	});
});
