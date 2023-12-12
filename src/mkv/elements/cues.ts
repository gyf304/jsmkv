import type { Segment } from "./index.js";
import * as ebml from "../../ebml";
import { Cluster } from "./cluster.js";

export class Cues extends ebml.SchemaElement {
	public static readonly id = 0x1c53bb6b;
	public static readonly level = 1;
	public static readonly name = "Cues";
	public static get knownChildren() {
		return [CuePoint];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: Segment) {
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

export class CuePoint extends ebml.SchemaElement {
	public static readonly id = 0xbb;
	public static readonly level = 2;
	public static readonly name = "CuePoint";
	public static get knownChildren() {
		return [CueTime, CueTrackPositions];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: Cues) {
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

export class CueTime extends ebml.VintElement {
	public static readonly id = 0xb3;
	public static readonly level = 3;
	public static readonly name = "CueTime";

	constructor(public readonly element: ebml.Element, public readonly parent: CuePoint) {
		super(element);
	}
}

export class CueTrackPositions extends ebml.SchemaElement {
	public static readonly id = 0xb7;
	public static readonly level = 3;
	public static readonly name = "CueTrackPositions";
	public static get knownChildren() {
		return [CueTrack, CueClusterPosition];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: CuePoint) {
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

export class CueTrack extends ebml.UintElement {
	public static readonly id = 0xf7;
	public static readonly level = 4;
	public static readonly name = "CueTrack";


	constructor(public readonly element: ebml.Element, public readonly parent: CueTrackPositions) {
		super(element);
	}
}

export class CueClusterPosition extends ebml.UintElement {
	public static readonly id = 0xf1;
	public static readonly level = 4;
	public static readonly name = "CueClusterPosition";

	constructor(public readonly element: ebml.Element, public readonly parent: CueTrackPositions) {
		super(element);
	}

	private async getReferencedElement(): Promise<Cluster> {
		const position = await this.value;
		const segment = this.parent.parent.parent.parent;
		const blob = segment.element.data.slice(position);
		const el = await ebml.Element.fromBlob(blob);
		return new Cluster(el, segment);
	}

	public get referencedElement(): Promise<Cluster> {
		return this.getReferencedElement();
	}
}
