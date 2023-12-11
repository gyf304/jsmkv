import { EBMLElement } from "../../ebml.js";
import { VInt } from "../../vint.js";
import { MKVElement, MKVUTF8Element, MKVUintElement } from "../element.js";

/*
+-------------+
| EBML Header |
+---------------------------+
| Segment     | SeekHead    |
|             |-------------|
|             | Info        |
|             |-------------|
|             | Tracks      |
|             |-------------|
|             | Chapters    |
|             |-------------|
|             | Cluster     |
|             |-------------|
|             | Cues        |
|             |-------------|
|             | Attachments |
|             |-------------|
|             | Tags        |
+---------------------------+

See https://www.matroska.org/technical/elements.html for details.
 */

export class EBMLHead extends MKVElement {
	public static readonly id = 0x1a45dfa3;
	public static readonly level = 0;

	constructor(public readonly element: EBMLElement) {
		super(element);
	}
}

export class Segment extends MKVElement {
	public static readonly id = 0x18538067;
	public static readonly level = 0;

	constructor(public readonly element: EBMLElement) {
		super(element);
	}

	private async *seekHeadsGenerator(): AsyncGenerator<SeekHead> {
		for await (const child of this.element.children) {
			if (child.id.id === SeekHead.id) {
				yield new SeekHead(child, this);
			}
			if (child.id.id === Cluster.id) {
				break;
			}
		}
	}

	public get seekHeads(): AsyncGenerator<SeekHead> {
		return this.seekHeadsGenerator();
	}

	private async getSegmentInfo(): Promise<SegmentInfo> {
		for await (const child of this.element.children) {
			if (child.id.id === SegmentInfo.id) {
				return new SegmentInfo(child, this);
			}
			if (child.id.id === Cluster.id) {
				break;
			}
		}
		throw new Error("SegmentInfo not found");
	}

	public get info(): Promise<SegmentInfo> {
		return this.getSegmentInfo();
	}

	private async getTracks(): Promise<Tracks | undefined> {
		for await (const child of this.element.children) {
			if (child.id.id === Tracks.id) {
				return new Tracks(child, this);
			}
			if (child.id.id === Cluster.id) {
				break;
			}
		}
		return undefined;
	}

	public get tracks(): Promise<Tracks | undefined> {
		return this.getTracks();
	}

	/**
	 * Get Cues element in Segment.
	 * @param fast If true, only search using SeekHead. If false, also search by scanning Segment.
	 */
	public async getCues(fast?: boolean): Promise<Cues | undefined> {
		for await (const seekHead of this.seekHeads) {
			for await (const seek of seekHead.seeks) {
				const id = await seek.seekID.then((v) => v.value);
				if (id.id === Cues.id) {
					const position = await seek.seekPosition;
					const referenced = await position.referencedElement;
					if (!(referenced instanceof Cues)) {
						throw new Error("Referenced element is not Cues");
					}
					return referenced;
				}
			}
		}
		if (fast) {
			return undefined;
		}
		// cannot find Cues in SeekHead, try to find it in Segment
		for await (const child of this.element.children) {
			if (child.id.id === Cues.id) {
				return new Cues(child, this);
			}
			if (child.id.id === Cluster.id) {
				break;
			}
		}
		return undefined;
	}

	/**
	 * Cues element in Segment.
	 */
	public get cues(): Promise<Cues | undefined> {
		return this.getCues();
	}
}

export class SeekHead extends MKVElement {
	public static readonly id = 0x114d9b74;
	public static readonly level = 1;

	constructor(public readonly element: EBMLElement, public readonly parent: Segment) {
		super(element);
	}

	private async *seeksGenerator(): AsyncGenerator<Seek> {
		for await (const child of this.element.children) {
			if (child.id.id === Seek.id) {
				yield new Seek(child, this);
			}
		}
	}

	public get seeks(): AsyncGenerator<Seek> {
		return this.seeksGenerator();
	}
}

export class Seek extends MKVElement {
	public static readonly id = 0x4dbb;
	public static readonly level = 2;

	constructor(public readonly element: EBMLElement, public readonly parent: SeekHead) {
		super(element);
	}

	private async getSeekID(): Promise<SeekID> {
		for await (const child of this.element.children) {
			if (child.id.id === SeekID.id) {
				return new SeekID(child, this);
			}
		}
		throw new Error("SeekID not found");
	}

	public get seekID(): Promise<SeekID> {
		return this.getSeekID();
	}

	private async getSeekPosition(): Promise<SeekPosition> {
		for await (const child of this.element.children) {
			if (child.id.id === SeekPosition.id) {
				return new SeekPosition(child, this);
			}
		}
		throw new Error("SeekPosition not found");
	}

	public get seekPosition(): Promise<SeekPosition> {
		return this.getSeekPosition();
	}
}

export class SeekID extends MKVElement {
	public static readonly id = 0x53ab;
	public static readonly level = 3;

	constructor(public readonly element: EBMLElement, public readonly parent: Seek) {
		super(element);
	}

	private async getValue(): Promise<VInt> {
		return new VInt(await this.element.data.arrayBuffer());
	}

	public get value(): Promise<VInt> {
		return this.getValue();
	}
}

export class SeekPosition extends MKVElement {
	public static readonly id = 0x53ac;
	public static readonly level = 3;

	constructor(public readonly element: EBMLElement, public readonly parent: Seek) {
		super(element);
	}

	private async getValue(): Promise<number> {
		const data = await this.element.data.arrayBuffer();
		const u8 = new Uint8Array(data);
		let n = 0;
		for (let i = 0; i < u8.length; i++) {
			n = (n << 8) | u8[i];
		}
		return n;
	}

	public get value(): Promise<number> {
		return this.getValue();
	}

	private async getReferencedElement(): Promise<MKVElement> {
		const position = await this.getValue();
		const segment = this.parent.parent.parent;
		const blob = segment.element.data.slice(position);
		const el = await EBMLElement.fromBlob(blob);
		const selfExport = await import("./index.js");
		const elementTypes = Object.values(selfExport).filter((v) => v instanceof Function);
		for (const elementType of elementTypes) {
			if (elementType.id === el.id.id) {
				if (elementType.level !== 1) {
					throw new Error(`Cannot reference element that is not a child of Segment`);
				}
				return new elementType(el, segment);
			}
		}
		throw new Error(`Unknown element type ${el.id.toString()}`);
	}

	public get referencedElement(): Promise<MKVElement> {
		return this.getReferencedElement();
	}
}

export class SegmentInfo extends MKVElement {
	public static readonly id = 0x1549a966;
	public static readonly level = 1;

	constructor(public readonly element: EBMLElement, public readonly parent: Segment) {
		super(element);
	}
}

export class Tracks extends MKVElement {
	public static readonly id = 0x1654ae6b;
	public static readonly level = 1;

	constructor(public readonly element: EBMLElement, public readonly parent: Segment) {
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

export class TrackEntry extends MKVElement {
	public static readonly id = 0xae;
	public static readonly level = 2;

	constructor(public readonly element: EBMLElement, public readonly parent: Tracks) {
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

	private async getName(): Promise<Name | undefined> {
		for await (const child of this.element.children) {
			if (child.id.id === Name.id) {
				return new Name(child, this);
			}
		}
		return undefined;
	}

	public get name(): Promise<Name | undefined> {
		return this.getName();
	}
}

export class TrackNumber extends MKVUintElement {
	public static readonly id = 0xd7;
	public static readonly level = 3;

	constructor(public readonly element: EBMLElement, public readonly parent: TrackEntry) {
		super(element);
	}
}

export class TrackUID extends MKVElement {
	public static readonly id = 0x73c5;
	public static readonly level = 3;

	constructor(public readonly element: EBMLElement, public readonly parent: TrackEntry) {
		super(element);
	}

	private async getValue(): Promise<Uint8Array> {
		const data = await this.element.data.arrayBuffer();
		const u8 = new Uint8Array(data);
		return u8;
	}

	public get value(): Promise<Uint8Array> {
		return this.getValue();
	}
}

type TrackTypeValue = "video" | "audio" | "complex" | "logo" | "subtitle" | "buttons" | "control";
export class TrackType extends MKVElement {
	public static readonly id = 0x83;
	public static readonly level = 3;

	constructor(public readonly element: EBMLElement, public readonly parent: TrackEntry) {
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

export class Name extends MKVUTF8Element {
	public static readonly id = 0x536e;
	public static readonly level = 3;

	constructor(public readonly element: EBMLElement, public readonly parent: TrackEntry) {
		super(element);
	}
}

export class DefaultDuration extends MKVUintElement {
	public static readonly id = 0x536e;
	public static readonly level = 3;

	constructor(public readonly element: EBMLElement, public readonly parent: TrackEntry) {
		super(element);
	}
}

export class Cluster extends MKVElement {
	public static readonly id = 0x1f43b675;
	public static readonly level = 1;

	constructor(public readonly element: EBMLElement, public readonly parent: Segment) {
		super(element);
	}
}

export class Cues extends MKVElement {
	public static readonly id = 0x1c53bb6b;
	public static readonly level = 1;

	constructor(public readonly element: EBMLElement, public readonly parent: Segment) {
		super(element);
	}

	private async *cuePointsGenerator(): AsyncGenerator<CuePoint> {
		for await (const child of this.element.children) {
			if (child.id.id === CuePoint.id) {
				yield new CuePoint(child, this);
			}
		}
	}

	public get cuePoints(): AsyncGenerator<CuePoint> {
		return this.cuePointsGenerator();
	}
}

export class CuePoint extends MKVElement {
	public static readonly id = 0xbb;
	public static readonly level = 2;

	constructor(public readonly element: EBMLElement, public readonly parent: Cues) {
		super(element);
	}

	private async getCueTime(): Promise<CueTime> {
		for await (const child of this.element.children) {
			if (child.id.id === CueTime.id) {
				return new CueTime(child, this);
			}
		}
		throw new Error("CueTime not found");
	}

	public get cueTime(): Promise<CueTime> {
		return this.getCueTime();
	}

	private async *cueTrackPositionsGenerator(): AsyncGenerator<CueTrackPositions> {
		for await (const child of this.element.children) {
			if (child.id.id === CueTrackPositions.id) {
				yield new CueTrackPositions(child, this);
			}
		}
	}

	public get cueTrackPositions(): AsyncGenerator<CueTrackPositions> {
		return this.cueTrackPositionsGenerator();
	}
}

export class CueTime extends MKVElement {
	public static readonly id = 0xb3;
	public static readonly level = 3;

	constructor(public readonly element: EBMLElement, public readonly parent: CuePoint) {
		super(element);
	}
}

export class CueTrackPositions extends MKVElement {
	public static readonly id = 0xb7;
	public static readonly level = 3;

	constructor(public readonly element: EBMLElement, public readonly parent: CuePoint) {
		super(element);
	}

	private async getCueTrack(): Promise<CueTrack> {
		for await (const child of this.element.children) {
			if (child.id.id === CueTrack.id) {
				return new CueTrack(child, this);
			}
		}
		throw new Error("CueTrack not found");
	}

	public get cueTrack(): Promise<CueTrack> {
		return this.getCueTrack();
	}

	private async getCueClusterPosition(): Promise<CueClusterPosition> {
		for await (const child of this.element.children) {
			if (child.id.id === CueClusterPosition.id) {
				return new CueClusterPosition(child, this);
			}
		}
		throw new Error("CueClusterPosition not found");
	}

	public get cueClusterPosition(): Promise<CueClusterPosition> {
		return this.getCueClusterPosition();
	}
}

export class CueTrack extends MKVUintElement {
	public static readonly id = 0xf7;
	public static readonly level = 4;

	constructor(public readonly element: EBMLElement, public readonly parent: CueTrackPositions) {
		super(element);
	}
}

export class CueClusterPosition extends MKVUintElement {
	public static readonly id = 0xf1;
	public static readonly level = 4;

	constructor(public readonly element: EBMLElement, public readonly parent: CueTrackPositions) {
		super(element);
	}

	private async getReferencedElement(): Promise<Cluster> {
		const position = await this.value;
		const segment = this.parent.parent.parent.parent;
		const blob = segment.element.data.slice(position);
		const el = await EBMLElement.fromBlob(blob);
		return new Cluster(el, segment);
	}

	public get referencedElement(): Promise<Cluster> {
		return this.getReferencedElement();
	}
}

export class Tags extends MKVElement {
	public static readonly id = 0x1254c367;
	public static readonly level = 1;

	constructor(public readonly element: EBMLElement, public readonly parent: Segment) {
		super(element);
	}
}

export class Chapters extends MKVElement {
	public static readonly id = 0x1043a770;
	public static readonly level = 1;

	constructor(public readonly element: EBMLElement, public readonly parent: Segment) {
		super(element);
	}
}
