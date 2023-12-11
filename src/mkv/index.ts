import { EBMLStream } from "../ebml.js";
import * as e from "./elements/index.js";

export class MKV {
	constructor(public readonly stream: EBMLStream) {
	}

	private async *segmentsGenerator(): AsyncGenerator<e.Segment> {
		let idx = 0;
		for await (const child of this.stream.children) {
			switch (idx % 2) {
				case 0:
					if (child.id.id !== e.EBMLHead.id) {
						throw new Error("Expected EBMLHead");
					}
					break;
				case 1:
					if (child.id.id !== e.Segment.id) {
						throw new Error("Expected Segment");
					}
					yield new e.Segment(child);
					break;
			}

			idx++;
		}
	}

	public get segments(): AsyncGenerator<e.Segment> {
		return this.segmentsGenerator();
	}
}
