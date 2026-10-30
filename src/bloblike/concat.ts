import type { BlobLike } from "./base.js";

export class ConcatBlobLike implements BlobLike {
	constructor(private readonly parts: readonly BlobLike[]) {}

	public get size(): number {
		return this.parts.reduce((sum, part) => sum + part.size, 0);
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
		const parts: BlobLike[] = [];
		let offset = 0;
		for (const part of this.parts) {
			const partStart = offset;
			const partEnd = offset + part.size;
			offset = partEnd;
			if (partEnd <= start || partStart >= end) {
				continue;
			}
			parts.push(part.slice(
				Math.max(start, partStart) - partStart,
				Math.min(end, partEnd) - partStart,
			));
		}
		return new ConcatBlobLike(parts);
	}

	public async arrayBuffer(): Promise<ArrayBuffer> {
		const output = new Uint8Array(this.size);
		let offset = 0;
		for (const part of this.parts) {
			output.set(new Uint8Array(await part.arrayBuffer()), offset);
			offset += part.size;
		}
		return output.buffer as ArrayBuffer;
	}
}
