import { BlobLike } from "../bloblike/base.js";
import { ConcatBlobLike } from "../bloblike/concat.js";
import { Vint } from "../vint/index.js";

export interface ElementHeader {
	id: Vint;
	dataSize: Vint;
	headerSize: number;
}

const unknownSize = Vint.fromBytes(new Uint8Array([
	0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
]));

export class Element {
	constructor(
		public readonly id: Vint,
		public readonly dataSize: Vint,
		public readonly data: BlobLike,
	) {}

	public static create(id: number | Vint, data: BlobLike): Element {
		return new Element(
			typeof id === "number" ? Vint.fromId(id) : id,
			Vint.fromNumber(data.size),
			data,
		);
	}

	public static createUnknownSize(id: number | Vint, data: BlobLike): Element {
		return new Element(
			typeof id === "number" ? Vint.fromId(id) : id,
			unknownSize,
			data,
		);
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

	public toBlobLike(): BlobLike {
		return new ConcatBlobLike([
			new Blob([this.id.bytes]),
			new Blob([this.dataSize.bytes]),
			this.data,
		]);
	}

	public static async readHeader(blob: BlobLike): Promise<ElementHeader> {
		// read first 16 bytes
		const sliced = blob.slice(0, Math.min(blob.size, 16));
		const bytes = new Uint8Array(await sliced.arrayBuffer());
		const id = Vint.fromBytes(bytes);
		const dataSize = Vint.fromBytes(bytes.subarray(id.size));
		return { id, dataSize, headerSize: id.size + dataSize.size };
	}

	public static async fromBlobLike(blob: BlobLike): Promise<Element> {
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
			const element = await Element.fromBlobLike(blob.slice(offset));
			offset += element.size;
			yield element;
		}
	}

	public get children(): AsyncGenerator<Element> {
		return this.childrenGenerator();
	}
}
