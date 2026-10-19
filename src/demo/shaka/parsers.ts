import type shaka from "shaka-player";

type ShakaNamespace = typeof import("shaka-player").default;

const textDecoder = new TextDecoder();

interface AssHeader {
	styles: Map<string, Record<string, string>>;
	eventsFormat: string[];
	isV4Plus: boolean;
}

export class AssTextParser implements shaka.extern.TextParser {
	private header?: AssHeader;

	constructor(private readonly shaka: ShakaNamespace) {}

	public parseInit(data: Uint8Array): void {
		this.header = parseAssHeader(textDecoder.decode(data));
	}

	public parseMedia(
		data: Uint8Array,
		_time: shaka.extern.TextParser.TimeContext,
		_uri: string | null,
		_images: string[],
	): shaka.text.Cue[] {
		const text = textDecoder.decode(data);
		const header = this.header ?? parseAssHeader(text);
		const lines = text.split(/\r?\n/);
		const columns = header.eventsFormat.length > 0 ?
			header.eventsFormat :
			["Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text"];
		const cues: shaka.text.Cue[] = [];
		for (const line of lines) {
			const match = /^\s*Dialogue:\s*(.*)$/.exec(line);
			if (match === null) {
				continue;
			}
			const values = splitFirst(match[1], ",", columns.length);
			const event: Record<string, string> = {};
			for (let i = 0; i < columns.length && i < values.length; i++) {
				event[columns[i]] = values[i];
			}
			const cue = this.makeCue(event, header);
			if (cue !== undefined) {
				cues.push(cue);
			}
		}
		return cues;
	}

	public setManifestType(_manifestType: string): void {}

	private makeCue(
		event: Record<string, string>,
		header: AssHeader,
	): shaka.text.Cue | undefined {
		const start = parseAssTime(event["Start"] ?? "");
		const end = parseAssTime(event["End"] ?? "");
		if (start === null || end === null) {
			return undefined;
		}
		const raw = event["Text"] ?? "";
		if (/\{[^}]*\\p[1-9]/.test(raw)) {
			return undefined;
		}
		const payload = raw
			.replace(/\\N/g, "\n")
			.replace(/\\n/g, " ")
			.replace(/\\h/g, "\u00a0")
			.replace(/\{[^}]*\}/g, "");
		if (payload.trim() === "") {
			return undefined;
		}
		const cue = new this.shaka.text.Cue(start, end, payload);
		const styleName = event["Style"];
		const style = styleName === undefined ? undefined : header.styles.get(styleName);
		if (style !== undefined) {
			this.applyStyle(cue, style, header.isV4Plus);
		}
		return cue;
	}

	private applyStyle(
		cue: shaka.text.Cue,
		style: Record<string, string>,
		isV4Plus: boolean,
	): void {
		if (style["Fontname"]) {
			cue.fontFamily = style["Fontname"];
		}
		if (style["Fontsize"]) {
			cue.fontSize = `${style["Fontsize"]}px`;
		}
		if (style["PrimaryColour"]) {
			const color = parseAssColor(style["PrimaryColour"]);
			if (color !== null) {
				cue.color = color;
			}
		}
		if (style["BackColour"]) {
			const color = parseAssColor(style["BackColour"]);
			if (color !== null) {
				cue.backgroundColor = color;
			}
		}
		if (isSet(style["Bold"])) {
			cue.fontWeight = this.shaka.text.Cue.fontWeight.BOLD;
		}
		if (isSet(style["Italic"])) {
			cue.fontStyle = this.shaka.text.Cue.fontStyle.ITALIC;
		}
		if (isSet(style["Underline"])) {
			cue.textDecoration.push(this.shaka.text.Cue.textDecoration.UNDERLINE);
		}
		if (style["Spacing"]) {
			cue.letterSpacing = `${style["Spacing"]}px`;
		}
		const alignment = parseAssAlignment(style["Alignment"], isV4Plus);
		if (alignment !== null) {
			cue.displayAlign = alignment.displayAlign;
			cue.textAlign = alignment.textAlign;
		}
		if (style["AlphaLevel"]) {
			cue.opacity = parseFloat(style["AlphaLevel"]);
		}
	}
}

function parseAssHeader(text: string): AssHeader {
	const styles = new Map<string, Record<string, string>>();
	let eventsFormat: string[] = [];
	let isV4Plus = false;
	for (const [name, lines] of splitSections(text)) {
		const lower = name.toLowerCase();
		if (lower === "v4 styles" || lower === "v4+ styles") {
			isV4Plus = lower === "v4+ styles";
			const table = parseAssTable(lines, "Style");
			for (const row of table.rows) {
				if (row["Name"] !== undefined) {
					styles.set(row["Name"], row);
				}
			}
		} else if (lower === "events") {
			eventsFormat = parseAssTable(lines, "Dialogue").columns;
		}
	}
	return { styles, eventsFormat, isV4Plus };
}

function splitSections(text: string): [string, string[]][] {
	const sections: [string, string[]][] = [];
	let lines: string[] | undefined;
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*\[([^\]]+)\]\s*$/.exec(line);
		if (match !== null) {
			lines = [];
			sections.push([match[1], lines]);
		} else if (lines !== undefined) {
			lines.push(line);
		}
	}
	return sections;
}

function parseAssTable(
	lines: string[],
	kind: string,
): { columns: string[]; rows: Record<string, string>[] } {
	let columns: string[] | undefined;
	const rows: Record<string, string>[] = [];
	for (const line of lines) {
		if (/^\s*;/.test(line)) {
			continue;
		}
		const match = /^\s*([^:]+):\s*(.*)$/.exec(line);
		if (match === null) {
			continue;
		}
		const key = match[1].trim();
		if (key === "Format") {
			columns = match[2].split(",").map((column) => column.trim());
		} else if (key === kind && columns !== undefined) {
			const values = splitFirst(match[2], ",", columns.length);
			const row: Record<string, string> = {};
			for (let i = 0; i < columns.length && i < values.length; i++) {
				row[columns[i]] = values[i];
			}
			rows.push(row);
		}
	}
	return { columns: columns ?? [], rows };
}

function splitFirst(text: string, separator: string, count: number): string[] {
	const parts: string[] = [];
	let start = 0;
	while (parts.length < count - 1) {
		const end = text.indexOf(separator, start);
		if (end < 0) {
			break;
		}
		parts.push(text.substring(start, end));
		start = end + separator.length;
	}
	parts.push(text.substring(start));
	return parts;
}

function parseAssTime(value: string): number | null {
	const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)$/.exec(value.trim());
	if (match === null) {
		return null;
	}
	return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function isSet(value: string | undefined): boolean {
	const number = parseInt(value ?? "", 10);
	return !isNaN(number) && number !== 0;
}

function parseAssColor(value: string): string | null {
	const trimmed = value.trim();
	const isHex = /^&H/i.test(trimmed);
	const abgr = isHex ? parseInt(trimmed.replace(/^&H/i, ""), 16) : parseInt(trimmed, 10);
	if (isNaN(abgr)) {
		return null;
	}
	const unsigned = abgr >>> 0;
	const alpha = (((unsigned >>> 24) & 0xff) ^ 0xff) / 255;
	const blue = (unsigned >>> 16) & 0xff;
	const green = (unsigned >>> 8) & 0xff;
	const red = unsigned & 0xff;
	return `rgba(${red},${green},${blue},${alpha})`;
}

function parseAssAlignment(
	value: string | undefined,
	isV4Plus: boolean,
): {
	displayAlign: shaka.text.Cue.displayAlign;
	textAlign: shaka.text.Cue.textAlign;
} | null {
	const number = parseInt(value ?? "", 10);
	if (isNaN(number)) {
		return null;
	}
	const displayAligns = ["after", "center", "before"] as const;
	const textAligns = ["start", "center", "end"] as const;
	let row: number;
	let column: number;
	if (isV4Plus) {
		if (number < 1 || number > 9) {
			return null;
		}
		row = Math.floor((number - 1) / 3);
		column = (number - 1) % 3;
	} else {
		const rowsOfSsa = [0, 2, 1];
		const group = Math.floor((number - 1) / 4);
		column = (number - 1) % 4;
		if (group > 2 || column > 2) {
			return null;
		}
		row = rowsOfSsa[group];
	}
	return {
		displayAlign: displayAligns[row] as shaka.text.Cue.displayAlign,
		textAlign: textAligns[column] as shaka.text.Cue.textAlign,
	};
}
