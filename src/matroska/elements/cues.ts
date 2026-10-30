import type { Segment } from "./index.js";
import * as ebml from "../../ebml/index.js";

export class Cues extends ebml.SchemaElement {
	public static readonly id = 0x1c53bb6b;
	public static readonly level = 1;
	public static readonly displayName = "Cues";
	public static get knownChildren() {
		return [CuePoint];
	}


	public get cuePoints(): AsyncGenerator<CuePoint> {
		return this.many(CuePoint);
	}
}

export class CuePoint extends ebml.SchemaElement {
	public static readonly id = 0xbb;
	public static readonly level = 2;
	public static readonly displayName = "CuePoint";
	public static get knownChildren() {
		return [CueTime, CueTrackPositions];
	}


	public get cueTime() {
		return this.one(CueTime).then(v => v.value);
	}

	public get cueTrackPositions(): AsyncGenerator<CueTrackPositions> {
		return this.many(CueTrackPositions);
	}
}

export class CueTime extends ebml.UintElement {
	public static readonly id = 0xb3;
	public static readonly level = 3;
	public static readonly displayName = "CueTime";

}

export class CueTrackPositions extends ebml.SchemaElement {
	public static readonly id = 0xb7;
	public static readonly level = 3;
	public static readonly displayName = "CueTrackPositions";
	public static get knownChildren() {
		return [CueTrack, CueClusterPosition, CueRelativePosition, CueDuration];
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
	public static readonly displayName = "CueTrack";


}

export class CueClusterPosition extends ebml.UintElement {
	public static readonly id = 0xf1;
	public static readonly level = 4;
	public static readonly displayName = "CueClusterPosition";
}

export class CueRelativePosition extends ebml.UintElement {
	public static readonly id = 0xf0;
	public static readonly level = 4;
	public static readonly displayName = "CueRelativePosition";

}

export class CueDuration extends ebml.UintElement {
	public static readonly id = 0xb2;
	public static readonly level = 4;
	public static readonly displayName = "CueDuration";

}
