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

export type ArrayBuilderPart = ArrayBuilder | Uint8Array | number[];

export class ArrayBuilder {
	protected chunks: Uint8Array[] = [];
	private privateLength = 0;

	public get byteLength(): number {
		return this.privateLength;
	}

	public get length(): number {
		return this.privateLength;
	}

	public append(...chunks: ArrayBuilderPart[]): void {
		for (let chunk of chunks) {
			const parts = ArrayBuilder.toParts(chunk);
			for (let part of parts) {
				this.chunks.push(part);
				this.privateLength += part.length;
			}
		}
	}

	public prepend(chunk: ArrayBuilderPart): void {
		const parts = ArrayBuilder.toParts(chunk);
		for (let part of parts) {
			this.chunks.unshift(part);
			this.privateLength += part.length;
		}
	}

	public build(): Uint8Array {
		let result = new Uint8Array(this.privateLength);
		let offset = 0;
		for (let chunk of this.chunks) {
			result.set(chunk, offset);
			offset += chunk.length;
		}
		return result;
	}

	public valueOf(): Uint8Array {
		return this.build();
	}

	public static concat(...parts: ArrayBuilderPart[]): ArrayBuilder {
		let builder = new ArrayBuilder();
		for (let part of parts) {
			builder.append(part);
		}
		return builder;
	}

	private static toParts(part: ArrayBuilderPart): Uint8Array[] {
		if (part instanceof ArrayBuilder) {
			return part.chunks;
		} else if (part instanceof Uint8Array) {
			return [part];
		} else if (Array.isArray(part)) {
			return [new Uint8Array(part)];
		} else {
			throw new Error("Invalid part");
		}
	}
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

function ascii(text: string, length?: number): Uint8Array {
	if (length !== undefined) {
		text = text.padEnd(length, " ").slice(0, length);
	}
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

export function box(type: string, ...children: ArrayBuilderPart[]): ArrayBuilder {
	const builder = ArrayBuilder.concat(...children);
	let size = 8 + builder.build().length;
	return ArrayBuilder.concat(
		u32(size),
		ascii(type),
		builder,
	);
}

function curryBox(type: string): (...children: ArrayBuilderPart[]) => ArrayBuilder {
	return (...children) => box(type, ...children);
}

export const moov = curryBox("moov");

interface FTYP {
	majorBrand: string;
	minorVersion: number;
	compatibleBrands: string[];
}

export function ftyp({ majorBrand, minorVersion, compatibleBrands }: FTYP): ArrayBuilder {
	return box(
		"ftyp",
		ascii(majorBrand, 4),
		u32(minorVersion),
		...compatibleBrands.map(brand => ascii(brand, 4)),
	);
}

interface MVHD {
	timeScale: number;
	duration: number;
	nextTrackId: number;
}

export function mvhd({ timeScale, duration, nextTrackId }: MVHD): ArrayBuilder {
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
	duration?: number;
	width?: number;
	height?: number;
}

export function tkhd({ trackId, duration, width, height }: TKHD): ArrayBuilder {
	return box(
		"tkhd",
		verflag(0, 3),
		u32(0), // creation time
		u32(0), // modification time
		u32(trackId), // track id
		zeros(4), // reserved
		u32(duration ?? 0), // duration
		zeros(8), // reserved
		u16(0), // layer
		u16(0), // alternate group
		u16(0), // volume
		zeros(2), // reserved
		identityMatrix, // matrix
		u16(width ?? 0), u16(0), // width
		u16(height ?? 0), u16(0), // height
	);
}

export const mdia = curryBox("mdia");

interface MDHD {
	timeScale: number;
	duration: number;
}

export function mdhd({ timeScale, duration }: MDHD): ArrayBuilder {
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

export function hdlr({ handlerType, handlerName }: HDLR): ArrayBuilder {
	return box(
		"hdlr",
		verflag(0, 0),
		u32(0), // pre-defined
		ascii(handlerType),
		u32(0), // reserved
		u32(0), // reserved
		u32(0), // reserved
		ascii(handlerName),
		zeros(1),
	);
}

export const minf = curryBox("minf");

interface VMHD {}

export function vmhd({}: VMHD): ArrayBuilder {
	return box(
		"vmhd",
		verflag(0, 1),
		zeros(8),
	);
}

interface SMHD {}

export function smhd({}: SMHD): ArrayBuilder {
	return box(
		"smhd",
		verflag(0, 0),
		zeros(4),
	);
}

export const dinf = curryBox("dinf");
export function dref(...entries: ArrayBuilderPart[]): ArrayBuilder {
	return box(
		"dref",
		verflag(0, 0),
		u32(entries.length),
		...entries,
	);
}
export function url(): ArrayBuilder {
	return box("url ", zeros(4));
}

export const stbl = curryBox("stbl");

export function stsd(...entries: ArrayBuilder[]): ArrayBuilder {
	return box(
		"stsd",
		verflag(0, 0),
		u32(entries.length),
		...entries,
	);
}

interface AVC1Like {
	width: number;
	height: number;
}

function avc1Like(type: string) {
	return ({ width, height }: AVC1Like, ...children: ArrayBuilderPart[]) => box(
		type,
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
		...children,
	);
}

export const avc1 = avc1Like("avc1");
export const hev1 = avc1Like("hev1");

export function avcc(data: ArrayBuilderPart): ArrayBuilder {
	return box("avcC", data);
}

export function hvcc(data: ArrayBuilderPart): ArrayBuilder {
	return box("hvcC", data);
}

interface PASP {
	hSpacing?: number;
	vSpacing?: number;
}

export function pasp(opt?: PASP): ArrayBuilder {
	return box(
		"pasp",
		u32(opt?.hSpacing ?? 1),
		u32(opt?.vSpacing ?? 1),
	);
}

export function btrt(opt?: {}): ArrayBuilder {
	return box(
		"btrt",
		u32(0), // bufferSizeDB
		u32(0), // maxBitrate
		u32(0), // avgBitrate
	);
}

interface MP4A {
	sampleSize: number;
	sampleRate: number;
	channelCount: number;
}

export function mp4a({ sampleRate, sampleSize, channelCount }: MP4A, ...children: ArrayBuilderPart[]): ArrayBuilder {
	// see https://xhelmboyx.tripod.com/formats/mp4-layout.txt#:~:text=mp4a
	return box(
		"mp4a",
		zeros(6),
		u16(1), // data reference index
		u16(0), // audio encoding version
		u16(0), // revision level
		u32(0), // vendor
		u16(channelCount), // channel count
		u16(sampleSize), // sample size
		u16(0), // compression id
		u16(0), // packet size
		u32(sampleRate), // sample rate
		...children,
	);
}

interface ESDS {
	codecPrivate: ArrayBuilderPart;
}

export function esds({ codecPrivate }: ESDS): ArrayBuilder {
	// from https://github.com/Vanilagy/mp4-muxer/blob/main/src/box.ts
	return box(
		"esds",
		verflag(0, 0),
		// https://stackoverflow.com/a/54803118
		u32(0x03808080), // TAG(3) = Object Descriptor ([2])
		[0x20 + codecPrivate.length], // length of this OD (which includes the next 2 tags)
		u16(1), // ES_ID = 1
		[0x00], // flags etc = 0
		u32(0x04808080), // TAG(4) = ES Descriptor ([2]) embedded in above OD
		[0x12 + codecPrivate.length], // length of this ESD
		[0x40], // MPEG-4 Audio
		[0x15], // stream type(6bits)=5 audio, flags(2bits)=1
		[0, 0, 0], // 24bit buffer size
		u32(0x0001fc17), // max bitrate
		u32(0x0001fc17), // avg bitrate
		u32(0x05808080), // TAG(5) = ASC ([2],[3]) embedded in above OD
		[codecPrivate.length], // length
		codecPrivate,
		u32(0x06808080), // TAG(6)
		[0x01], // length
		[0x02] // data
	);
}

export function stts(...entries: { sampleCount: number, sampleDelta: number }[]): ArrayBuilder {
	return box(
		"stts",
		verflag(0, 0),
		u32(entries.length),
		...entries.map(entry => ArrayBuilder.concat(
			u32(entry.sampleCount),
			u32(entry.sampleDelta),
		)),
	);
}

export function stsc(...entries: ArrayBuilder[]): ArrayBuilder {
	return box(
		"stsc",
		verflag(0, 0),
		u32(entries.length),
		...entries,
	);
}

export function stsz(...entries: number[]): ArrayBuilder {
	return box(
		"stsz",
		verflag(0, 0),
		u32(0), // sample size
		u32(entries.length),
		...entries.map(u32),
	);
}

export function stco(...entries: (number | bigint)[]): ArrayBuilder {
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

export function trex({ trackId, defaultSampleDescriptionIndex }: TREX): ArrayBuilder {
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

export function mfhd({ sequenceNumber }: MFHD): ArrayBuilder {
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

export function tfhd({ trackId }: TFHD): ArrayBuilder {
	return box(
		"tfhd",
		verflag(0, 0x020000), // default-base-is-moof
		u32(trackId),
	);
}

interface TFDT {
	baseMediaDecodeTime: number;
}

export function tfdt({ baseMediaDecodeTime }: TFDT): ArrayBuilder {
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

export interface TRUN {
	dataOffset?: number;
	samples: {
		duration: number;
		size: number;
		compositionTimeOffset?: number;
		sampleFlags?: SampleFlags;
	}[];
}

export function trun({ dataOffset, samples }: TRUN): ArrayBuilder {
	let flags = 0;

	const hasCompositionTimeOffset = samples.some(sample => sample.compositionTimeOffset !== undefined);

	if (dataOffset !== undefined) {
		flags |= 0x1; // data offset present
	}
	flags |= 0x100; // sample duration present
	flags |= 0x200; // sample size present
	flags |= 0x400; // sample flags present
	if (hasCompositionTimeOffset) {
		flags |= 0x800; // sample composition time offset present
	}

	return box(
		"trun",
		verflag(1, flags),
		u32(samples.length), // sample count
		dataOffset !== undefined ? u32(dataOffset) : [],
		...samples.map(sample => ArrayBuilder.concat(
			u32(sample.duration),
			u32(sample.size),
			u32(sampleFlags(sample.sampleFlags ?? {})),
			hasCompositionTimeOffset ? i32(sample.compositionTimeOffset ?? 0) : [],
		))
	);
}

export const mdat = curryBox("mdat");
