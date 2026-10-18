import { BlobLike } from "../bloblike/index.js";
import * as ebml from "../ebml/index.js";
import * as mkve from "../matroska/elements/index.js";
import type { MatroskaInfo } from "./metadata.js";

export interface MatroskaSegmentReference {
	startTime: number; // in seconds
	endTime: number; // in seconds
	startByte: number; // inclusive
	endByte: number; // inclusive
	independent: boolean;
}

export interface MatroskaSegmentIndex {
	initStart: number; // inclusive
	initEnd: number; // inclusive
	segments: MatroskaSegmentReference[];
}

/**
 * Build byte-range segment references from the Segment Cues.
 *
 * Cue cluster positions are relative to the start of the Segment's data, and
 * source.size - segment.data.size locates that start when the Segment is the
 * last top-level element in the file (the normal case).
 */
export async function buildMatroskaSegmentIndex(
	source: BlobLike,
	segment: mkve.Segment,
	info: MatroskaInfo,
): Promise<MatroskaSegmentIndex> {
	const cues = await segment.getCues();
	if (cues === undefined) {
		throw new Error("Cues not found");
	}

	const segmentDataStart = source.size - segment.element.data.size;

	let firstClusterOffset = segment.element.data.size;
	{
		let offset = 0;
		const stream = new ebml.Stream(segment.element.data);
		for await (const child of stream.children) {
			if (child.id.id === mkve.Cluster.id) {
				firstClusterOffset = offset;
				break;
			}
			offset += child.size;
		}
	}

	const videoTrack = info.tracks.find((track) => track.type === "video") ?? info.tracks[0];
	const positions: { time: number; clusterPosition: number }[] = [];
	for await (const cuePoint of cues.cuePoints) {
		const time = await cuePoint.cueTime;
		for await (const trackPosition of cuePoint.cueTrackPositions) {
			if (await trackPosition.cueTrack === videoTrack?.number) {
				const clusterPosition = await trackPosition.cueClusterPosition;
				if (!positions.some((position) => position.clusterPosition === clusterPosition)) {
					positions.push({ time, clusterPosition });
				}
				break;
			}
		}
	}
	positions.sort((a, b) => a.time - b.time);

	const scale = info.timestampScale / 1e9;
	const segments: MatroskaSegmentReference[] = [];
	for (let i = 0; i < positions.length; i++) {
		const position = positions[i];
		const next = positions[i + 1];
		const startTime = position.time * scale;
		const endTime = next === undefined ? info.duration : next.time * scale;
		const startByte = segmentDataStart + position.clusterPosition;
		const endByte = next === undefined ?
			segmentDataStart + segment.element.data.size - 1 :
			segmentDataStart + next.clusterPosition - 1;
		segments.push({
			startTime,
			endTime: Math.max(endTime, startTime),
			startByte,
			endByte,
			independent: true,
		});
	}

	return {
		initStart: 0,
		initEnd: segmentDataStart + firstClusterOffset - 1,
		segments,
	};
}
