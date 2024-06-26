import * as ebml from "../../ebml/index.js";

import { Cluster } from "./cluster.js";
import { CuePoint, Cues } from "./cues.js";
import { Info } from "./info.js";
import { SeekHead } from "./seekhead.js";
import { Tags } from "./tags.js";
import { Tracks } from "./tracks.js";

export * from "./chapters.js";
export * from "./cluster.js";
export * from "./cues.js";
export * from "./info.js";
export * from "./seekhead.js";
export * from "./tags.js";
export * from "./tracks.js";

/*
+-------------+
| EBML Header |
+---------------------------+
| Segment     | SeekHead    |
|             |-------------|
|             | Info        |
|             |-------------|
|             | Tracks      |
|             |-------------|
|             | Chapters    |
|             |-------------|
|             | Cluster     |
|             |-------------|
|             | Cues        |
|             |-------------|
|             | Attachments |
|             |-------------|
|             | Tags        |
+---------------------------+

See https://www.matroska.org/technical/elements.html for details.
*/

export class EBMLHead extends ebml.SchemaElement {
	public static readonly id = 0x1a45dfa3;
	public static readonly level = 0;
	public static readonly name = "EBMLHead";
	public static readonly leaf = true;

	constructor(public readonly element: ebml.Element) {
		super(element);
	}
}

export class Segment extends ebml.SchemaElement {
	public static readonly id = 0x18538067;
	public static readonly level = 0;
	public static readonly name = "Segment";
	public static readonly knownChildren = [SeekHead, Info, Tracks, Cluster, Cues, Tags];

	constructor(public readonly element: ebml.Element) {
		super(element);
	}

	public get info() {
		return this.one(Info, { before: Cluster });
	}

	public get tracks() {
		return this.maybeOne(Tracks, { before: Cluster });
	}

	/**
	 * Get Cues element in Segment.
	 * @param fast If true, only search using SeekHead. If false, also search by scanning Segment.
	 */
	public async getCues(fast?: boolean): Promise<Cues | undefined> {
		for await (const seekHead of this.many(SeekHead, { before: Cluster })) {
			for await (const seek of seekHead.seeks) {
				const id = await seek.seekID.then((v) => v.value);
				if (id.id === Cues.id) {
					const position = await seek.seekPosition;
					const referenced = await position.referencedElement;
					if (!(referenced instanceof Cues)) {
						throw new Error("Referenced element is not Cues");
					}
					return referenced;
				}
			}
		}
		if (fast) {
			return undefined;
		}
		// cannot find Cues in SeekHead, try to find it in Segment
		for await (const child of this.element.children) {
			if (child.id.id === Cues.id) {
				return new Cues(child, this);
			}
			if (child.id.id === Cluster.id) {
				break;
			}
		}
		return undefined;
	}

	/**
	 * Cues element in Segment.
	 */
	public get cues(): Promise<Cues | undefined> {
		return this.getCues();
	}

	public get clusters() {
		return this.many(Cluster);
	}

	public async seekCluster(clusterPosition: number): Promise<Cluster> {
		const blob = this.element.data.slice(clusterPosition);
		const el = await ebml.Element.fromBlob(blob);
		return new Cluster(el, this);
	}

	public async *seekClusters(clusterPosition: number): AsyncGenerator<Cluster> {
		const blob = this.element.data.slice(clusterPosition);
		const stream = new ebml.Stream(blob);
		for await (const el of stream.children) {
			if (el.id.id !== Cluster.id) {
				break;
			}
			yield new Cluster(el, this);
		}
	}
}
