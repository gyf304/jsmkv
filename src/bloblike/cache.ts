import { BlobLike } from "./base.js";
import { LRUCache } from "lru-cache";

export class CacheBlobLike implements BlobLike {
	private cache: LRUCache<number, ArrayBuffer>;
	constructor(
		raw: BlobLike,
		public readonly start: number = 0,
		public readonly end: number = raw.size,
		private readonly cacheBlockSize: number = 1024 * 1024,
		maxCacheSize: number = 16 * 1024 * 1024,
	) {
		if (raw instanceof CacheBlobLike) {
			this.cacheBlockSize = raw.cacheBlockSize;
			this.cache = raw.cache;
			this.start = raw.start + start;
			this.end = raw.start + end;
			return;
		}
		if (start < 0) {
			throw new Error("Start must be non-negative");
		}
		if (end < start) {
			throw new Error("End must be greater than or equal to start");
		}
		this.cache = new LRUCache({
			maxSize: maxCacheSize,
			sizeCalculation: (buffer) => buffer.byteLength,
			fetchMethod: async (index) => {
				// console.log("Reading block", index);
				const start = index * cacheBlockSize;
				const end = Math.min(start + cacheBlockSize, raw.size);
				const buffer = await raw.slice(start, end).arrayBuffer();
				return buffer;
			}
		});
	}

	public get size(): number {
		return this.end - this.start;
	}

	public slice(start: number = 0, end: number = this.size): BlobLike {
		if (start < 0) {
			throw new Error("Start must be non-negative");
		}
		if (end < start) {
			throw new Error("End must be greater than or equal to start");
		}
		if (end > this.size) {
			throw new Error("End must be less than or equal to size");
		}
		return new CacheBlobLike(
			this,
			start,
			end,
		);
	}

	public async arrayBuffer(): Promise<ArrayBuffer> {
		if (this.size === 0) {
			return new ArrayBuffer(0);
		}
		const buffer = new Uint8Array(this.size);
		let inOffset = this.start;
		let outOffset = 0;
		while (outOffset < this.size) {
			const blockIndex = Math.floor(inOffset / this.cacheBlockSize);
			const blockOffset = inOffset % this.cacheBlockSize;
			const block = (await this.cache.fetch(blockIndex))!;
			const blockLength = Math.min(this.size - outOffset, block.byteLength - blockOffset);
			buffer.set(
				new Uint8Array(block, blockOffset, blockLength),
				outOffset,
			);
			inOffset += blockLength;
			outOffset += blockLength;
		}
		return buffer.buffer as ArrayBuffer;
	}
}
