import { describe, expect, test } from "bun:test";
import shaka from "shaka-player";

import { AssTextParser } from "./parsers.js";

const encoder = new TextEncoder();
const time = {
	periodStart: 0,
	segmentStart: 0,
	segmentEnd: 2,
	vttOffset: 0,
	isMpegTs: false,
};

describe("AssTextParser", () => {
	test("parses init and dialogue lines", () => {
		const header = [
			"[Script Info]",
			"ScriptType: v4.00+",
			"",
			"[V4+ Styles]",
			"Format: Name, Fontname, Fontsize, PrimaryColour, BackColour, Bold, Italic, Underline, Alignment",
			"Style: Default,Arial,24,&H00FFFFFF,&H00000000,0,0,0,2",
			"",
			"[Events]",
			"Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
			"",
		].join("\n");
		const media = "Dialogue: 0,0:00:00.000,0:00:01.500,Default,,0,0,0,,Hello, world\\Nsecond line\n";
		const parser = new AssTextParser(shaka);
		parser.parseInit(encoder.encode(header));
		const cues = parser.parseMedia(
			encoder.encode(media),
			time,
			"matroska://id/tracks/3/segments/0.m4s",
			[],
		);
		expect(cues).toHaveLength(1);
		expect(cues[0].startTime).toBe(0);
		expect(cues[0].endTime).toBe(1.5);
		expect(cues[0].payload).toContain("Hello, world");
		expect(cues[0].payload).toContain("\n");
		expect(cues[0].fontFamily).toBe("Arial");
	});
});
