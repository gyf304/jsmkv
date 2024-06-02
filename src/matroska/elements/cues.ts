import type { Segment } from "./index.js";
import * as ebml from "../../ebml/index.js";
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

	public get cueTime() {
		return this.one(CueTime).then(v => v.value);
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

export class CueTime extends ebml.UintElement {
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
		return [CueTrack, CueClusterPosition, CueRelativePosition, CueDuration];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: CuePoint) {
		super(element);
	}
	public get cueTrack() {
		return this.one(CueTrack).then(v => v.value);
	}

	public get cueClusterPosition() {
		return this.one(CueClusterPosition).then(v => v.value);
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

export class CueRelativePosition extends ebml.UintElement {
	public static readonly id = 0xf0;
	public static readonly level = 4;
	public static readonly name = "CueRelativePosition";

	constructor(public readonly element: ebml.Element, public readonly parent: CueTrackPositions) {
		super(element);
	}
}

export class CueDuration extends ebml.UintElement {
	public static readonly id = 0xb2;
	public static readonly level = 4;
	public static readonly name = "CueDuration";

	constructor(public readonly element: ebml.Element, public readonly parent: CueTrackPositions) {
		super(element);
	}
}
