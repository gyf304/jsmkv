import { ConcatBlobLike } from "../bloblike/concat.js";
import type { BlobLike } from "../bloblike/base.js";
import { Vint } from "../vint/index.js";
import { Element, Stream } from "./base.js";

type New<T> = T extends new (...args: any) => infer R ? R : never;

type SchemaElementConstructor = {
	readonly id: number;
	readonly level?: number;
	readonly displayName: string;
	readonly knownChildren?: readonly SchemaElementConstructor[];
	readonly mandatory?: boolean;
	readonly multiple?: boolean;
	readonly leaf?: boolean;
	new (...args: any[]): SchemaElement;
	parse(element: Element, parent?: SchemaElement): SchemaElement;
};
export abstract class SchemaElement {
	// static members
	public static readonly id: number;
	public static readonly level?: number; // undefined means any level
	public static readonly displayName: string;
	public static readonly knownChildren: SchemaElementConstructor[] = [];
	public static readonly mandatory: boolean = false;
	public static readonly multiple: boolean = true;
	public static readonly leaf: boolean = false;

	private static cachedFor?: number;
	private static cachedKnownChildrenMap?: Map<number, SchemaElementConstructor> = new Map();
	private _constructor: typeof SchemaElement;

	private cache: Map<string, unknown> = new Map();

	public readonly element: Element;
	public readonly parent?: SchemaElement;

	constructor(element: Element, parent?: SchemaElement);
	constructor(...children: SchemaElement[]);
	constructor(
		children: readonly SchemaElement[],
		options?: { unknownSize?: boolean },
	);
	constructor(
		...args: [Element, SchemaElement?] |
			SchemaElement[] |
			[readonly SchemaElement[], { unknownSize?: boolean }?]
	) {
		const first = args[0];
		if (first instanceof Element) {
			this.element = first;
			this.parent = args[1] as SchemaElement | undefined;
		} else {
			const children = Array.isArray(first) ?
				first as readonly SchemaElement[] :
				args as SchemaElement[];
			const options = Array.isArray(first) ?
				args[1] as { unknownSize?: boolean } | undefined :
				undefined;
			const id = (new.target as unknown as typeof SchemaElement).id;
			const data = new ConcatBlobLike(
				children.map((child) => child.toBlobLike()),
			);
			this.element = options?.unknownSize ?
				Element.createUnknownSize(id, data) :
				Element.create(id, data);
			this.parent = undefined;
		}
		this._constructor = this.constructor as typeof SchemaElement;

		const expectedID: number = (this as any).constructor.id;
		const thisName: string = this._constructor.displayName;
		if (this.element.id.id !== expectedID && expectedID !== 0) {
			throw new Error(`Expected ID ${(this as any).constructor.id}`);
		}
		if (this.parent !== undefined) {
			const parentName = this.parent._constructor.displayName;
			const thisLevel = (this as any).constructor.level;
			const parentLevel = (this.parent as any).constructor.level;
			if (thisLevel !== undefined && thisLevel !== parentLevel + 1) {
				throw new Error(`${thisName} (level ${thisLevel}) cannot be a child of ${parentName} (level ${parentLevel})`);
			}
		}
	}

	public static parse<T extends SchemaElementConstructor>(
		this: T,
		element: Element,
		parent?: SchemaElement,
	): InstanceType<T> {
		return new (this as any)(element, parent);
	}

	public toBlobLike(): BlobLike {
		return this.element.toBlobLike();
	}

	public async cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
		if (this.cache.has(key)) {
			return this.cache.get(key) as T;
		}
		const value = fn();
		this.cache.set(key, value);
		return value;
	}

	// instance accessors of public static members
	public get id(): number {
		return this._constructor.id;
	}

	public get level(): number | undefined {
		return this._constructor.level;
	}

	public get name(): string {
		return this._constructor.displayName;
	}

	public get knownChildren(): SchemaElementConstructor[] {
		return this._constructor.knownChildren;
	}

	public get mandatory(): boolean {
		return this._constructor.mandatory;
	}

	public get multiple(): boolean {
		return this._constructor.multiple;
	}

	public get leaf(): boolean {
		return this._constructor.leaf;
	}

	public get knownChildrenMap(): Map<number, SchemaElementConstructor> {
		// use static knownChildren
		const constructor = this._constructor;
		if (constructor.cachedFor !== constructor.id) {
			constructor.cachedKnownChildrenMap = undefined;
		}
		if (constructor.cachedKnownChildrenMap !== undefined) {
			return constructor.cachedKnownChildrenMap;
		}
		const map = new Map();
		if (constructor.knownChildren !== undefined) {
			for (const child of constructor.knownChildren) {
				map.set(child.id, child);
			}
		}
		constructor.cachedKnownChildrenMap = map;
		constructor.cachedFor = constructor.id;
		return map;
	}

	protected createStream(): Stream {
		return this.element.stream;
	}

	public get stream(): SchemaStream {
		const constructor = this.constructor as unknown as typeof SchemaElement;
		if (constructor.leaf) {
			throw new Error("Cannot get stream of a leaf element");
		}
		return new ChildSchemaStream(this.createStream(), this);
	}

	public get value(): Promise<unknown> | undefined {
		return undefined;
	}

	public toString(): string {
		const name = this._constructor.displayName;
		if (this.leaf) {
			return `<${name} size="${this.element.size}" dataSize="${this.element.dataSize.number}" />`
		}
		return `<${name} />`;
	}

	public get children(): AsyncGenerator<SchemaElement> {
		const s = this.stream;
		if (s === undefined) {
			throw new Error("Cannot get children of a leaf element");
		}
		return s.children;
	}

	public maybeOne<T extends SchemaElementConstructor>(cls: T, options?: FindOptions): Promise<New<T> | undefined> {
		return this.stream.maybeOne(cls, options);
	}

	public one<T extends SchemaElementConstructor>(cls: T, options?: FindOptions): Promise<New<T>> {
		return this.stream.one(cls, options);
	}

	public many<T extends SchemaElementConstructor>(cls: T, options?: FindOptions): AsyncGenerator<New<T>> {
		return this.stream.many(cls, options);
	}

	public async toXMLParts(maxLevel?: number, indent: number | string = "\t", curIndent: string = ""): Promise<string[]> {
		const thisLevel: number | undefined = (this as any).constructor.level;
		const leaf: boolean = (this as any).constructor.leaf;

		if (leaf || (maxLevel !== undefined && thisLevel !== undefined && thisLevel >= maxLevel)) {
			return [`${curIndent}${this.toString()}\n`];
		}

		let indentStr = "";
		if (typeof indent === "number") {
			indentStr = " ".repeat(indent);
		} else if (typeof indent === "string") {
			indentStr = indent;
		} else {
			throw new Error("Invalid indent");
		}

		const nextIndent = curIndent + indentStr;
		let parts: string[] = [];
		const stream = this.stream;
		if (stream !== undefined) {
			parts.push(`${curIndent}<${this._constructor.displayName}>\n`);
			parts.push(...await stream.toXMLParts(maxLevel, indent, nextIndent));
			parts.push(`${curIndent}</${this._constructor.displayName}>\n`);
		} else {
			parts.push(`${curIndent}<${this._constructor.displayName} />\n`);
		}

		return parts;
	}

	public async toXML(maxLevel?: number, indent: number | string = "\t", curIndent: string = ""): Promise<string> {
		const parts = await this.toXMLParts(maxLevel, indent, curIndent);
		return parts.join("");
	}
}

export class UnknownElement extends SchemaElement {
	public static readonly id = 0;
	public static readonly level = undefined;
	public static readonly displayName = "Unknown";

	public override async toXMLParts(maxLevel?: number, indent: number | string = "\t", curIndent: string = ""): Promise<string[]> {
		return [`${curIndent}${this.toString()}\n`];
	}

	public toString(): string {
		return `<Unknown id="${this.element.id.toString()}" />`;
	}
}

export abstract class UTF8Element extends SchemaElement {
	public static readonly leaf = true;

	constructor(value: string, parent?: SchemaElement);
	constructor(element: Element, parent?: SchemaElement);
	constructor(value: string | Element, parent?: SchemaElement) {
		if (value instanceof Element) {
			super(value, parent);
		} else {
			const id = (new.target as unknown as typeof SchemaElement).id;
			super(Element.create(id, new Blob([new TextEncoder().encode(value)])));
		}
	}

	private cachedValue?: string;

	private async getValue(): Promise<string> {
		if (this.cachedValue !== undefined) {
			return this.cachedValue;
		}
		const data = await this.element.data.arrayBuffer();
		const decoder = new TextDecoder();
		const text = decoder.decode(data).replace(/\0.*$/g, "");
		this.cachedValue = text;
		return text;
	}

	public get value(): Promise<string> {
		return this.getValue();
	}

	public async toXMLParts(maxLevel?: number, indent: number | string = "\t", curIndent: string = ""): Promise<string[]> {
		const text = await this.getValue();
		return [`${curIndent}<${this.name}>${text}</${this.name}>\n`]; // TODO: proper escaping
	}
}

export abstract class UintElement extends SchemaElement {
	public static readonly leaf = true;

	constructor(value: number, parent?: SchemaElement);
	constructor(element: Element, parent?: SchemaElement);
	constructor(value: number | Element, parent?: SchemaElement) {
		if (value instanceof Element) {
			super(value, parent);
		} else {
			const id = (new.target as unknown as typeof SchemaElement).id;
			super(Element.create(id, new Blob([uintBytes(value)])));
		}
	}

	private cachedValue?: bigint;

	private async getBigintValue(): Promise<bigint> {
		if (this.cachedValue !== undefined) {
			return this.cachedValue;
		}
		const data = await this.element.data.arrayBuffer();
		const u8 = new Uint8Array(data);
		let n = 0n;
		for (let i = 0; i < u8.length; i++) {
			n = (n << 8n) | BigInt(u8[i]);
		}
		this.cachedValue = n;
		return n;
	}

	public get value(): Promise<number> {
		return this.getBigintValue().then(n => Number(n));
	}

	public get bigIntValue(): Promise<bigint> {
		return this.getBigintValue();
	}

	public async toXMLParts(maxLevel?: number, indent: number | string = "\t", curIndent: string = ""): Promise<string[]> {
		const n = await this.getBigintValue();
		return [`${curIndent}<${this.name}>${n}</${this.name}>\n`];
	}
}

export abstract class FloatElement extends SchemaElement {
	public static readonly leaf = true;

	constructor(value: number, parent?: SchemaElement);
	constructor(element: Element, parent?: SchemaElement);
	constructor(value: number | Element, parent?: SchemaElement) {
		if (value instanceof Element) {
			super(value, parent);
		} else {
			const id = (new.target as unknown as typeof SchemaElement).id;
			super(Element.create(id, new Blob([floatBytes(value)])));
		}
	}

	private cachedValue?: number;

	private async getValue(): Promise<number> {
		if (this.cachedValue !== undefined) {
			return this.cachedValue;
		}
		const data = await this.element.data.arrayBuffer();
		const view = new DataView(data);
		switch (data.byteLength) {
			case 0:
				this.cachedValue = 0;
				break;
			case 4:
				this.cachedValue = view.getFloat32(0);
				break;
			case 8:
				this.cachedValue = view.getFloat64(0);
				break;
			default:
				throw new Error("Invalid float size");
		}
		return this.cachedValue;
	}

	public get value(): Promise<number> {
		return this.getValue();
	}

	public async toXMLParts(maxLevel?: number, indent: number | string = "\t", curIndent: string = ""): Promise<string[]> {
		const n = await this.getValue();
		return [`${curIndent}<${this.name}>${n}</${this.name}>\n`];
	}
}

export class VoidElement extends SchemaElement {
	public static readonly id = 0xec;
	public static readonly leaf = true;

	public get value(): Promise<void> {
		return Promise.resolve();
	}
}

export class Crc32Element extends SchemaElement {
	public static readonly id = 0xbf;
	public static readonly displayName = "CRC-32";
	public static readonly leaf = true;

	private async getValue(): Promise<number> {
		// 4 bytes
		const data = await this.element.data.arrayBuffer();
		const view = new DataView(data);
		return view.getUint32(0);
	}

	public get value(): Promise<number> {
		return this.getValue();
	}
}

export abstract class BytesElement extends SchemaElement {
	public static readonly leaf = true;

	constructor(value: BlobLike, parent?: SchemaElement);
	constructor(element: Element, parent?: SchemaElement);
	constructor(value: BlobLike | Element, parent?: SchemaElement) {
		if (value instanceof Element) {
			super(value, parent);
		} else {
			const id = (new.target as unknown as typeof SchemaElement).id;
			super(Element.create(id, value));
		}
	}

	private cachedValue?: ArrayBuffer;

	private async getValue(): Promise<ArrayBuffer> {
		if (this.cachedValue !== undefined) {
			return this.cachedValue;
		}
		const data = await this.element.data.arrayBuffer();
		this.cachedValue = data;
		return data;
	}

	public get value(): Promise<ArrayBuffer> {
		return this.getValue();
	}
}

export abstract class VintElement extends SchemaElement {
	public static readonly leaf = true;

	private cachedValue?: Vint;

	private async getValue(): Promise<Vint> {
		if (this.cachedValue !== undefined) {
			return this.cachedValue;
		}
		const data = await this.element.data.arrayBuffer();
		this.cachedValue = new Vint(data);
		return this.cachedValue;
	}

	public get value(): Promise<Vint> {
		return this.getValue();
	}

	public async toXMLParts(maxLevel?: number, indent: number | string = "\t", curIndent: string = ""): Promise<string[]> {
		const vint = await this.getValue();
		return [`${curIndent}<${this.name}>${vint.number}</${this.name}>\n`];
	}
}

export abstract class EnumElement<T extends string> extends SchemaElement {
	public static readonly leaf = true;
	public static readonly values: readonly string[];

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
		return n;
	}

	public get value(): Promise<T> {
		return this.getValue().then(n => (this.constructor as typeof EnumElement).values[n] as T);
	}
}

export abstract class BitMaskElement<T extends string> extends SchemaElement {
	public static readonly leaf = true;
	public static readonly values: readonly (string | undefined)[];

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
		return n;
	}

	public get value(): Promise<Set<T>> {
		return this.getValue().then(n => {
			const values: Set<T> = new Set();
			for (let i = 0; i < 8; i++) {
				if ((n & (1 << i)) !== 0) {
					values.add((this.constructor as typeof BitMaskElement).values[i] as T);
				}
			}
			return values;
		});
	}
}

interface FindOptions {
	before?: typeof SchemaElement;
}

export abstract class SchemaStream {
	public static readonly knownChildren: SchemaElementConstructor[] = [];
	private static cachedKnownChildrenMap?: Map<number, SchemaElementConstructor>;

	public constructor(public readonly stream: Stream, public readonly parent?: SchemaElement) {}

	public get knownChildrenMap(): Map<number, SchemaElementConstructor> {
		const constructor = this.constructor as unknown as typeof SchemaStream;
		if (constructor.cachedKnownChildrenMap !== undefined) {
			return constructor.cachedKnownChildrenMap;
		}
		const map = new Map();
		if (constructor.knownChildren !== undefined) {
			for (const child of constructor.knownChildren) {
				map.set(child.id, child);
			}
		}
		constructor.cachedKnownChildrenMap = map;
		return map;
	}

	private async *childrenGenerator(): AsyncGenerator<SchemaElement> {
		for await (const child of this.stream.children) {
			const id = child.id.id;

			const childConstructor = this.knownChildrenMap.get(id);
			if (childConstructor !== undefined) {
				yield childConstructor.parse(child, this.parent);
			} else if ( id === VoidElement.id ) {
				yield new VoidElement(child, this.parent);
			} else if ( id === Crc32Element.id ) {
				yield new Crc32Element(child, this.parent);
			} else {
				yield new UnknownElement(child, this.parent);
			}
		}
	}

	public get children(): AsyncGenerator<SchemaElement> {
		return this.childrenGenerator();
	}

	public async maybeOne<T extends SchemaElementConstructor>(cls: T, options?: FindOptions): Promise<New<T> | undefined> {
		for await (const child of this.stream.children) {
			if (child.id.id === options?.before?.id) {
				break;
			}
			if (child.id.id === cls.id) {
				if ((cls as unknown) === SchemaElement) {
					throw new Error("Cannot use SchemaElement as a type");
				}
				return cls.parse(child, this.parent) as New<T>;
			}
		}
	}

	public async one<T extends SchemaElementConstructor>(cls: T, options?: FindOptions): Promise<New<T>> {
		const result = await this.maybeOne(cls, options);
		if (result === undefined) {
			throw new Error(`Expected ${cls.displayName}`);
		}
		return result;
	}

	public async *many<T extends SchemaElementConstructor>(cls: T, options?: FindOptions): AsyncGenerator<New<T>> {
		for await (const child of this.stream.children) {
			if (child.id.id === cls.id) {
				if ((cls as unknown) === SchemaElement) {
					throw new Error("Cannot use SchemaElement as a type");
				}
				yield cls.parse(child, this.parent) as New<T>;
			} else if (child.id.id === options?.before?.id) {
				break;
			}
		}
	}

	public async toXMLParts(maxLevel?: number, indent: number | string = "\t", curIndent: string = ""): Promise<string[]> {
		const parts: string[] = [];
		for await (const child of this.children) {
			parts.push(...await child.toXMLParts(maxLevel, indent, curIndent));
		}
		return parts;
	}
}

class ChildSchemaStream extends SchemaStream {
	constructor(stream: Stream, parent: SchemaElement) {
		super(stream, parent);
	}

	public get knownChildrenMap(): Map<number, SchemaElementConstructor> {
		return this.parent!.knownChildrenMap;
	}
}

function uintBytes(value: number): Uint8Array {
	if (value === 0) {
		return new Uint8Array([0]);
	}
	const bytes: number[] = [];
	while (value > 0) {
		bytes.unshift(value & 0xff);
		value = Math.floor(value / 256);
	}
	return new Uint8Array(bytes);
}

function floatBytes(value: number): Uint8Array {
	const buffer = new ArrayBuffer(8);
	new DataView(buffer).setFloat64(0, value, false);
	return new Uint8Array(buffer);
}
