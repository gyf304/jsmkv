import * as ebml from "../ebml";
import * as elements from "./elements";

export class MKV extends ebml.SchemaStream {
	public static readonly knownChildren = [elements.EBMLHead, elements.Segment];

	constructor(public readonly stream: ebml.Stream) {
		super(stream);
	}

	private async *segmentsGenerator(): AsyncGenerator<elements.Segment> {
		let idx = 0;
		for await (const child of this.stream.children) {
			switch (idx % 2) {
				case 0:
					if (child.id.id !== elements.EBMLHead.id) {
						throw new Error("Expected EBMLHead");
					}
					break;
				case 1:
					if (child.id.id !== elements.Segment.id) {
						throw new Error("Expected Segment");
					}
					yield new elements.Segment(child);
					break;
			}
			idx++;
		}
	}

	public get segments(): AsyncGenerator<elements.Segment> {
		return this.segmentsGenerator();
	}

	public async toXML(maxLevel?: number, indent: number | string = "\t"): Promise<string> {
		const parts = await this.toXMLParts(maxLevel, indent);
		return parts.join("");
	}
}
