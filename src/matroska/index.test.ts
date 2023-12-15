import { beforeAll, describe, expect, test } from "bun:test";

import * as matroska from ".";
import * as ebml from "../ebml";

let file: Blob;

beforeAll(async () => {
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
		"-f", "matroska",
		"pipe:1",
	];
	const { stdout } = Bun.spawn(ffmpegCommand, {
		stderr: "ignore",
		stdout: "pipe",
	});
	file = await Bun.readableStreamToBlob(stdout);
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
		expect(xml).toMatch(/<Cluster/);
	});
});
