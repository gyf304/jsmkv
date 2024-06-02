import { BlobLike } from "../bloblike";

export class Vint {
	public readonly bytes: Uint8Array;

	constructor(bytes: Uint8Array | ArrayBuffer) {
		this.bytes = new Uint8Array(bytes);
	}

	public get size(): number {
		return this.bytes.length;
	}

	public static fromBytes(bytes: Uint8Array | ArrayBuffer): Vint {
		if (bytes instanceof ArrayBuffer) {
			bytes = new Uint8Array(bytes);
		}
		if (bytes.length === 0) {
			throw new Error("Vint cannot be empty");
		}
		let zeros = Vint.leadingZeros(bytes[0]);
		if (zeros === 8) {
			throw new Error("Vint cannot be all zeros");
		}
		if (bytes.length < 1 + zeros) {
			throw new Error("Vint is too short");
		}
		return new Vint(bytes.slice(0, 1 + zeros))
	}

	public static async fromBlob(blob: BlobLike): Promise<Vint> {
		const buffer = await blob.slice(0, 8).arrayBuffer();
		return Vint.fromBytes(new Uint8Array(buffer));
	}

	public getBytes(): Uint8Array {
		return this.bytes;
	}

	public toBigInt(): bigint {
		let zeros = Vint.leadingZeros(this.bytes[0]);
		let i = BigInt(this.bytes[0] & (0x7f >> zeros));
		for (let o = 1; o < this.bytes.length; o++) {
			i = (i << 8n) | BigInt(this.bytes[o]);
		}
		return i;
	}

	public get bigint(): bigint {
		return this.toBigInt();
	}

	public toNumber(): number {
		let zeros = Vint.leadingZeros(this.bytes[0]);
		let i = this.bytes[0] & (0x7f >> zeros);
		for (let o = 1; o < this.bytes.length; o++) {
			i = (i << 8) | this.bytes[o];
		}
		return i;
	}

	public get number(): number {
		return this.toNumber();
	}

	public get id(): number {
		let i = 0;
		for (const b of this.bytes) {
			i = (i << 8) | b;
		}
		return i;
	}

	public toString(): string {
		return `0x${this.bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "")}`;
	}

	public toJSON(): string {
		return this.toString();
	}

	public get valid(): boolean {
		let zeros = Vint.leadingZeros(this.bytes[0]);
		if (zeros === 8) {
			return false;
		}
		if (this.bytes.length !== 1 + zeros) {
			return false;
		}
		return true;
	}

	public get unknown(): boolean {
		let zeros = Vint.leadingZeros(this.bytes[0]);
		if (this.bytes[0] !== (0xff >> zeros)) {
			return false;
		}
		for (const b of this.bytes.slice(1)) {
			if (b !== 0xff) {
				return false;
			}
		}
		return true;
	}

	public static fromBigInt(i: bigint): Vint {
		if (i === 0n) {
			return new Vint(new Uint8Array(1));
		}
		let byteLen = Math.ceil(Vint.bitLength(i) / 7);
		let bytes = new Uint8Array(byteLen);
		for (let cur = byteLen - 1; i > 0; cur--) {
			bytes[cur] = Number(i & 0xffn);
			i >>= 8n;
		}
		bytes[0] |= 0x80 >> (byteLen - 1);
		return new Vint(bytes);
	}

	public static fromNumber(i: number): Vint {
		if (i === 0) {
			return new Vint(new Uint8Array(1));
		}
		let byteLen = Math.ceil(Vint.bitLength(BigInt(i)) / 7);
		let bytes = new Uint8Array(byteLen);
		for (let cur = byteLen - 1; i > 0; cur--) {
			bytes[cur] = i & 0xff;
			i >>= 8;
		}
		bytes[0] |= 0x80 >> (byteLen - 1);
		return new Vint(bytes);
	}

	private static leadingZeros(byte: number): number {
		return Math.clz32(byte) - 24;
	}

	private static bitLength(i: bigint): number {
		return i.toString(2).length;
	}
}
