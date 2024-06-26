import type { Segment } from "./index.js";
import * as ebml from "../../ebml/index.js";
import { Vint } from "../../vint/index.js";

export class Cluster extends ebml.SchemaElement {
	public static readonly id = 0x1f43b675;
	public static readonly level = 1;
	public static readonly name = "Cluster";
	public static get knownChildren() {
		return [Timestamp, SimpleBlock];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: Segment) {
		super(element);
	}

	public get timestamp() {
		return this.one(Timestamp).then(e => e.value);
	}

	public get simpleBlocks() {
		return this.many(SimpleBlock);
	}
}

export class Timestamp extends ebml.UintElement {
	public static readonly id = 0xe7;
	public static readonly level = 2;
	public static readonly name = "Timestamp";

	constructor(public readonly element: ebml.Element, public readonly parent: Cluster) {
		super(element);
	}
}

const lacing = ["none", "Xiph", "fixed-size", "EBML"] as const;
type Lacing = typeof lacing[number];

/**
 * SimpleBlock
 * see: https://www.matroska.org/technical/notes.html#:~:text=SimpleBlock%20Structure
 */
export class SimpleBlock extends ebml.SchemaElement {
	public static readonly id = 0xa3;
	public static readonly level = 2;
	public static readonly name = "SimpleBlock";
	public static readonly leaf = true;

	constructor(public readonly element: ebml.Element, public readonly parent: Cluster) {
		super(element);
	}

	private cachedTrackNumber?: number;
	private cachedTrackNumberSize?: number;
	private async getTrackNumber(): Promise<number> {
		if (this.cachedTrackNumber) {
			return this.cachedTrackNumber;
		}
		const blob = await this.element.data;
		const vint = await Vint.fromBlob(blob);
		this.cachedTrackNumber = vint.number;
		this.cachedTrackNumberSize = vint.size;
		return this.cachedTrackNumber;
	}

	public get trackNumber(): Promise<number> {
		return this.getTrackNumber();
	}

	private cachedTimestamp?: number;
	private cachedTimestampSize = 2;
	private async getTimestamp(): Promise<number> {
		if (this.cachedTimestamp) {
			return this.cachedTimestamp;
		}
		await this.getTrackNumber();
		const tnSize = this.cachedTrackNumberSize!;
		// 2-byte timestamp
		const bytes = await this.element.data.slice(tnSize, tnSize + 2).arrayBuffer();
		const view = new DataView(bytes);
		this.cachedTimestamp = view.getInt16(0, false);
		return this.cachedTimestamp;
	}

	public get timestamp(): Promise<number> {
		return this.getTimestamp();
	}

	private cachedHeaderFlags?: number;
	private cachedHeaderFlagsSize = 1;
	private async getHeaderFlags(): Promise<number> {
		if (this.cachedHeaderFlags) {
			return this.cachedHeaderFlags;
		}
		await this.getTimestamp();
		const prevSize = this.cachedTrackNumberSize! + this.cachedTimestampSize;
		const bytes = await this.element.data.slice(prevSize, prevSize + 1).arrayBuffer();
		const u8 = new Uint8Array(bytes);
		this.cachedHeaderFlags = u8[0];
		return this.cachedHeaderFlags;
	}

	public get headerFlags(): Promise<number> {
		return this.getHeaderFlags();
	}

	public get keyframe(): Promise<boolean> {
		// bit 0, high-order bit
		return this.getHeaderFlags().then(flags => !!(flags & 0x80));
	}

	public get invisible(): Promise<boolean> {
		// bit 4
		return this.getHeaderFlags().then(flags => !!(flags & 0x8));
	}

	public get lacing(): Promise<Lacing> {
		// bits 5-6, high-order bits
		const num = this.getHeaderFlags().then(flags => (flags & 0x6) >> 1);
		const val = num
			.then(n => lacing[n])
			.then(l => {
				if (l === undefined) {
					throw new Error(`Invalid lacing value: ${num}`);
				}
				return l;
			})
		return val;
	}

	public get discardable(): Promise<boolean> {
		// bit 7
		return this.getHeaderFlags().then(flags => !!(flags & 0x1));
	}

	private cachedFrameCount?: number;
	private cachedFrameCountSize?: number;
	private async getFrameCount(): Promise<number> {
		if (this.cachedFrameCount) {
			return this.cachedFrameCount;
		}
		const lacing = await this.lacing;
		if (lacing === "none") {
			this.cachedFrameCount = 1;
			this.cachedFrameCountSize = 0;
			return 1;
		}
		const prevSize = this.cachedTrackNumberSize! + 2 + 1;
		const blob = this.element.data.slice(prevSize);
		if (lacing === "Xiph" || lacing === "fixed-size" || lacing === "EBML") {
			const u8 = new Uint8Array(await blob.slice(0, 1).arrayBuffer());
			if (u8.length === 0) {
				throw new Error("Invalid Xiph lacing");
			}
			this.cachedFrameCount = u8[0] + 1;
			this.cachedFrameCountSize = 1;
			return this.cachedFrameCount;
		} else {
			throw new Error(`Invalid lacing value: ${lacing}`);
		}
	}

	public get frameCount(): Promise<number> {
		return this.getFrameCount();
	}

	private cachedFrameSizes?: number[];
	private cachedFrameSizesSize?: number;
	private async getFrameSizes(): Promise<number[]> {
		const tn = await this.trackNumber;
		const ts = await this.timestamp;
		// console.log("getFrameSizes", tn, ts);
		if (this.cachedFrameSizes) {
			return this.cachedFrameSizes;
		}
		await this.getFrameCount();
		const lacing = await this.lacing;
		const prevSize = this.cachedTrackNumberSize! + this.cachedTimestampSize
			+ this.cachedHeaderFlagsSize + this.cachedFrameCountSize!;
		if (lacing === "none") {
			const dataSize = this.element.data.size;
			const size = dataSize - prevSize;
			this.cachedFrameSizes = [size];
			this.cachedFrameSizesSize = 0;
			return [size];
		} else if (lacing === "Xiph") {
			const blob = this.element.data.slice(prevSize);
			// read byte by byte
			// TODO: optimize?
			const frameCount = await this.getFrameCount();
			const sizes: number[] = [];
			let offset = 0;
			for (let i = 0; i < frameCount - 1; i++) {
				let size = 0;
				let o: number; // current octet
				do {
					const bytes = await blob.slice(offset, offset + 1).arrayBuffer();
					const u8 = new Uint8Array(bytes);
					o = u8[0];
					size += o;
					offset++;
				} while (o === 0xff);
			}
			const remainingSize = blob.size - offset;
			sizes.push(remainingSize);
			this.cachedFrameSizes = sizes;
			this.cachedFrameSizesSize = offset;
			return sizes;
		} else if (lacing === "fixed-size") {
			const blob = this.element.data.slice(prevSize);
			const frameCount = await this.getFrameCount();
			const frameSize = Math.floor(blob.size / frameCount);
			const sizes = new Array(frameCount).fill(frameSize);
			this.cachedFrameSizes = sizes;
			this.cachedFrameSizesSize = 0;
			return sizes;
		} else if (lacing === "EBML") {
			const frameCount = await this.getFrameCount();
			const blob = this.element.data.slice(prevSize);
			const sizes: number[] = [];
			let offset = 0;
			let sizeSum = 0;
			// first frame
			const firstVint = await Vint.fromBlob(blob.slice(offset));
			sizes.push(firstVint.number);
			offset += firstVint.size;
			sizeSum += firstVint.number;
			for (let i = 1; i < frameCount - 1; i++) {
				// other frames
				const vint = await Vint.fromBlob(blob.slice(offset));
				const vintNumber = vint.number;
				const signed = vintNumber - ((2 ** (7 * vint.size - 1)) - 1);
				const size = sizes[i - 1] + signed;
				sizes.push(size);
				offset += vint.size;
				sizeSum += size;
			}
			const remainingSize = blob.size - offset - sizeSum;
			sizes.push(remainingSize);
			this.cachedFrameSizes = sizes;
			this.cachedFrameSizesSize = offset;
			return sizes;
		} else {
			throw new Error(`Invalid lacing value: ${lacing}`);
		}
	}

	public get frames(): AsyncGenerator<Uint8Array> {
		return (async function* (this: SimpleBlock) {
			const sizes = await this.getFrameSizes();
			let offset = this.cachedTrackNumberSize! + this.cachedTimestampSize
				+ this.cachedHeaderFlagsSize + this.cachedFrameCountSize!
				+ this.cachedFrameSizesSize!;
			for (const size of sizes) {
				const data = await this.element.data.slice(offset, offset + size).arrayBuffer();
				yield new Uint8Array(data);
				offset += size;
			}
		}).bind(this)();
	}

	public get data(): Promise<ArrayBuffer> {
		return this.getFrameSizes().then((sizes) => {
			let offset = this.cachedTrackNumberSize! + this.cachedTimestampSize
				+ this.cachedHeaderFlagsSize + this.cachedFrameCountSize!
				+ this.cachedFrameSizesSize!;
			return this.element.data.slice(offset).arrayBuffer();
		});
	}

	public async toXMLParts(maxLevel?: number, indent: number | string = "\t", curIndent: string = ""): Promise<string[]> {
		return [`${curIndent}<${this.constructor.name} track="${await this.trackNumber}" timestamp="${await this.timestamp}" framesizes="${JSON.stringify(await this.getFrameSizes())}" />\n`];
	}
}
