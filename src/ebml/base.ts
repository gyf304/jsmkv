import { BlobLike } from "../bloblike.js";
import { Vint } from "../vint";

interface AllOptions {
	/* cache data up to this size in bytes, or explicitly enable / disable caching */
	cache: boolean | number;
}

const defaultOptions: AllOptions = {
	cache: 1000000, // cache data up to 1MB
};

type Options = Partial<AllOptions>;

function shouldCache(blob: BlobLike, options: AllOptions): boolean {
	if (options.cache === false) {
		return false;
	}
	if (typeof options.cache === "number" && blob.size > options.cache) {
		return false;
	}
	return true;
}

export class Element {
	public readonly options: AllOptions;

	constructor(public readonly id: Vint, public readonly dataSize: Vint, public readonly data: BlobLike, options?: Options) {
		this.options = {...defaultOptions, ...options};
	}

	public get size(): number {
		return this.id.size + this.dataSize.size + this.data.size;
	}

	public get stream(): Stream {
		return new Stream(this.data, this.options);
	}

	public get children(): AsyncGenerator<Element> {
		return this.stream.children;
	}

	public static async fromBlob(blob: BlobLike, options?: Options): Promise<Element> {
		// read first 16 bytes
		const sliced = blob.slice(0, Math.min(blob.size, 16));
		const buffer = await sliced.arrayBuffer();
		const idVint = Vint.fromBytes(new Uint8Array(buffer));
		const sizeVint = Vint.fromBytes(new Uint8Array(buffer.slice(idVint.size)));
		const size = sizeVint.bigInt;
		const dataStart = idVint.size + sizeVint.size;
		const dataEnd = dataStart + Number(size);
		const dataBlob = blob.slice(dataStart, dataEnd);
		return new Element(idVint, sizeVint, dataBlob, options);
	}
}


export class Stream {
	public readonly options: AllOptions;
	public readonly cached: boolean;
	private readonly blobPromise: Promise<BlobLike>;
	private cachedChildren: Element[] = [];

	constructor(blob: BlobLike, options?: Options) {
		this.options = {...defaultOptions, ...options};
		this.cached = shouldCache(blob, this.options);
		this.blobPromise = this.cached ?
			blob.slice(0).arrayBuffer().then((buffer) => new Blob([buffer])) :
			Promise.resolve(blob);
	}

	private get cachedChildrenSize(): number {
		return this.cachedChildren.reduce((sum, child) => sum + child.size, 0);
	}

	private async *childrenGenerator(): AsyncGenerator<Element> {
		for (const cached of this.cachedChildren) {
			yield cached;
		}
		let offset = this.cachedChildrenSize;
		const blob = await this.blobPromise;
		while (offset < blob.size) {
			const element = await Element.fromBlob(
				blob.slice(offset),
				{ ...this.options, cache: this.cached ? false : this.options.cache },
			);
			this.cachedChildren.push(element);
			offset += element.size;
			// console.log(element.toString());
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
