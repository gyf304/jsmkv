export interface BYOBlobData {
	readonly size: number;
	get(start: number, end: number): Promise<ArrayBuffer>;
}

export class BYOBlob {
	private cb: BYOBlobData;
	private options: BlobPropertyBag;
	private range: [number, number];

	constructor(cb: BYOBlobData, range?: [number, number], options?: BlobPropertyBag) {
		this.range = range ?? [0, cb.size];
		this.cb = cb;
		this.options = options ?? {};
	}

	get size(): number {
		return this.range[1] - this.range[0];
	}

	slice(start?: number, end?: number, contentType?: string): BYOBlob {
		const [s, e] = this.range;
		let [ss, ee] = [start ?? s, end ?? e];
		return new BYOBlob(this.cb, [ss, ee], { type: contentType });
	}

	async arrayBuffer(): Promise<ArrayBuffer> {
		return await this.cb.get(this.range[0], this.range[1]);
	}

	async text(): Promise<string> {
		return new TextDecoder().decode(await this.arrayBuffer());
	}

	stream(): ReadableStream<Uint8Array> {
		return new ReadableStream({
			start: async (controller) => {
				const buffer = await this.arrayBuffer();
				controller.enqueue(new Uint8Array(buffer));
				controller.close();
			},
		});
	}
}
