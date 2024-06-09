import { BlobLike } from "./base.js";
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
					redirect: "follow",
				});
				if (!response.ok) {
					throw new Error("Failed to fetch blob");
				}
				if (response.status !== 206) {
					throw new Error("Server does not support range requests");
				}
				return await response.arrayBuffer();
			}
		}));
	}

	public slice(start: number = 0, end: number = this.size): BlobLike {
		end = Math.min(end, this.size);
		return new FetchBlobLike(
			this.url,
			end - start,
			this.offset + start,
			this.cacheBlockSize,
			this.cache,
		);
	}

	public async arrayBuffer(): Promise<ArrayBuffer> {
		const buffer = new Uint8Array(this.size);
		let inOffset = this.offset;
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