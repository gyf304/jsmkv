import { BlobLike } from "../bloblike/index.js";
import { Vint } from "../vint/index.js";

export interface ElementHeader {
	id: Vint;
	dataSize: Vint;
	headerSize: number;
}

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

	public static async readHeader(blob: BlobLike): Promise<ElementHeader> {
		// read first 16 bytes
		const sliced = blob.slice(0, Math.min(blob.size, 16));
		const bytes = new Uint8Array(await sliced.arrayBuffer());
		const id = Vint.fromBytes(bytes);
		const dataSize = Vint.fromBytes(bytes.subarray(id.size));
		return { id, dataSize, headerSize: id.size + dataSize.size };
	}

	public static async fromBlob(blob: BlobLike): Promise<Element> {
		const header = await Element.readHeader(blob);
		const dataStart = header.headerSize;
		const dataEnd = header.dataSize.unknown ?
			blob.size :
			Math.min(dataStart + Number(header.dataSize.bigint), blob.size);
		const dataBlob = blob.slice(dataStart, dataEnd);
		return new Element(header.id, header.dataSize, dataBlob);
	}
}


export class Stream {
	constructor(private readonly blob: BlobLike) {}

	private async *childrenGenerator(): AsyncGenerator<Element> {
		let offset = 0;
		const blob = this.blob;
		while (offset < blob.size) {
			const element = await Element.fromBlob(
				blob.slice(offset),
			);
			offset += element.size;
			yield element;
		}
	}

	public get children(): AsyncGenerator<Element> {
		return this.childrenGenerator();
	}
}
