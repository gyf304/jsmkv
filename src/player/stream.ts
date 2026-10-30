import * as mkve from "../matroska/elements/index.js";

export interface SeekPoint {
	readonly time: number;
	/** Byte position of the cue cluster, which starts with a keyframe. */
	readonly position: number;
}

export interface SeekIndex {
	readonly byTrack: ReadonlyMap<number, readonly SeekPoint[]>;
	readonly any: readonly SeekPoint[];
}

export async function readSeekPoints(
	segment: mkve.Segment,
	timestampScale: number,
): Promise<SeekIndex> {
	const cues = await segment.getCues();
	const byTrack = new Map<number, Map<number, number>>();
	const any = new Map<number, number>();
	if (cues === undefined) {
		return { byTrack: new Map(), any: [] };
	}
	for await (const cuePoint of cues.cuePoints) {
		const time = (await cuePoint.cueTime) * timestampScale / 1e9;
		let first: number | undefined;
		for await (const trackPosition of cuePoint.cueTrackPositions) {
			const position = await trackPosition.cueClusterPosition;
			const track = await trackPosition.cueTrack;
			first ??= position;
			let positions = byTrack.get(track);
			if (positions === undefined) {
				positions = new Map();
				byTrack.set(track, positions);
			}
			const previous = positions.get(position);
			positions.set(position, previous === undefined ? time : Math.min(previous, time));
		}
		if (first !== undefined) {
			const previous = any.get(first);
			any.set(first, previous === undefined ? time : Math.min(previous, time));
		}
	}
	return {
		byTrack: new Map([...byTrack.entries()]
			.map(([track, positions]) => [track, toPoints(positions)])),
		any: toPoints(any),
	};
}

function toPoints(positions: ReadonlyMap<number, number>): SeekPoint[] {
	return [...positions.entries()]
		.map(([position, time]) => ({ time, position }))
		.sort((a, b) => a.time - b.time);
}
