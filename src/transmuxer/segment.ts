import * as mkve from "../matroska/elements/index.js";
import { Attachment } from "./attachment.js";
import { CuePointTransmuxer } from "./cue.js";
import {
	TrackMuxer,
	TrackTransmuxer,
	readSegmentInfo,
	type SegmentInfo,
} from "./track.js";

interface CueRange {
	startTime: number;
	endTime: number;
	startByte: number;
	endByte: number;
}

interface CuePosition {
	time: number;
	clusterPosition: number;
}

export class Transmuxer {
	public static async from(segment: mkve.Segment): Promise<Transmuxer> {
		const info: SegmentInfo = await readSegmentInfo(segment);

		const tracksElement = await segment.tracks;
		if (tracksElement === undefined) {
			throw new Error("Tracks not found");
		}
		const tracks: TrackMuxer[] = [];
		for await (const entry of tracksElement.tracks) {
			const track = await TrackMuxer.from(entry, info);
			if (track !== undefined) {
				tracks.push(track);
			}
		}
		if (tracks.length === 0) {
			throw new Error("No supported tracks found");
		}

		const attachments: Attachment[] = [];
		for await (const attachmentsElement of segment.attachments) {
			for await (const file of attachmentsElement.attachedFiles) {
				attachments.push(await Attachment.from(file));
			}
		}

		const indexTrack = tracks.find((track) => track.info.type === "video") ?? tracks[0];
		const positions = await readCuePositions(segment, indexTrack.info.number);
		const cueRanges = positions.length > 0 ?
			buildCueRanges(positions, info, segment.element.data.size) :
			await firstCueRange(segment, info);
		if (cueRanges.length === 0) {
			throw new Error("No cue points found");
		}

		const transmuxerTracks = tracks.map((muxer) => {
			const trackInfo = muxer.info;
			const cuePoints = cueRanges.map((range) => new CuePointTransmuxer(
				range.startTime,
				range.endTime,
				() => muxer.streamFragments(
					range.startByte,
					range.endByte,
					range.endTime,
					trackInfo.type === "text" ? 0 : Math.round(range.startTime * 1000),
				),
			));
			return new TrackTransmuxer(
				trackInfo,
				muxer.initSegment(),
				cuePoints,
			);
		});
		return new Transmuxer(info, transmuxerTracks, attachments);
	}

	private constructor(
		public readonly info: SegmentInfo,
		public readonly tracks: TrackTransmuxer[],
		public readonly attachments: Attachment[],
	) {}
}

async function readCuePositions(
	segment: mkve.Segment,
	trackNumber: number,
): Promise<CuePosition[]> {
	const cues = await segment.getCues();
	if (cues === undefined) {
		return [];
	}
	const positions: CuePosition[] = [];
	for await (const cuePoint of cues.cuePoints) {
		const time = await cuePoint.cueTime;
		for await (const trackPosition of cuePoint.cueTrackPositions) {
			if (await trackPosition.cueTrack !== trackNumber) {
				continue;
			}
			const clusterPosition = await trackPosition.cueClusterPosition;
			const existing = positions.find(
				(position) => position.clusterPosition === clusterPosition,
			);
			if (existing === undefined) {
				positions.push({ time, clusterPosition });
			} else {
				existing.time = Math.min(existing.time, time);
			}
			break;
		}
	}
	positions.sort((a, b) => a.time - b.time);
	return positions;
}

function buildCueRanges(
	positions: CuePosition[],
	info: SegmentInfo,
	dataSize: number,
): CueRange[] {
	const scale = info.timestampScale / 1e9;
	return positions.map((position, index) => {
		const next = positions[index + 1];
		const startTime = position.time * scale;
		const endTime = next === undefined ? info.duration : next.time * scale;
		return {
			startTime,
			endTime: Math.max(endTime, startTime),
			startByte: position.clusterPosition,
			endByte: next === undefined ? dataSize - 1 : next.clusterPosition - 1,
		};
	}).filter((range) => range.endByte >= range.startByte);
}

async function firstCueRange(
	segment: mkve.Segment,
	info: SegmentInfo,
): Promise<CueRange[]> {
	for await (const cluster of segment.clusters) {
		return [{
			startTime: 0,
			endTime: info.duration,
			startByte: cluster.element.offset - segment.element.dataOffset,
			endByte: segment.element.data.size - 1,
		}];
	}
	return [];
}
