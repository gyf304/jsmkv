export class VInt {
	public readonly bytes: Uint8Array;

	constructor(bytes: Uint8Array | ArrayBuffer) {
		this.bytes = new Uint8Array(bytes);
	}

	public get size(): number {
		return this.bytes.length;
	}

	public static fromBytes(bytes: Uint8Array | ArrayBuffer): VInt {
		if (bytes instanceof ArrayBuffer) {
			bytes = new Uint8Array(bytes);
		}
		if (bytes.length === 0) {
			throw new Error("VInt cannot be empty");
		}
		let zeros = VInt.leadingZeros(bytes[0]);
		if (zeros === 8) {
			throw new Error("VInt cannot be all zeros");
		}
		if (bytes.length < 1 + zeros) {
			console.log("bytes", bytes);
			throw new Error("VInt is too short");
		}
		return new VInt(bytes.slice(0, 1 + zeros))
	}

	public getBytes(): Uint8Array {
		return this.bytes;
	}

	public toBigInt(): bigint {
		let zeros = VInt.leadingZeros(this.bytes[0]);
		let i = BigInt(this.bytes[0] & (0x7f >> zeros));
		for (let o = 1; o < this.bytes.length; o++) {
			i = (i << 8n) | BigInt(this.bytes[o]);
		}
		return i;
	}

	public get bigInt(): bigint {
		return this.toBigInt();
	}

	public toNumber(): number {
		let zeros = VInt.leadingZeros(this.bytes[0]);
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
		let zeros = VInt.leadingZeros(this.bytes[0]);
		if (zeros === 8) {
			return false;
		}
		if (this.bytes.length !== 1 + zeros) {
			return false;
		}
		return true;
	}

	public get unknown(): boolean {
		let zeros = VInt.leadingZeros(this.bytes[0]);
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

	public static fromBigInt(i: bigint): VInt {
		if (i === 0n) {
			return new VInt(new Uint8Array(1));
		}
		let byteLen = Math.ceil(VInt.bitLength(i) / 7);
		let bytes = new Uint8Array(byteLen);
		for (let cur = byteLen - 1; i > 0; cur--) {
			bytes[cur] = Number(i & 0xffn);
			i >>= 8n;
		}
		bytes[0] |= 0x80 >> (byteLen - 1);
		return new VInt(bytes);
	}

	public static fromNumber(i: number): VInt {
		if (i === 0) {
			return new VInt(new Uint8Array(1));
		}
		let byteLen = Math.ceil(VInt.bitLength(BigInt(i)) / 7);
		let bytes = new Uint8Array(byteLen);
		for (let cur = byteLen - 1; i > 0; cur--) {
			bytes[cur] = i & 0xff;
			i >>= 8;
		}
		bytes[0] |= 0x80 >> (byteLen - 1);
		return new VInt(bytes);
	}

	private static leadingZeros(byte: number): number {
		return Math.clz32(byte) - 24;
	}

	private static bitLength(i: bigint): number {
		return i.toString(2).length;
	}
}
