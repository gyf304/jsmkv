import type { Segment } from "./index.js";
import * as ebml from "../../ebml/index.js";

export class Tags extends ebml.SchemaElement {
	public static readonly id = 0x1254c367;
	public static readonly level = 1;
	public static readonly name = "Tags";

	public static get knownChildren() {
		return [Tag];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: Segment) {
		super(element);
	}
}

export class Tag extends ebml.SchemaElement {
	public static readonly id = 0x7373;
	public static readonly level = 2;
	public static readonly name = "Tag";
	public static get knownChildren() {
		return [Targets, SimpleTag];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: Tags) {
		super(element);
	}
}

export class Targets extends ebml.SchemaElement {
	public static readonly id = 0x63c0;
	public static readonly level = 3;
	public static readonly name = "Targets";
	public static get knownChildren() {
		return [TargetTypeValue, TargetType, TagTrackUID];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: Tag) {
		super(element);
	}
}

export class TargetTypeValue extends ebml.UintElement {
	public static readonly id = 0x68ca;
	public static readonly level = 4;
	public static readonly name = "TargetTypeValue";

	constructor(public readonly element: ebml.Element, public readonly parent: Targets) {
		super(element);
	}
}

export class TargetType extends ebml.UTF8Element {
	public static readonly id = 0x63ca;
	public static readonly level = 4;
	public static readonly name = "TargetType";

	constructor(public readonly element: ebml.Element, public readonly parent: Targets) {
		super(element);
	}
}

export class SimpleTag extends ebml.SchemaElement {
	public static readonly id = 0x67c8;
	public static readonly level = 3;
	public static readonly name = "SimpleTag";
	public static get knownChildren() {
		return [TagName, TagLanguage, TagString, TagLanguage];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: Tag) {
		super(element);
	}
}

export class TagName extends ebml.UTF8Element {
	public static readonly id = 0x45a3;
	public static readonly level = 4;
	public static readonly name = "TagName";

	constructor(public readonly element: ebml.Element, public readonly parent: SimpleTag) {
		super(element);
	}
}

export class TagLanguage extends ebml.UTF8Element {
	public static readonly id = 0x447a;
	public static readonly level = 4;
	public static readonly name = "TagLanguage";

	constructor(public readonly element: ebml.Element, public readonly parent: SimpleTag) {
		super(element);
	}
}

export class TagString extends ebml.UTF8Element {
	public static readonly id = 0x4487;
	public static readonly level = 4;
	public static readonly name = "TagString";

	constructor(public readonly element: ebml.Element, public readonly parent: SimpleTag) {
		super(element);
	}
}

export class TagTrackUID extends ebml.UintElement {
	public static readonly id = 0x63c5;
	public static readonly level = 4;
	public static readonly name = "TagTrackUID";

	constructor(public readonly element: ebml.Element, public readonly parent: Targets) {
		super(element);
	}
}
