import { BlobLike } from "./base";
import { LRUCache } from "lru-cache";

export class FetchBlobLike implements BlobLike {
	private constructor(
		public readonly url: string,
		public readonly size: number,
		public readonly offset: number,
		public readonly cacheBlockSize: number,
		public readonly cache: LRUCache<number, ArrayBuffer>,
	) {
		this.url = url;
		this.size = size;
	}

	static async fromUrl(
		url: string,
		cacheSize: number = 16 * 1024 * 1024,
		blockSize: number = 1024 * 1024
	): Promise<FetchBlobLike> {
		const response = await fetch(url, { method: "HEAD" });
		if (!response.ok) {
			throw new Error("Failed to fetch blob");
		}
		const size = Number(response.headers.get("Content-Length"));
		return new FetchBlobLike(url, size, 0, blockSize, new LRUCache({
			maxSize: cacheSize,
			sizeCalculation: (buffer) => buffer.byteLength,
			fetchMethod: async (index) => {
				const start = index * blockSize;
				const end = Math.min(start + blockSize, size);
				const response = await fetch(url, {
					headers: {
						"Range": `bytes=${start}-${end - 1}`,
					},
				});
				if (!response.ok) {
					throw new Error("Failed to fetch blob");
				}
				return await response.arrayBuffer();
			}
		}));
	}

	public slice(start: number = 0, end: number = this.size): BlobLike {
		const size = end - start;
		return new FetchBlobLike(this.url, end - start, this.offset + start, this.cacheBlockSize, this.cache);
	}

	public async arrayBuffer(): Promise<ArrayBuffer> {
		const blockStart = Math.floor(this.offset / this.cacheBlockSize);
		const blockEnd = Math.ceil((this.offset + this.size) / this.cacheBlockSize);
		const blocks: ArrayBuffer[] = [];

		for (let i = blockStart; i < blockEnd; i++) {
			blocks.push((await this.cache.fetch(i))!);
		}

		const blob = new Blob(blocks);
		const sliceStart = this.offset % this.cacheBlockSize;
		const sliceEnd = sliceStart + this.size;

		return await blob.slice(sliceStart, sliceEnd).arrayBuffer();
	}
}