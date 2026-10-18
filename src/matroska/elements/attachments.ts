import type { Segment } from "./index.js";
import * as ebml from "../../ebml/index.js";

export class Attachments extends ebml.SchemaElement {
	public static readonly id = 0x1941a469;
	public static readonly level = 1;
	public static readonly displayName = "Attachments";
	public static get knownChildren() {
		return [AttachedFile];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: Segment) {
		super(element);
	}

	public get attachedFiles(): AsyncGenerator<AttachedFile> {
		return this.many(AttachedFile);
	}
}

export class AttachedFile extends ebml.SchemaElement {
	public static readonly id = 0x61a7;
	public static readonly level = 2;
	public static readonly displayName = "AttachedFile";
	public static get knownChildren() {
		return [
			FileDescription,
			FileName,
			FileMediaType,
			FileData,
			FileUID,
		];
	}

	constructor(public readonly element: ebml.Element, public readonly parent: Attachments) {
		super(element);
	}

	public get fileDescription(): Promise<string | undefined> {
		return this.maybeOne(FileDescription).then(v => v?.value);
	}

	public get fileName(): Promise<string> {
		return this.one(FileName).then(v => v.value);
	}

	public get fileMediaType(): Promise<string> {
		return this.one(FileMediaType).then(v => v.value);
	}

	public get fileData(): Promise<ArrayBuffer> {
		return this.one(FileData).then(v => v.value);
	}

	public get fileUID(): Promise<number> {
		return this.one(FileUID).then(v => v.value);
	}
}

export class FileDescription extends ebml.UTF8Element {
	public static readonly id = 0x467e;
	public static readonly level = 3;
	public static readonly displayName = "FileDescription";

	constructor(public readonly element: ebml.Element, public readonly parent: AttachedFile) {
		super(element);
	}
}

export class FileName extends ebml.UTF8Element {
	public static readonly id = 0x466e;
	public static readonly level = 3;
	public static readonly displayName = "FileName";

	constructor(public readonly element: ebml.Element, public readonly parent: AttachedFile) {
		super(element);
	}
}

export class FileMediaType extends ebml.UTF8Element {
	public static readonly id = 0x4660;
	public static readonly level = 3;
	public static readonly displayName = "FileMediaType";

	constructor(public readonly element: ebml.Element, public readonly parent: AttachedFile) {
		super(element);
	}
}

export class FileData extends ebml.BytesElement {
	public static readonly id = 0x465c;
	public static readonly level = 3;
	public static readonly displayName = "FileData";

	constructor(public readonly element: ebml.Element, public readonly parent: AttachedFile) {
		super(element);
	}
}

export class FileUID extends ebml.UintElement {
	public static readonly id = 0x46ae;
	public static readonly level = 3;
	public static readonly displayName = "FileUID";

	constructor(public readonly element: ebml.Element, public readonly parent: AttachedFile) {
		super(element);
	}
}
