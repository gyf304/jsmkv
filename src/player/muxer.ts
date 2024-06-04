import { concatArrayBuffers } from "bun";

const temp = new ArrayBuffer(8);
const tempView = new DataView(temp);
const tempU8 = new Uint8Array(temp);

const identityMatrix = new Uint8Array([
	0, 1, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0,
	0, 1, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0,
	64, 0, 0, 0,
]);

function arrayConcat(...arrays: (Uint8Array | number[])[]): Uint8Array {
	let length = arrays.reduce((acc, arr) => acc + arr.length, 0);
	let result = new Uint8Array(length);
	let offset = 0;
	for (let arr of arrays) {
		result.set(arr, offset);
		offset += arr.length;
	}
	return result;
}

function u64(value: number | bigint): Uint8Array {
	tempView.setBigUint64(0, BigInt(value), false);
	const result = new Uint8Array(8);
	result.set(tempU8, 0);
	return result;
}

function u32(value: number): Uint8Array {
	tempView.setUint32(0, value, false);
	const result = new Uint8Array(4);
	result.set(tempU8.slice(0, 4), 0);
	return result;
}

function i32(value: number): Uint8Array {
	tempView.setInt32(0, value, false);
	const result = new Uint8Array(4);
	result.set(tempU8.slice(0, 4), 0);
	return result;
}

function u16(value: number): Uint8Array {
	tempView.setUint16(0, value, false);
	const result = new Uint8Array(2);
	result.set(tempU8.slice(0, 2), 0);
	return result;
}

function verflag(version: number, flags: number): Uint8Array {
	return u32(((version & 0xffffff) << 24) | flags);
}

function zeros(count: number): Uint8Array {
	return new Uint8Array(count);
}

function ascii(text: string): Uint8Array {
	const result = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) {
		result[i] = text.charCodeAt(i);
	}
	return result;
}

export function hexdump(data: Uint8Array): string {
	let lines = ["Size: " + data.length + " bytes"];
	for (let i = 0; i < data.length; i += 16) {
		let chunk = data.slice(i, i + 16);
		let hex = Array.from(chunk, byte => byte.toString(16).padStart(2, "0")).join(" ");
		let ascii = Array.from(chunk, byte => byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ".").join("");
		lines.push(`${hex.padEnd(48)}  ${ascii}`);
	}
	return lines.join("\n");
}

export function box(type: string, ...children: (Uint8Array | number[])[]): Uint8Array {
	let size = 8 + children.reduce((acc, child) => acc + child.length, 0);
	return arrayConcat(
		u32(size),
		ascii(type),
		...children,
	);
}

function curryBox(type: string): (...children: (Uint8Array | number[])[]) => Uint8Array {
	return (...children) => box(type, ...children);
}

export const moov = curryBox("moov");

export function ftyp(option: {}): Uint8Array {
	return box(
		"ftyp",
		ascii("isom"),
		u32(0x200),
		ascii("isom"),
		ascii("iso2"),
		ascii("mp41"),
		ascii("mp42"),
	);
}

interface MVHD {
	timeScale: number;
	duration: number;
	nextTrackId: number;
}

export function mvhd({ timeScale, duration, nextTrackId }: MVHD): Uint8Array {
	return box(
		"mvhd",
		verflag(0, 0),
		zeros(8),
		u32(timeScale), // time scale
		u32(duration), // duration
		u16(1), u16(0), // preferred rate
		[1, 0], // preferred volume
		zeros(10), // reserved
		identityMatrix, // matrix
		zeros(24), // don't care
		u32(nextTrackId), // next track id
	);
}

export const trak = curryBox("trak");

interface TKHD {
	trackId: number;
	duration: number;
	width: number;
	height: number;
}

export function tkhd({ trackId, duration, width, height }: TKHD): Uint8Array {
	return box(
		"tkhd",
		verflag(0, 3),
		u32(0), // creation time
		u32(0), // modification time
		u32(trackId), // track id
		zeros(4), // reserved
		u32(duration), // duration
		zeros(8), // reserved
		u16(0), // layer
		u16(0), // alternate group
		u16(0), // volume
		zeros(2), // reserved
		identityMatrix, // matrix
		u16(width), u16(0), // width
		u16(height), u16(0), // height
	);
}

export const mdia = curryBox("mdia");

interface MDHD {
	trackId: number;
	timeScale: number;
	duration: number;
}

export function mdhd({ trackId, timeScale, duration }: MDHD): Uint8Array {
	return box(
		"mdhd",
		verflag(0, 0),
		u32(0), // creation time
		u32(0), // modification time
		u32(timeScale), // time scale
		u32(duration), // duration
		u16(0x55c4), // language
		u16(0), // quality
	);
}

interface HDLR {
	handlerType: "vide" | "soun";
	handlerName: string;
}

export function hdlr({ handlerType, handlerName }: HDLR): Uint8Array {
	return box(
		"hdlr",
		verflag(0, 0),
		ascii(handlerType),
		zeros(12),
		ascii(handlerName),
	);
}

export const minf = curryBox("minf");

interface VMHD {}

export function vmhd({}: VMHD): Uint8Array {
	return box(
		"vmhd",
		verflag(0, 1),
		zeros(8),
	);
}

interface SMHD {}

export function smhd({}: SMHD): Uint8Array {
	return box(
		"smhd",
		verflag(0, 0),
		zeros(4),
	);
}

export const dinf = curryBox("dinf");
export const dref = curryBox("dref");
export const url = curryBox("url ");

export const stbl = curryBox("stbl");

export function stsd(...entries: Uint8Array[]): Uint8Array {
	return box(
		"stsd",
		verflag(0, 0),
		u32(entries.length),
		...entries,
	);
}

interface AVC1 {
	width: number;
	height: number;
}

export function avc1({ width, height }: AVC1): Uint8Array {
	return box(
		"avc1",
		zeros(6),
		u16(1), // data reference index
		zeros(16),
		u16(width), u16(height), // width, height
		u16(0x0048), u16(0), // horiz resolution
		u16(0x0048), u16(0), // vert resolution
		zeros(4),
		u16(1), // frame count
		[0x5], // compressor name length
		ascii("jsmkv"), // compressor name
		zeros(32-5),
		[24, 0xff, 0xff], // depth, pre-defined
	);
}

export function avcc(data: Uint8Array): Uint8Array {
	return box("avcC", data);
}

interface PASP {
	hSpacing?: number;
	vSpacing?: number;
}

export function pasp(opt?: PASP): Uint8Array {
	return box(
		"pasp",
		u32(opt?.hSpacing ?? 1),
		u32(opt?.vSpacing ?? 1),
	);
}

export function btrt(opt?: {}): Uint8Array {
	return box(
		"btrt",
		u32(0), // bufferSizeDB
		u32(0), // maxBitrate
		u32(0), // avgBitrate
	);
}

export function stsc(...entries: Uint8Array[]): Uint8Array {
	return box(
		"stsc",
		verflag(0, 0),
		u32(entries.length),
		...entries,
	);
}

export function stsz(...entries: number[]): Uint8Array {
	return box(
		"stsz",
		verflag(0, 0),
		u32(0), // sample size
		u32(entries.length),
		...entries.map(u32),
	);
}

export function stco(...entries: (number | bigint)[]): Uint8Array {
	return box(
		"stco",
		verflag(0, 0),
		u32(entries.length),
		...entries.map(u64),
	);
}

export const mvex = curryBox("mvex");

interface TREX {
	trackId: number;
	defaultSampleDescriptionIndex: number;
}

export function trex({ trackId, defaultSampleDescriptionIndex }: TREX): Uint8Array {
	return box(
		"trex",
		verflag(0, 0),
		u32(trackId), // track id, likely 1
		u32(defaultSampleDescriptionIndex), // likely 1
		u32(0), // default sample duration
		u32(0), // default sample size
		u32(0), // default sample flags
	);
}

export const moof = curryBox("moof");

interface MFHD {
	sequenceNumber: number;
}

export function mfhd({ sequenceNumber }: MFHD): Uint8Array {
	return box(
		"mfhd",
		verflag(0, 0),
		u32(sequenceNumber),
	);
}

export const traf = curryBox("traf");

interface TFHD {
	trackId: number;
}

export function tfhd({ trackId }: TFHD): Uint8Array {
	return box(
		"tfhd",
		verflag(0, 0),
		u32(trackId),
	);
}

interface TFDT {
	baseMediaDecodeTime: number;
}

export function tfdt({ baseMediaDecodeTime }: TFDT): Uint8Array {
	return box(
		"tfdt",
		verflag(1, 0),
		u64(baseMediaDecodeTime),
	);
}

interface SampleFlags {
	// reserved: 4;
	isLeading?: number; // 2, 0: unknown, 1: leading, 2: not leading, 3: leading but decodable
	dependsOn?: number; // 2, 0: unknown, 1: not I picture, 2: I picture
	isDependedOn?: number; // 2, 0: unknown, 1: not disposable, 2: disposable
	hasRedundancy?: number; // 2, 0: unknown, 1: redundant, 2: not redundant
	samplePaddingValue?: number; // 3
	isNonSyncSample?: number;
	degradationPriority?: number; // uint16
}

function m2(value: number): number {
	return (value & 0x3);
}

function sampleFlags(flags: SampleFlags): number {
	return (
		(m2(flags.isLeading ?? 0) << 26) |
		(m2(flags.dependsOn ?? 0) << 24) |
		(m2(flags.isDependedOn ?? 0) << 22) |
		(m2(flags.hasRedundancy ?? 0) << 20) |
		(m2(flags.samplePaddingValue ?? 0) << 17) |
		(m2(flags.isNonSyncSample ?? 0) << 16) |
		((flags.degradationPriority ?? 0) & 0xffff)
	);
}

interface TRUN {
	dataOffset?: number; // if not set, assume mdat immediately follows
	samples: {
		duration: number;
		size: number;
		compositionTimeOffset?: number;
		sampleFlags?: SampleFlags;
	}[];
}

export function trun({ dataOffset, samples }: TRUN): Uint8Array {
	let flags = 0;

	const hasCompositionTimeOffset = samples.some(sample => sample.compositionTimeOffset !== undefined);

	if (dataOffset !== undefined) {
		flags |= 0x1; // data offset present
	}
	flags |= 0x4; // sample duration present
	flags |= 0x100; // sample size present
	flags |= 0x200; // sample flags present
	if (hasCompositionTimeOffset) {
		flags |= 0x800; // sample composition time offset present
	}

	return box(
		"trun",
		verflag(1, 0),
		u32(samples.length), // sample count
		dataOffset !== undefined ? u32(dataOffset) : [],
		...samples.map(sample => arrayConcat(
			u32(sample.duration),
			u32(sample.size),
			u32(sampleFlags(sample.sampleFlags ?? {})),
			i32(sample.compositionTimeOffset ?? 0),
		))
	);
}

export const mdat = curryBox("mdat");
