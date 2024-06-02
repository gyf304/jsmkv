export interface BlobLike {
	readonly size: number;
	slice(start?: number, end?: number, contentType?: string): BlobLike;
	arrayBuffer(): Promise<ArrayBuffer>;
}
