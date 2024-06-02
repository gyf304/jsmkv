import { BlobLike } from "../bloblike";
import { Vint } from "../vint";

export class Element {
	constructor(public readonly id: Vint, public readonly dataSize: Vint, public readonly data: BlobLike) {
	}

	public get size(): number {
		return this.id.size + this.dataSize.size + this.data.size;
	}

	public get stream(): Stream {
		return new Stream(this.data);
	}

	public get children(): AsyncGenerator<Element> {
		return this.stream.children;
	}

	public static async fromBlob(blob: BlobLike): Promise<Element> {
		// read first 16 bytes
		const sliced = blob.slice(0, Math.min(blob.size, 16));
		const buffer = await sliced.arrayBuffer();
		const idVint = Vint.fromBytes(new Uint8Array(buffer));
		const sizeVint = Vint.fromBytes(new Uint8Array(buffer.slice(idVint.size)));
		const size = sizeVint.bigInt;
		const dataStart = idVint.size + sizeVint.size;
		const dataEnd = dataStart + Number(size);
		const dataBlob = blob.slice(dataStart, dataEnd);
		return new Element(idVint, sizeVint, dataBlob);
	}
}


export class Stream {
	private cachedChildren: Element[] = [];

	constructor(private readonly blob: BlobLike) {}

	private get cachedChildrenSize(): number {
		return this.cachedChildren.reduce((sum, child) => sum + child.size, 0);
	}

	private async *childrenGenerator(): AsyncGenerator<Element> {
		for (const cached of this.cachedChildren) {
			yield cached;
		}
		let offset = this.cachedChildrenSize;
		const blob = this.blob;
		while (offset < blob.size) {
			const element = await Element.fromBlob(
				blob.slice(offset),
			);
			this.cachedChildren.push(element);
			offset += element.size;
			yield element;
		}
		if (offset !== this.cachedChildrenSize) {
			throw new Error("offset !== this.cachedChildrenSize");
		}
	}

	public get children(): AsyncGenerator<Element> {
		return this.childrenGenerator();
	}
}
