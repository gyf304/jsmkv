import type shaka from "shaka-player";
import { LRUCache } from "lru-cache";
import type { BlobLike } from "../bloblike/index.js";
import type { ShakaNamespace, ShakaPlayerInterface } from "./types.js";

export class NetworkingBlobLike implements BlobLike {
	private constructor(
		private readonly shaka: ShakaNamespace,
		private readonly networkingEngine: shaka.net.NetworkingEngine,
		private readonly retryParameters: shaka.extern.RetryParameters,
		public readonly uri: string,
		public readonly size: number,
		public readonly offset: number,
		public readonly blockSize: number,
		private readonly cache: LRUCache<number, ArrayBuffer>,
	) {}

	public static async fromUri(
		shaka: ShakaNamespace,
		playerInterface: ShakaPlayerInterface,
		uri: string,
		cacheSize: number = 16 * 1024 * 1024,
		blockSize: number = 16 * 1024,
	): Promise<NetworkingBlobLike> {
		const engine = playerInterface.networkingEngine;
		const retryParameters = playerInterface.getStreamingRetryParameters();
		const size = await NetworkingBlobLike.getSize(shaka, engine, retryParameters, uri);
		return new NetworkingBlobLike(
			shaka,
			engine,
			retryParameters,
			uri,
			size,
			0,
			blockSize,
			new LRUCache({
				maxSize: cacheSize,
				sizeCalculation: (buffer) => buffer.byteLength,
				fetchMethod: async (index) => {
					const start = index * blockSize;
					const end = Math.min(start + blockSize, size);
					const response = await NetworkingBlobLike.request(
						shaka, engine, retryParameters, uri, "GET",
						{ Range: `bytes=${start}-${end - 1}` },
					);
					return NetworkingBlobLike.toArrayBuffer(response.data);
				},
			}),
		);
	}

	private static async getSize(
		shaka: ShakaNamespace,
		engine: shaka.net.NetworkingEngine,
		retryParameters: shaka.extern.RetryParameters,
		uri: string,
	): Promise<number> {
		try {
			const head = await NetworkingBlobLike.request(
				shaka, engine, retryParameters, uri, "HEAD", {},
			);
			const length = NetworkingBlobLike.header(head.headers, "content-length");
			if (length !== undefined) {
				const size = Number(length);
				if (Number.isFinite(size)) {
					return size;
				}
			}
		} catch {
			// Some scheme plugins do not support HEAD; fall back to a range GET.
		}

		const response = await NetworkingBlobLike.request(
			shaka, engine, retryParameters, uri, "GET",
			{ Range: "bytes=0-0" },
		);
		const contentRange = NetworkingBlobLike.header(response.headers, "content-range");
		const total = contentRange?.split("/")[1];
		const size = Number(total ?? NetworkingBlobLike.header(response.headers, "content-length") ?? NaN);
		if (!Number.isFinite(size)) {
			throw new Error(`Failed to determine size of ${uri}`);
		}
		return size;
	}

	private static async request(
		shaka: ShakaNamespace,
		engine: shaka.net.NetworkingEngine,
		retryParameters: shaka.extern.RetryParameters,
		uri: string,
		method: string,
		headers: Record<string, string>,
	): Promise<shaka.extern.Response> {
		const request = shaka.net.NetworkingEngine.makeRequest([uri], retryParameters);
		request.method = method;
		request.headers = headers;
		return await engine.request(
			shaka.net.NetworkingEngine.RequestType.SEGMENT,
			request,
		).promise as shaka.extern.Response;
	}

	private static header(headers: Record<string, string>, name: string): string | undefined {
		const lower = name.toLowerCase();
		for (const [key, value] of Object.entries(headers)) {
			if (key.toLowerCase() === lower) {
				return value;
			}
		}
		return undefined;
	}

	private static toArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
		if (data instanceof ArrayBuffer) {
			return data;
		}
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer as ArrayBuffer;
	}

	public slice(start: number = 0, end: number = this.size): BlobLike {
		end = Math.min(end, this.size);
		return new NetworkingBlobLike(
			this.shaka,
			this.networkingEngine,
			this.retryParameters,
			this.uri,
			end - start,
			this.offset + start,
			this.blockSize,
			this.cache,
		);
	}

	public async arrayBuffer(): Promise<ArrayBuffer> {
		const buffer = new Uint8Array(this.size);
		let inOffset = this.offset;
		let outOffset = 0;
		while (outOffset < this.size) {
			const blockIndex = Math.floor(inOffset / this.blockSize);
			const blockOffset = inOffset % this.blockSize;
			const block = (await this.cache.fetch(blockIndex))!;
			const blockLength = Math.min(this.size - outOffset, block.byteLength - blockOffset);
			buffer.set(new Uint8Array(block, blockOffset, blockLength), outOffset);
			inOffset += blockLength;
			outOffset += blockLength;
		}
		return buffer.buffer as ArrayBuffer;
	}
}
