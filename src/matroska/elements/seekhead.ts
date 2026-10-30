import { Attachments, Cluster, Cues, Info, Tags, Tracks, type Segment } from "./index.js";
import * as ebml from "../../ebml/index.js";

export class Seek extends ebml.SchemaElement {
	public static readonly id = 0x4dbb;
	public static readonly level = 2;
	public static readonly displayName = "Seek";
	public static get knownChildren() {
		return [SeekID, SeekPosition];
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
	public static readonly displayName = "SeekHead";
	public static readonly knownChildren = [Seek];


	public get seeks(): AsyncGenerator<Seek> {
		return this.many(Seek);
	}
}

export class SeekID extends ebml.VintElement {
	public static readonly id = 0x53ab;
	public static readonly level = 3;
	public static readonly displayName = "SeekID";

}

export class SeekPosition extends ebml.UintElement {
	public static readonly id = 0x53ac;
	public static readonly level = 3;
	public static readonly displayName = "SeekPosition";


	private async getReferencedElement(): Promise<ebml.SchemaElement> {
		const position = await this.value;
		const segment = this.parent?.parent?.parent as Segment | undefined;
		if (segment === undefined) {
			throw new Error("SeekPosition is not attached to a Segment");
		}
		const blob = segment.element.data.slice(position);
		const el = await ebml.Element.fromBlobLike(blob);
		const elementTypes = [
			SeekHead,
			Info,
			Cluster,
			Tracks,
			Cues,
			Tags,
			Attachments,
		] as const;
		for (const elementType of elementTypes) {
			if (elementType.id === el.id.id) {
				return new (elementType as any)(el, segment);
			}
		}
		throw new Error(`Unknown element type ${el.id.toString()}, at position ${position}`);
	}

	public get referencedElement(): Promise<ebml.SchemaElement> {
		return this.getReferencedElement();
	}
}
