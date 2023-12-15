import type { Segment } from "./index.js";
import * as ebml from "../../ebml/index.js";

export class Info extends ebml.SchemaElement {
	public static readonly id = 0x1549a966;
	public static readonly level = 1;
	public static readonly name = "Info";

	constructor(public readonly element: ebml.Element, public readonly parent: Segment) {
		super(element);
	}
}
