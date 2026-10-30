import type { Segment } from "./index.js";
import * as ebml from "../../ebml/index.js";

export class Tags extends ebml.SchemaElement {
	public static readonly id = 0x1254c367;
	public static readonly level = 1;
	public static readonly displayName = "Tags";

	public static get knownChildren() {
		return [Tag];
	}

}

export class Tag extends ebml.SchemaElement {
	public static readonly id = 0x7373;
	public static readonly level = 2;
	public static readonly displayName = "Tag";
	public static get knownChildren() {
		return [Targets, SimpleTag];
	}

}

export class Targets extends ebml.SchemaElement {
	public static readonly id = 0x63c0;
	public static readonly level = 3;
	public static readonly displayName = "Targets";
	public static get knownChildren() {
		return [TargetTypeValue, TargetType, TagTrackUID];
	}

}

export class TargetTypeValue extends ebml.UintElement {
	public static readonly id = 0x68ca;
	public static readonly level = 4;
	public static readonly displayName = "TargetTypeValue";

}

export class TargetType extends ebml.UTF8Element {
	public static readonly id = 0x63ca;
	public static readonly level = 4;
	public static readonly displayName = "TargetType";

}

export class SimpleTag extends ebml.SchemaElement {
	public static readonly id = 0x67c8;
	public static readonly level = 3;
	public static readonly displayName = "SimpleTag";
	public static get knownChildren() {
		return [TagName, TagLanguage, TagString, TagLanguage];
	}

}

export class TagName extends ebml.UTF8Element {
	public static readonly id = 0x45a3;
	public static readonly level = 4;
	public static readonly displayName = "TagName";

}

export class TagLanguage extends ebml.UTF8Element {
	public static readonly id = 0x447a;
	public static readonly level = 4;
	public static readonly displayName = "TagLanguage";

}

export class TagString extends ebml.UTF8Element {
	public static readonly id = 0x4487;
	public static readonly level = 4;
	public static readonly displayName = "TagString";

}

export class TagTrackUID extends ebml.UintElement {
	public static readonly id = 0x63c5;
	public static readonly level = 4;
	public static readonly displayName = "TagTrackUID";

}
