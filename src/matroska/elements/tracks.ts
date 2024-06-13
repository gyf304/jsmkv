import type { Segment } from "./index.js";
import * as ebml from "../../ebml/index.js";

export class Tracks extends ebml.SchemaElement {
	public static readonly id = 0x1654ae6b;
	public static readonly level = 1;
	public static readonly name = "Tracks";
	public static get knownChildren() {
		return [TrackEntry];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: Segment) {
		super(element);
	}

	public get tracks(): AsyncGenerator<TrackEntry> {
		return this.many(TrackEntry);
	}
}

export class TrackEntry extends ebml.SchemaElement {
	public static readonly id = 0xae;
	public static readonly level = 2;
	public static readonly name = "TrackEntry";
	public static get knownChildren() {
		return [
			TrackNumber,
			TrackUID,
			TrackType,
			DefaultDuration,
			FlagLacing,
			Name,
			Language,
			CodecID,
			CodecPrivate,
			CodecName,
			Video,
			Audio,
			ContentEncodings,
		];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: Tracks) {
		super(element);
	}

	public get trackNumber() {
		return this.one(TrackNumber).then(v => v.value);
	}

	public get trackUID() {
		return this.one(TrackUID).then(v => v.value);
	}

	public get trackType() {
		return this.one(TrackType).then(v => v.value);
	}

	public get defaultDuration() {
		return this.maybeOne(DefaultDuration).then(v => v === undefined ? undefined : v.value);
	}

	public get trackName() {
		return this.maybeOne(Name).then(v => v === undefined ? undefined : v.value);
	}

	public get language() {
		return this.maybeOne(Language).then(v => v === undefined ? undefined : v.value);
	}

	public get codecID() {
		return this.one(CodecID).then(v => v.value);
	}

	public get video() {
		return this.maybeOne(Video);
	}

	public get audio() {
		return this.maybeOne(Audio);
	}

	public get codecPrivate() {
		return this.maybeOne(CodecPrivate).then(v => v === undefined ? undefined : v.value);
	}

	public get codecName() {
		return this.maybeOne(CodecName).then(v => v === undefined ? undefined : v.value);
	}

	private async getContentEncodings(): Promise<AsyncGenerator<ContentEncoding> | undefined> {
		const contentEncodings = await this.maybeOne(ContentEncodings);
		if (contentEncodings === undefined) {
			return undefined;
		}
		return contentEncodings.many(ContentEncoding);
	}

	public get contentEncodings() {
		return this.getContentEncodings();
	}
}

export class TrackNumber extends ebml.UintElement {
	public static readonly id = 0xd7;
	public static readonly level = 3;
	public static readonly name = "TrackNumber";

	constructor(public readonly element: ebml.Element, public readonly parent: TrackEntry) {
		super(element);
	}
}

export class TrackUID extends ebml.BytesElement {
	public static readonly id = 0x73c5;
	public static readonly level = 3;
	public static readonly name = "TrackUID";

	constructor(public readonly element: ebml.Element, public readonly parent: TrackEntry) {
		super(element);
	}
}

type TrackTypeValue = "video" | "audio" | "complex" | "logo" | "subtitle" | "buttons" | "control";
export class TrackType extends ebml.SchemaElement {
	public static readonly id = 0x83;
	public static readonly level = 3;
	public static readonly name = "TrackType";
	public static readonly leaf = true;

	constructor(public readonly element: ebml.Element, public readonly parent: TrackEntry) {
		super(element);
	}

	private async getValue(): Promise<TrackTypeValue> {
		const data = await this.element.data.arrayBuffer();
		const u8 = new Uint8Array(data);
		let n = 0;
		for (let i = 0; i < u8.length; i++) {
			n = (n << 8) | u8[i];
		}
		switch (n) {
			case 1:
				return "video";
			case 2:
				return "audio";
			case 3:
				return "complex";
			case 0x10:
				return "logo";
			case 0x11:
				return "subtitle";
			case 0x12:
				return "buttons";
			case 0x20:
				return "control";
			default:
				throw new Error(`Unknown track type ${n}`);
		}
	}

	public get value(): Promise<TrackTypeValue> {
		return this.getValue();
	}
}

export class Name extends ebml.UTF8Element {
	public static readonly id = 0x536e;
	public static readonly level = 3;
	public static readonly name = "Name";

	constructor(public readonly element: ebml.Element, public readonly parent: TrackEntry) {
		super(element);
	}
}

export class DefaultDuration extends ebml.UintElement {
	public static readonly id = 0x23e383;
	public static readonly level = 3;
	public static readonly name = "DefaultDuration";

	constructor(public readonly element: ebml.Element, public readonly parent: TrackEntry) {
		super(element);
	}
}

export class FlagLacing extends ebml.UintElement {
	public static readonly id = 0x9c;
	public static readonly level = 3;
	public static readonly name = "FlagLacing";

	constructor(public readonly element: ebml.Element, public readonly parent: TrackEntry) {
		super(element);
	}
}

export class Language extends ebml.UTF8Element {
	public static readonly id = 0x22b59c;
	public static readonly level = 3;
	public static readonly name = "Language";

	constructor(public readonly element: ebml.Element, public readonly parent: TrackEntry) {
		super(element);
	}
}

export class ContentEncodings extends ebml.SchemaElement {
	public static readonly id = 0x6d80;
	public static readonly level = 3;
	public static readonly name = "ContentEncodings";
	public static get knownChildren() {
		return [ContentEncoding];
	}
	private cachedOrderedEncodings?: ContentEncoding[];

	constructor(public readonly element: ebml.Element, public readonly parent: TrackEntry) {
		super(element);
	}

	public get contentEncodings(): AsyncGenerator<ContentEncoding> {
		return this.many(ContentEncoding);
	}

	public async decode(data: ArrayBuffer): Promise<ArrayBuffer> {
		if (this.cachedOrderedEncodings === undefined) {
			const encodings = new Map<number, ContentEncoding>();
			for await (const encoding of this.contentEncodings) {
				const order = await encoding.order;
				encodings.set(order ?? 0, encoding);
			}
			const orderedEncodings = Array.from(encodings.entries())
				.sort(([a], [b]) => a - b).map(([, encoding]) => encoding);
			this.cachedOrderedEncodings = orderedEncodings;
		}
		for (const encoding of this.cachedOrderedEncodings) {
			data = await encoding.decode(data);
		}
		return data;
	}
}

export class ContentEncoding extends ebml.SchemaElement {
	public static readonly id = 0x6240;
	public static readonly level = 4;
	public static readonly name = "ContentEncoding";
	public static get knownChildren() {
		return [
			ContentEncodingOrder,
			ContentEncodingScope,
			ContentEncodingType,
			ContentCompression,
			ContentEncryption,
		];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: ContentEncodings) {
		super(element);
	}

	public get order() {
		return this.maybeOne(ContentEncodingOrder).then(v => v?.value);
	}

	public get scope() {
		return this.one(ContentEncodingScope).then(v => v.value);
	}

	public get type() {
		return this.cached("type", () => this.maybeOne(ContentEncodingType).then(v => v?.value));
	}

	public get compression() {
		return this.cached("compression", () => this.maybeOne(ContentCompression));
	}

	public get encryption() {
		return this.maybeOne(ContentEncryption);
	}

	public async decode(data: ArrayBuffer): Promise<ArrayBuffer> {
		const type = (await this.type) ?? "compression";
		if (type === "compression") {
			const compression = await this.compression;
			if (compression === undefined) {
				return data;
			}
			return compression.decompress(data);
		} else {
			throw new Error(`Unimplemented ContentEncodingType ${type}`);
		}
	}
}

export class ContentEncodingOrder extends ebml.UintElement {
	public static readonly id = 0x5031;
	public static readonly level = 5;
	public static readonly name = "ContentEncodingOrder";

	constructor(public readonly element: ebml.Element, public readonly parent: ContentEncoding) {
		super(element);
	}
}

const ContentEncodingScopeValues = ["block", "private", "next"] as const;

export class ContentEncodingScope extends ebml.EnumElement<typeof ContentEncodingScopeValues[number]> {
	public static readonly id = 0x5032;
	public static readonly level = 5;
	public static readonly name = "ContentEncodingScope";
	public static readonly values = ContentEncodingScopeValues;

	constructor(public readonly element: ebml.Element, public readonly parent: ContentEncoding) {
		super(element);
	}
}

const ContentEncodingTypeValues = ["compression", "encryption"] as const;
export class ContentEncodingType extends ebml.EnumElement<typeof ContentEncodingTypeValues[number]> {
	public static readonly id = 0x5033;
	public static readonly level = 5;
	public static readonly name = "ContentEncodingType";
	public static readonly values = ContentEncodingTypeValues;

	constructor(public readonly element: ebml.Element, public readonly parent: ContentEncoding) {
		super(element);
	}
}

export class ContentCompression extends ebml.SchemaElement {
	public static readonly id = 0x5034;
	public static readonly level = 5;
	public static readonly name = "ContentCompression";
	public static get knownChildren() {
		return [ContentCompAlgo, ContentCompSettings];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: ContentEncoding) {
		super(element);
	}

	public get algo() {
		return this.one(ContentCompAlgo).then(v => v.value);
	}

	public get settings() {
		return this.one(ContentCompSettings).then(v => v.value);
	}

	public async decompress(data: ArrayBuffer): Promise<ArrayBuffer> {
		const algo = await this.algo;
		if (algo === "headerStripping") {
			const setting = await this.settings;
			// join setting with data
			const concat = new Uint8Array(setting.byteLength + data.byteLength);
			concat.set(new Uint8Array(setting), 0);
			concat.set(new Uint8Array(data), setting.byteLength);
			return concat.buffer as ArrayBuffer;
		} else {
			throw new Error(`Unimplemented compression algorithm ${algo}`);
		}
	}
}

const ContentCompAlgoValues = ["zlib", "bzlib", "lzo1x", "headerStripping"] as const;
export class ContentCompAlgo extends ebml.EnumElement<typeof ContentCompAlgoValues[number]> {
	public static readonly id = 0x4254;
	public static readonly level = 6;
	public static readonly name = "ContentCompAlgo";
	public static readonly values = ContentCompAlgoValues;

	constructor(public readonly element: ebml.Element, public readonly parent: ContentCompression) {
		super(element);
	}
}

export class ContentCompSettings extends ebml.BytesElement {
	public static readonly id = 0x4255;
	public static readonly level = 6;
	public static readonly name = "ContentCompSettings";

	constructor(public readonly element: ebml.Element, public readonly parent: ContentCompression) {
		super(element);
	}
}

export class ContentEncryption extends ebml.SchemaElement {
	public static readonly id = 0x5035;
	public static readonly level = 5;
	public static readonly name = "ContentEncryption";
	public static get knownChildren() {
		return [];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: ContentEncoding) {
		super(element);
	}
}

export class CodecID extends ebml.UTF8Element {
	public static readonly id = 0x86;
	public static readonly level = 3;
	public static readonly name = "CodecID";

	constructor(public readonly element: ebml.Element, public readonly parent: TrackEntry) {
		super(element);
	}
}

export class CodecPrivate extends ebml.BytesElement {
	public static readonly id = 0x63a2;
	public static readonly level = 3;
	public static readonly name = "CodecPrivate";

	constructor(public readonly element: ebml.Element, public readonly parent: TrackEntry) {
		super(element);
	}
}

export class CodecName extends ebml.UTF8Element {
	public static readonly id = 0x258688;
	public static readonly level = 3;
	public static readonly name = "CodecName";

	constructor(public readonly element: ebml.Element, public readonly parent: TrackEntry) {
		super(element);
	}
}

export class Video extends ebml.SchemaElement {
	public static readonly id = 0xe0;
	public static readonly level = 4;
	public static readonly name = "Video";
	public static get knownChildren() {
		return [PixelWidth, PixelHeight, DisplayWidth, DisplayHeight];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: TrackEntry) {
		super(element);
	}

	public get pixelWidth() {
		return this.one(PixelWidth).then(v => v.value);
	}

	public get pixelHeight() {
		return this.one(PixelHeight).then(v => v.value);
	}

	public get displayWidth() {
		return this.one(DisplayWidth).then(v => v.value);
	}

	public get displayHeight() {
		return this.one(DisplayHeight).then(v => v.value);
	}
}

export class PixelWidth extends ebml.UintElement {
	public static readonly id = 0xb0;
	public static readonly level = 5;
	public static readonly name = "PixelWidth";

	constructor(public readonly element: ebml.Element, public readonly parent: Video) {
		super(element);
	}
}

export class PixelHeight extends ebml.UintElement {
	public static readonly id = 0xba;
	public static readonly level = 5;
	public static readonly name = "PixelHeight";

	constructor(public readonly element: ebml.Element, public readonly parent: Video) {
		super(element);
	}
}

export class DisplayWidth extends ebml.UintElement {
	public static readonly id = 0x54b0;
	public static readonly level = 5;
	public static readonly name = "DisplayWidth";

	constructor(public readonly element: ebml.Element, public readonly parent: Video) {
		super(element);
	}
}

export class DisplayHeight extends ebml.UintElement {
	public static readonly id = 0x54ba;
	public static readonly level = 5;
	public static readonly name = "DisplayHeight";

	constructor(public readonly element: ebml.Element, public readonly parent: Video) {
		super(element);
	}
}

class Audio extends ebml.SchemaElement {
	public static readonly id = 0xe1;
	public static readonly level = 4;
	public static readonly name = "Audio";
	public static get knownChildren() {
		return [SamplingFrequency, Channels, BitDepth];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: TrackEntry) {
		super(element);
	}

	public get samplingFrequency() {
		return this.one(SamplingFrequency).then(v => v.value);
	}

	public get channels() {
		return this.one(Channels).then(v => v.value);
	}

	public get bitDepth() {
		return this.maybeOne(BitDepth).then(v => v?.value);
	}
}

export class SamplingFrequency extends ebml.FloatElement {
	public static readonly id = 0xb5;
	public static readonly level = 5;
	public static readonly name = "SamplingFrequency";

	constructor(public readonly element: ebml.Element, public readonly parent: Audio) {
		super(element);
	}
}

export class Channels extends ebml.UintElement {
	public static readonly id = 0x9f;
	public static readonly level = 5;
	public static readonly name = "Channels";

	constructor(public readonly element: ebml.Element, public readonly parent: Audio) {
		super(element);
	}
}

export class BitDepth extends ebml.UintElement {
	public static readonly id = 0x6264;
	public static readonly level = 5;
	public static readonly name = "BitDepth";

	constructor(public readonly element: ebml.Element, public readonly parent: Audio) {
		super(element);
	}
}
