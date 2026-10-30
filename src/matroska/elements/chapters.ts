import type { Segment } from "./index.js";
import * as ebml from "../../ebml/index.js";

export class Chapters extends ebml.SchemaElement {
	public static readonly id = 0x1043a770;
	public static readonly level = 1;
	public static readonly displayName = "Chapters";

}
