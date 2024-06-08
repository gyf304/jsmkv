import type { Segment } from "./index.js";
import * as ebml from "../../ebml/index.js";

export class Seek extends ebml.SchemaElement {
	public static readonly id = 0x4dbb;
	public static readonly level = 2;
	public static readonly name = "Seek";
	public static get knownChildren() {
		return [SeekID, SeekPosition];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: SeekHead) {
		super(element);
	}

	public get seekID(): Promise<SeekID> {
		return this.one(SeekID);
	}

	public get seekPosition(): Promise<SeekPosition> {
		return this.one(SeekPosition);
	}
}

export class SeekHead extends ebml.SchemaElement {
	public static readonly id = 0x114d9b74;
	public static readonly level = 1;
	public static readonly name = "SeekHead";
	public static readonly knownChildren = [Seek];

	constructor(public readonly element: ebml.Element, public readonly parent: Segment) {
		super(element);
	}

	public get seeks(): AsyncGenerator<Seek> {
		return this.many(Seek);
	}
}

export class SeekID extends ebml.VintElement {
	public static readonly id = 0x53ab;
	public static readonly level = 3;
	public static readonly name = "SeekID";

	constructor(public readonly element: ebml.Element, public readonly parent: Seek) {
		super(element);
	}
}

export class SeekPosition extends ebml.UintElement {
	public static readonly id = 0x53ac;
	public static readonly level = 3;
	public static readonly name = "SeekPosition";

	constructor(public readonly element: ebml.Element, public readonly parent: Seek) {
		super(element);
	}

	private async getReferencedElement(): Promise<ebml.SchemaElement> {
		const position = await this.value;
		const segment = this.parent.parent.parent;
		const blob = segment.element.data.slice(position);
		const el = await ebml.Element.fromBlob(blob);
		const indexImport = await import("./index.js");
		const elementTypes = Object.values(indexImport).filter((v) => v instanceof Function);
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

	public get referencedElement(): Promise<ebml.SchemaElement> {
		return this.getReferencedElement();
	}
}
