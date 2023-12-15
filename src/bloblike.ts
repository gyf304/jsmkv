export interface BlobLike {
	readonly size: number;
	slice(start?: number, end?: number, contentType?: string): BlobLike;
	arrayBuffer(): Promise<ArrayBuffer>;
	text(): Promise<string>;
	stream(): ReadableStream<Uint8Array>;
}
