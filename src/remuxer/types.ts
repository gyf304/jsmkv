export interface Remuxer {
	readonly sourceMimeType: string;
	readonly targetMimeType: string;
	readonly initSegment: ArrayBuffer;

	remux(
		segments: AsyncIterable<ArrayBuffer>,
		signal?: AbortSignal,
	): AsyncIterable<ArrayBuffer>;

	reset?(): void;
}
