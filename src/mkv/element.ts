import { EBMLElement } from "../ebml.js";

export abstract class MKVElement {
	public static readonly id: number;
	public static readonly level: number;

	constructor(public readonly element: EBMLElement, public readonly parent?: MKVElement) {
		if (this.element.id.id !== (this as any).constructor.id) {
			throw new Error(`Expected ID ${(this as any).constructor.id}`);
		}
		if (parent !== undefined) {
			const thisName = this.constructor.name;
			const parentName = parent.constructor.name;
			const thisLevel = (this as any).constructor.level;
			const parentLevel = (parent as any).constructor.level;
			if (thisLevel !== parentLevel + 1) {
				throw new Error(`${thisName} (level ${thisLevel}) cannot be a child of ${parentName} (level ${parentLevel})`);
			}
		}
	}
	public get value(): Promise<unknown> | undefined {
		return undefined;
	}
	public toString(): string {
		const name = this.constructor.name;
		return `${name}({size: ${this.element.dataSize.bigInt}})`;
	}
}

export abstract class MKVUTF8Element extends MKVElement {
	private cachedValue?: string;

	private async getValue(): Promise<string> {
		if (this.cachedValue !== undefined) {
			return this.cachedValue;
		}
		const data = await this.element.data.text();
		this.cachedValue = data;
		return data;
	}

	public get value(): Promise<string> {
		return this.getValue();
	}

	public toString(): string {
		const name = this.constructor.name;
		return `${name}({size: ${this.element.dataSize.bigInt}, valu: ${this.cachedValue}})`;
	}
}

export abstract class MKVUintElement extends MKVElement {
	private cachedValue?: number;

	private async getValue(): Promise<number> {
		if (this.cachedValue !== undefined) {
			return this.cachedValue;
		}
		const data = await this.element.data.arrayBuffer();
		const u8 = new Uint8Array(data);
		let n = 0;
		for (let i = 0; i < u8.length; i++) {
			n = (n << 8) | u8[i];
		}
		this.cachedValue = n;
		return n;
	}

	public get value(): Promise<number> {
		return this.getValue();
	}

	public toString(): string {
		const name = this.constructor.name;
		return `${name}({size: ${this.element.dataSize.bigInt}, valu: ${this.cachedValue}})`;
	}
}
