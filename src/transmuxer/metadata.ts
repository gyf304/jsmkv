import { BlobLike } from "../bloblike/index.js";
import * as ebml from "../ebml/index.js";
import { File } from "../matroska/index.js";
import * as mkve from "../matroska/elements/index.js";
import { audioMimeCodec, videoMimeCodec } from "./codecs.js";

export interface MatroskaTrackInfo {
	number: number;
	type: "video" | "audio";
	codecs: string;
	codecPrivate: Uint8Array;
	width?: number;
	height?: number;
	sampleRate?: number;
	channels?: number;
	bitDepth?: number;
	language: string;
	contentEncodings?: mkve.ContentEncodings;
}

export interface MatroskaAttachmentInfo {
	name: string;
	mimeType: string;
	uid: string;
	description?: string;
	offset: number;
	size: number;
}

export interface MatroskaInfo {
	timestampScale: number; // in nanoseconds
	durationTicks: number;
	duration: number; // in seconds
	tracks: MatroskaTrackInfo[];
	attachments: MatroskaAttachmentInfo[];
}

export async function readMatroskaSegment(source: BlobLike): Promise<mkve.Segment> {
	const file = new File(new ebml.Stream(source));
	return await file.one(mkve.Segment);
}

export async function parseMatroskaInfo(segment: mkve.Segment): Promise<MatroskaInfo> {
	const info = await segment.info;
	const timestampScale = await info.timestampScale;
	const durationTicks = await info.duration;
	const tracks: MatroskaTrackInfo[] = [];
	const attachments: MatroskaAttachmentInfo[] = [];

	const mkvTracks = await segment.tracks;
	if (mkvTracks === undefined) {
		throw new Error("Tracks not found");
	}

	for await (const track of mkvTracks.tracks) {
		const trackType = await track.trackType;
		const codecID = await track.codecID;
		const codecPrivateElement = await track.maybeOne(mkve.CodecPrivate);
		if (codecPrivateElement === undefined) {
			continue;
		}
		const codecPrivate = new Uint8Array(await codecPrivateElement.element.data.arrayBuffer());
		const language = await track.language ?? "und";
		const contentEncodings = await track.maybeOne(mkve.ContentEncodings);

		if (trackType === "video") {
			const video = await track.video;
			if (video === undefined) {
				continue;
			}
			const codecs = videoMimeCodec(codecID, codecPrivate.buffer as ArrayBuffer);
			if (codecs === undefined) {
				continue;
			}
			tracks.push({
				number: await track.trackNumber,
				type: "video",
				codecs,
				codecPrivate,
				width: await video.pixelWidth,
				height: await video.pixelHeight,
				language,
				contentEncodings,
			});
		} else if (trackType === "audio") {
			const audio = await track.audio;
			if (audio === undefined) {
				continue;
			}
			const codecs = audioMimeCodec(codecID);
			if (codecs === undefined) {
				continue;
			}
			tracks.push({
				number: await track.trackNumber,
				type: "audio",
				codecs,
				codecPrivate,
				sampleRate: await audio.samplingFrequency,
				channels: await audio.channels,
				bitDepth: await audio.bitDepth,
				language,
				contentEncodings,
			});
		}
	}

	for await (const attachmentsElement of segment.attachments) {
		for await (const attachedFile of attachmentsElement.attachedFiles) {
			const fileData = await attachedFile.maybeOne(mkve.FileData);
			if (fileData === undefined) {
				continue;
			}
			const fileUID = await attachedFile.maybeOne(mkve.FileUID);
			attachments.push({
				name: await attachedFile.fileName,
				mimeType: await attachedFile.fileMediaType,
				uid: fileUID === undefined ? "0" : (await fileUID.bigIntValue).toString(),
				description: await attachedFile.fileDescription,
				offset: fileData.element.dataOffset,
				size: fileData.element.data.size,
			});
		}
	}

	return {
		timestampScale,
		durationTicks,
		duration: durationTicks * (timestampScale / 1e9),
		tracks,
		attachments,
	};
}

export async function parseMatroskaInfoFromSource(source: BlobLike): Promise<MatroskaInfo> {
	return await parseMatroskaInfo(await readMatroskaSegment(source));
}
