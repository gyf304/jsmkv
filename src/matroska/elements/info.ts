import type { Segment } from "./index.js";
import * as ebml from "../../ebml/index.js";

export class Info extends ebml.SchemaElement {
	public static readonly id = 0x1549a966;
	public static readonly level = 1;
	public static readonly name = "Info";
	public static get knownChildren() {
		return [TimestampScale, MuxingApp, WritingApp, SegmentUUID, Duration];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: Segment) {
		super(element);
	}

	public get timestampScale(): Promise<number> {
		return this.one(TimestampScale).then(e => e.value);
	}

	public get duration(): Promise<number> {
		return this.one(Duration).then(e => e.value);
	}
}

export class TimestampScale extends ebml.UintElement {
	public static readonly id = 0x2ad7b1;
	public static readonly level = 2;
	public static readonly name = "TimestampScale";

	constructor(public readonly element: ebml.Element, public readonly parent: Info) {
		super(element);
	}
}

export class MuxingApp extends ebml.UTF8Element {
	public static readonly id = 0x4d80;
	public static readonly level = 2;
	public static readonly name = "MuxingApp";

	constructor(public readonly element: ebml.Element, public readonly parent: Info) {
		super(element);
	}
}

export class WritingApp extends ebml.UTF8Element {
	public static readonly id = 0x5741;
	public static readonly level = 2;
	public static readonly name = "WritingApp";

	constructor(public readonly element: ebml.Element, public readonly parent: Info) {
		super(element);
	}
}

export class SegmentUUID extends ebml.BytesElement {
	public static readonly id = 0x73a4;
	public static readonly level = 2;
	public static readonly name = "SegmentUUID";

	constructor(public readonly element: ebml.Element, public readonly parent: Info) {
		super(element);
	}
}

export class Duration extends ebml.FloatElement {
	public static readonly id = 0x4489;
	public static readonly level = 2;
	public static readonly name = "Duration";

	constructor(public readonly element: ebml.Element, public readonly parent: Info) {
		super(element);
	}
}
