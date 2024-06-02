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

	private async *tracksGenerator(): AsyncGenerator<TrackEntry> {
		for await (const child of this.element.children) {
			if (child.id.id === TrackEntry.id) {
				yield new TrackEntry(child, this);
			}
		}
	}

	public get tracks(): AsyncGenerator<TrackEntry> {
		return this.tracksGenerator();
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
		];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: Tracks) {
		super(element);
	}

	private async getTrackNumber(): Promise<TrackNumber> {
		for await (const child of this.element.children) {
			if (child.id.id === TrackNumber.id) {
				return new TrackNumber(child, this);
			}
		}
		throw new Error("TrackNumber not found");
	}

	public get trackNumber(): Promise<TrackNumber> {
		return this.getTrackNumber();
	}

	private async getTrackUID(): Promise<TrackUID> {
		for await (const child of this.element.children) {
			if (child.id.id === TrackUID.id) {
				return new TrackUID(child, this);
			}
		}
		throw new Error("TrackUID not found");
	}

	public get trackUID(): Promise<TrackUID> {
		return this.getTrackUID();
	}

	private async getTrackType(): Promise<TrackType> {
		for await (const child of this.element.children) {
			if (child.id.id === TrackType.id) {
				return new TrackType(child, this);
			}
		}
		throw new Error("TrackType not found");
	}

	public get trackType(): Promise<TrackType> {
		return this.getTrackType();
	}

	private async getDefaultDuration(): Promise<DefaultDuration | undefined> {
		for await (const child of this.element.children) {
			if (child.id.id === DefaultDuration.id) {
				return new DefaultDuration(child, this);
			}
		}
		return undefined;
	}

	public get defaultDuration(): Promise<DefaultDuration | undefined> {
		return this.getDefaultDuration();
	}

	private async getTrackName(): Promise<Name | undefined> {
		for await (const child of this.element.children) {
			if (child.id.id === Name.id) {
				return new Name(child, this);
			}
		}
		return undefined;
	}

	public get trackName(): Promise<Name | undefined> {
		return this.getTrackName();
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

	private async getPixelWidth(): Promise<PixelWidth> {
		for await (const child of this.element.children) {
			if (child.id.id === PixelWidth.id) {
				return new PixelWidth(child, this);
			}
		}
		throw new Error("PixelWidth not found");
	}

	public get pixelWidth(): Promise<PixelWidth> {
		return this.getPixelWidth();
	}

	private async getPixelHeight(): Promise<PixelHeight> {
		for await (const child of this.element.children) {
			if (child.id.id === PixelHeight.id) {
				return new PixelHeight(child, this);
			}
		}
		throw new Error("PixelHeight not found");
	}

	public get pixelHeight(): Promise<PixelHeight> {
		return this.getPixelHeight();
	}

	private async getDisplayWidth(): Promise<DisplayWidth | undefined> {
		for await (const child of this.element.children) {
			if (child.id.id === DisplayWidth.id) {
				return new DisplayWidth(child, this);
			}
		}
		return undefined;
	}

	public get displayWidth(): Promise<DisplayWidth | undefined> {
		return this.getDisplayWidth();
	}

	private async getDisplayHeight(): Promise<DisplayHeight | undefined> {
		for await (const child of this.element.children) {
			if (child.id.id === DisplayHeight.id) {
				return new DisplayHeight(child, this);
			}
		}
		return undefined;
	}

	public get displayHeight(): Promise<DisplayHeight | undefined> {
		return this.getDisplayHeight();
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

	private async getSamplingFrequency(): Promise<SamplingFrequency> {
		for await (const child of this.element.children) {
			if (child.id.id === SamplingFrequency.id) {
				return new SamplingFrequency(child, this);
			}
		}
		throw new Error("SamplingFrequency not found");
	}

	public get samplingFrequency(): Promise<SamplingFrequency> {
		return this.getSamplingFrequency();
	}

	private async getChannels(): Promise<Channels> {
		for await (const child of this.element.children) {
			if (child.id.id === Channels.id) {
				return new Channels(child, this);
			}
		}
		throw new Error("Channels not found");
	}

	public get channels(): Promise<Channels> {
		return this.getChannels();
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
