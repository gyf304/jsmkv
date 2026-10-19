import type shaka from "shaka-player";
import type { BlobLike } from "../bloblike/index.js";

type ShakaNamespace = typeof import("shaka-player").default;

/**
 * A network-backed BlobLike with no cache. Each slice is fetched with one
 * range request; CacheBlobLike is responsible for block caching.
 */
export class NetworkBlobLike implements BlobLike {
	private constructor(
		private readonly shaka: ShakaNamespace,
		private readonly networkingEngine: shaka.net.NetworkingEngine,
		private readonly retryParameters: shaka.extern.RetryParameters,
		public readonly uri: string,
		public readonly size: number,
		public readonly offset: number,
	) {}

	public static async fromUri(
		shaka: ShakaNamespace,
		playerInterface: shaka.extern.ManifestParser.PlayerInterface,
		uri: string,
	): Promise<NetworkBlobLike> {
		const engine = playerInterface.networkingEngine;
		const retryParameters = playerInterface.getStreamingRetryParameters();
		const size = await NetworkBlobLike.getSize(
			shaka, engine, retryParameters, uri);
		return new NetworkBlobLike(shaka, engine, retryParameters, uri, size, 0);
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
		return new NetworkBlobLike(
			this.shaka,
			this.networkingEngine,
			this.retryParameters,
			this.uri,
			end - start,
			this.offset + start,
		);
	}

	public async arrayBuffer(): Promise<ArrayBuffer> {
		if (this.size === 0) {
			return new ArrayBuffer(0);
		}
		const response = await NetworkBlobLike.request(
			this.shaka,
			this.networkingEngine,
			this.retryParameters,
			this.uri,
			"GET",
			{ Range: `bytes=${this.offset}-${this.offset + this.size - 1}` },
		);
		return NetworkBlobLike.toArrayBuffer(response.data);
	}

	private static async getSize(
		shaka: ShakaNamespace,
		engine: shaka.net.NetworkingEngine,
		retryParameters: shaka.extern.RetryParameters,
		uri: string,
	): Promise<number> {
		try {
			const head = await NetworkBlobLike.request(
				shaka, engine, retryParameters, uri, "HEAD", {});
			const length = NetworkBlobLike.header(head.headers, "content-length");
			if (length !== undefined) {
				const size = Number(length);
				if (Number.isFinite(size)) {
					return size;
				}
			}
		} catch {
			// Some scheme plugins do not support HEAD; fall back to a range GET.
		}

		const response = await NetworkBlobLike.request(
			shaka, engine, retryParameters, uri, "GET",
			{ Range: "bytes=0-0" },
		);
		const contentRange = NetworkBlobLike.header(response.headers, "content-range");
		const total = contentRange?.split("/")[1];
		const size = Number(total ?? NetworkBlobLike.header(response.headers, "content-length") ?? NaN);
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

	private static header(
		headers: Record<string, string>,
		name: string,
	): string | undefined {
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
}
