import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Transmuxer } from "../transmuxer/segment.js";
import { getMatroskaSegment, sources } from "./manifest.js";
import { registerMatroskaScheme } from "./scheme.js";

let file: Blob;

beforeAll(async () => {
	const dir = await mkdtemp(join(tmpdir(), "jsmkv-shaka-"));
	const output = join(dir, "test.mkv");
	const attachment = join(dir, "attachment.txt");
	await Bun.write(attachment, "jsmkv attachment");
	const proc = Bun.spawn([
		"ffmpeg",
		"-y",
		"-f", "lavfi",
		"-i", "testsrc=duration=2:size=160x120:rate=30",
		"-f", "lavfi",
		"-i", "sine=frequency=440:duration=2",
		"-c:v", "libx264",
		"-g", "15",
		"-c:a", "aac",
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
	file = new Blob([await Bun.file(output).arrayBuffer()]);
	await rm(dir, { recursive: true, force: true });
	if (file.size === 0) {
		throw new Error("File is empty");
	}
});

type SchemeHandler = (uri: string, request: unknown) => Promise<{
	data: Uint8Array;
	headers: Record<string, string>;
}>;

let schemeHandler: SchemeHandler;

const shaka = {
	net: {
		NetworkingEngine: {
			registerScheme: (_: string, handler: SchemeHandler) => {
				schemeHandler = handler;
			},
			PluginPriority: { APPLICATION: 0 },
			RequestType: { SEGMENT: 0 },
		},
	},
	util: {
		AbortableOperation: { notAbortable: (operation: unknown) => operation },
	},
} as unknown as Parameters<typeof registerMatroskaScheme>[0];

registerMatroskaScheme(shaka);

describe("Matroska sources", () => {
	test("builds a transmuxer from the first segment", async () => {
		const segment = await getMatroskaSegment(file, 0);
		expect(segment).toBeDefined();
		const transmuxer = await Transmuxer.from(segment!);
		expect(transmuxer.tracks.some((track) => track.info.type === "video")).toBe(true);
		expect(transmuxer.tracks.some((track) => track.info.type === "audio")).toBe(true);
	});

	test("serves an attachment", async () => {
		const segment = await getMatroskaSegment(file, 0);
		const transmuxer = await Transmuxer.from(segment!);
		const id = crypto.randomUUID();
		sources.set(id, transmuxer);
		try {
			const response = await schemeHandler(`matroska://${id}/attachments/0`, {});
			expect(response.headers["Content-Type"]).toBe("text/plain");
			expect(new TextDecoder().decode(response.data)).toBe("jsmkv attachment");
		} finally {
			sources.delete(id);
		}
	});
});
