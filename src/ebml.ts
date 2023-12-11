import { BYOBlob } from "./byoblob.js";
import { VInt } from "./vint.js";

export class EBMLElement {
	constructor(public readonly id: VInt, public readonly dataSize: VInt, public readonly data: BYOBlob | Blob) {
	}

	public get size(): number {
		return this.id.size + this.dataSize.size + this.data.size;
	}

	public get document(): EBMLStream {
		return new EBMLStream(this.data);
	}

	public get children(): AsyncGenerator<EBMLElement> {
		return this.document.children;
	}

	public static async fromBlob(blob: BYOBlob | Blob): Promise<EBMLElement> {
		// read first 16 bytes
		const sliced = blob.slice(0, Math.min(blob.size, 24));
		const buffer = await sliced.arrayBuffer();
		const idVInt = VInt.fromBytes(new Uint8Array(buffer));
		const sizeVInt = VInt.fromBytes(new Uint8Array(buffer.slice(idVInt.size)));
		const size = sizeVInt.bigInt;
		const dataStart = idVInt.size + sizeVInt.size;
		// console.log("dataStart", dataStart);
		const dataEnd = dataStart + Number(size);
		const dataBlob = blob.slice(dataStart, dataEnd);
		return new EBMLElement(idVInt, sizeVInt, dataBlob);
	}

	public toString(): string {
		return `EBMLElement(${this.id.toString()}, ${this.dataSize.bigInt})`;
	}

	public toJSON(): string {
		return this.toString();
	}
}

export interface EBMLStreamOptions {
	validChildVInts?: bigint[];
}

export class EBMLStream {
	private blob: BYOBlob | Blob;
	private options: EBMLStreamOptions;
	private cachedChildren: EBMLElement[] = [];

	constructor(blob: BYOBlob | Blob, options?: EBMLStreamOptions) {
		this.blob = blob;
		this.options = options ?? {};
	}

	private get cachedChildrenSize(): number {
		return this.cachedChildren.reduce((sum, child) => sum + child.size, 0);
	}

	private async *childrenGenerator(): AsyncGenerator<EBMLElement> {
		for (const cached of this.cachedChildren) {
			yield cached;
		}
		let offset = this.cachedChildrenSize;
		while (offset < this.blob.size) {
			const element = await EBMLElement.fromBlob(this.blob.slice(offset));
			this.cachedChildren.push(element);
			offset += element.size;
			// console.log(element.toString());
			yield element;
		}
		if (offset !== this.cachedChildrenSize) {
			throw new Error("offset !== this.cachedChildrenSize");
		}
	}

	public get children(): AsyncGenerator<EBMLElement> {
		return this.childrenGenerator();
	}
}
