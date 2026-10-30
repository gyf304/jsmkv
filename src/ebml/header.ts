import { SchemaElement, UintElement, UTF8Element } from "./schema.js";

export class EBMLHead extends SchemaElement {
	public static readonly id = 0x1a45dfa3;
	public static readonly level = 0;
	public static readonly displayName = "EBMLHead";
	public static get knownChildren() {
		return [
			EBMLVersion,
			EBMLReadVersion,
			EBMLMaxIDLength,
			EBMLMaxSizeLength,
			DocType,
			DocTypeVersion,
			DocTypeReadVersion,
		];
	}
}

export class EBMLVersion extends UintElement {
	public static readonly id = 0x4286;
	public static readonly level = 1;
	public static readonly displayName = "EBMLVersion";
}

export class EBMLReadVersion extends UintElement {
	public static readonly id = 0x42f7;
	public static readonly level = 1;
	public static readonly displayName = "EBMLReadVersion";
}

export class EBMLMaxIDLength extends UintElement {
	public static readonly id = 0x42f2;
	public static readonly level = 1;
	public static readonly displayName = "EBMLMaxIDLength";
}

export class EBMLMaxSizeLength extends UintElement {
	public static readonly id = 0x42f3;
	public static readonly level = 1;
	public static readonly displayName = "EBMLMaxSizeLength";
}

export class DocType extends UTF8Element {
	public static readonly id = 0x4282;
	public static readonly level = 1;
	public static readonly displayName = "DocType";
}

export class DocTypeVersion extends UintElement {
	public static readonly id = 0x4287;
	public static readonly level = 1;
	public static readonly displayName = "DocTypeVersion";
}

export class DocTypeReadVersion extends UintElement {
	public static readonly id = 0x4285;
	public static readonly level = 1;
	public static readonly displayName = "DocTypeReadVersion";
}
