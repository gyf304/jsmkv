import type { Segment } from "./index.js";
import * as ebml from "../../ebml/index.js";

export class Tags extends ebml.SchemaElement {
	public static readonly id = 0x1254c367;
	public static readonly level = 1;
	public static readonly name = "Tags";

	constructor(public readonly element: ebml.Element, public readonly parent: Segment) {
		super(element);
	}
}
