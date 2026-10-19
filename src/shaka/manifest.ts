import { Transmuxer } from "../transmuxer/segment.js";
import type {
	AudioVideoTrackInfo,
	SegmentInfo,
	TextTrackInfo,
	TrackTransmuxer,
} from "../transmuxer/track.js";
import { NetworkBlobLike } from "./bloblike.js";
import type shaka from "shaka-player";
import { CacheBlobLike } from "../bloblike/index.js";
import type { BlobLike } from "../bloblike/index.js";
import * as ebml from "../ebml/index.js";
import { File } from "../matroska/index.js";
import * as mkve from "../matroska/elements/index.js";

const CACHE_BLOCK_SIZE = 1024 * 1024;
const CACHE_MAX_SIZE = 64 * 1024 * 1024;

type ShakaNamespace = typeof import("shaka-player").default;

export const MATROSKA_SCHEME = "matroska";
export const sources = new Map<string, Transmuxer>();

export interface ManifestAttachment {
	name: string;
	uri: string;
	mimeType: string;
}

export type MatroskaManifest = shaka.extern.Manifest & {
	attachments: ManifestAttachment[];
};

const streamDefaults = {
	createSegmentIndex: async () => {},
	closeSegmentIndex: undefined,
	supplementalCodecs: "",
	frameRate: undefined,
	pixelAspectRatio: undefined,
	hdr: undefined,
	colorGamut: undefined,
	videoLayout: undefined,
	kind: undefined,
	encrypted: false,
	originalLanguage: null,
	primary: false,
	trickModeVideo: null,
	dependencyStream: null,
	emsgSchemeIdUris: null,
	accessibilityPurpose: null,
	forced: false,
	spatialAudio: false,
	tilesLayout: undefined,
	matchedStreams: undefined,
	external: false,
	fastSwitching: false,
	isAudioMuxedInVideo: false,
	baseOriginalId: null,
	isIframe: false,
	preselection: null,
} as const;

export async function getMatroskaSegment(
	source: BlobLike,
	segmentIndex: number,
): Promise<mkve.Segment | undefined> {
	const file = new File(new ebml.Stream(source));
	let index = 0;
	for await (const segment of file.segments) {
		if (index++ === segmentIndex) {
			return segment;
		}
	}
	return undefined;
}

export class MatroskaManifestParser implements shaka.extern.ManifestParser {
	private stopped = false;
	private id?: string;

	constructor(private readonly shaka: ShakaNamespace) {}

	public configure(_config: shaka.extern.ManifestConfiguration, _isPreloadFn?: () => boolean): void {}

	public async start(
		uri: string,
		playerInterface: shaka.extern.ManifestParser.PlayerInterface,
	): Promise<MatroskaManifest> {
		if (this.stopped) {
			throw new Error("Parser stopped");
		}
		const networkSource = await NetworkBlobLike.fromUri(this.shaka, playerInterface, uri);
		const source = new CacheBlobLike(
			networkSource,
			0,
			networkSource.size,
			CACHE_BLOCK_SIZE,
			CACHE_MAX_SIZE,
		);
		const segment = await getMatroskaSegment(source, 0);
		if (segment === undefined) {
			throw new Error("No segment found");
		}
		const transmuxer = await Transmuxer.from(segment);
		const info = transmuxer.info;

		const bandwidth = info.duration > 0 ?
			Math.round(source.size * 8 / info.duration) :
			0;
		const tracks: TrackTransmuxer[] = [];
		for (const track of transmuxer.tracks) {
			if (track.info.type === "text") {
				if (this.shaka.text.TextEngine.findParser(track.info.mimeType) === null) {
					console.warn(`Unsupported text codec: ${track.info.mimeType}, ignored`);
					continue;
				}
				tracks.push(track);
				continue;
			}
			const mimeType = `${track.info.type}/mp4`;
			if (!isTypeSupported(`${mimeType}; codecs="${track.info.codecs}"`)) {
				console.warn(`Unsupported ${track.info.type} codec: ${track.info.codecs}, ignored`);
				continue;
			}
			tracks.push(track);
		}
		if (tracks.length === 0) {
			throw new Error("No supported tracks found");
		}

		const id = crypto.randomUUID();
		sources.set(id, transmuxer);
		this.id = id;
		const attachments = transmuxer.attachments.map((attachment, index) => ({
			name: attachment.name,
			uri: `${MATROSKA_SCHEME}://${id}/attachments/${index}`,
			mimeType: attachment.mediaType,
		}));
		const videoStreams: shaka.extern.Stream[] = [];
		const audioStreams: shaka.extern.Stream[] = [];
		const textStreams: shaka.extern.Stream[] = [];
		for (const track of tracks) {
			const trackInfo = track.info;
			if (trackInfo.type === "text") {
				const references = this.buildReferences(id, track, info);
				if (references.length === 0) {
					continue;
				}
				textStreams.push(this.buildTextStream(trackInfo, references));
				continue;
			}
			const references = this.buildReferences(id, track, info);
			if (references.length === 0) {
				continue;
			}
			const stream = this.buildStream(trackInfo, references, bandwidth);
			if (trackInfo.type === "video") {
				videoStreams.push(stream);
			} else {
				audioStreams.push(stream);
			}
		}
		if (videoStreams.length === 0 && audioStreams.length === 0) {
			sources.delete(id);
			this.id = undefined;
			throw new Error("No supported tracks found");
		}

		const variants = this.buildVariants(videoStreams, audioStreams, bandwidth);
		const timeline = new this.shaka.media.PresentationTimeline(0, 0);
		timeline.setStatic(true);
		timeline.setDuration(info.duration);

		return {
			presentationTimeline: timeline,
			variants,
			textStreams,
			imageStreams: [],
			chapterStreams: [],
			offlineSessionIds: [],
			sequenceMode: false,
			ignoreManifestTimestampsInSegmentsMode: false,
			type: "MKV",
			serviceDescription: null,
			nextUrl: null,
			periodCount: 1,
			gapCount: 0,
			isLowLatency: false,
			startTime: null,
			attachments,
		};
	}

	private buildReferences(
		id: string,
		track: TrackTransmuxer,
		info: SegmentInfo,
	): shaka.media.SegmentReference[] {
		const trackInfo = track.info;
		const assetBase = `${MATROSKA_SCHEME}://${id}/`;
		const init = trackInfo.type === "text" && trackInfo.mimeType !== "text/x-ssa" ?
			null :
			new this.shaka.media.InitSegmentReference(
				() => [`${assetBase}tracks/${trackInfo.number}/init.mp4`],
				0,
				null,
			);
		return track.cuePoints.map((cue, segmentIndex) => new this.shaka.media.SegmentReference(
			cue.startTime,
			Math.max(cue.endTime, cue.startTime + 0.001),
			() => [`${assetBase}tracks/${trackInfo.number}/segments/${segmentIndex}.m4s`],
			0,
			null,
			init,
			0,
			0,
			info.duration,
		));
	}

	private buildStream(
		track: AudioVideoTrackInfo,
		references: shaka.media.SegmentReference[],
		bandwidth: number,
	): shaka.extern.Stream {
		const mimeType = `${track.type}/mp4`;
		return {
			...streamDefaults,
			id: track.number,
			originalId: String(track.number),
			groupId: null,
			segmentIndex: new this.shaka.media.SegmentIndex(references),
			mimeType,
			codecs: track.codecs,
			bandwidth,
			width: track.type === "video" ? track.width : undefined,
			height: track.type === "video" ? track.height : undefined,
			drmInfos: [],
			keyIds: new Set<string>(),
			language: track.language,
			label: null,
			type: track.type,
			roles: [],
			channelsCount: track.type === "audio" ? track.channels ?? null : null,
			audioSamplingRate: track.type === "audio" ? track.sampleRate ?? null : null,
			closedCaptions: new Map<string, string>(),
			fullMimeTypes: new Set([`${mimeType}; codecs="${track.codecs}"`]),
		};
	}

	private buildTextStream(
		track: TextTrackInfo,
		references: shaka.media.SegmentReference[],
	): shaka.extern.Stream {
		const mimeType = track.mimeType;
		return {
			...streamDefaults,
			id: track.number,
			originalId: String(track.number),
			groupId: null,
			segmentIndex: new this.shaka.media.SegmentIndex(references),
			mimeType,
			codecs: "",
			bandwidth: 0,
			kind: "subtitle",
			drmInfos: [],
			keyIds: new Set<string>(),
			language: track.language,
			label: track.name ?? null,
			type: "text",
			roles: [],
			channelsCount: null,
			audioSamplingRate: null,
			closedCaptions: new Map<string, string>(),
			external: track.mimeType === "text/x-ssa",
			fullMimeTypes: new Set([mimeType]),
		};
	}

	private buildVariants(
		videoStreams: shaka.extern.Stream[],
		audioStreams: shaka.extern.Stream[],
		bandwidth: number,
	): shaka.extern.Variant[] {
		const variants: shaka.extern.Variant[] = [];
		const videos: (shaka.extern.Stream | null)[] = videoStreams.length > 0 ? videoStreams : [null];
		const audios: (shaka.extern.Stream | null)[] = audioStreams.length > 0 ? audioStreams : [null];
		for (const video of videos) {
			for (const audio of audios) {
				if (video === null && audio === null) {
					continue;
				}
				variants.push({
					id: variants.length,
					language: audio?.language ?? video?.language ?? "und",
					disabledUntilTime: 0,
					primary: false,
					audio,
					video,
					bandwidth,
					allowedByApplication: true,
					allowedByKeySystem: true,
					decodingInfos: [],
				});
			}
		}
		const primary = variants[0];
		if (primary !== undefined) {
			primary.primary = true;
		}
		return variants;
	}

	public async stop(): Promise<void> {
		this.stopped = true;
		if (this.id !== undefined) {
			sources.delete(this.id);
			this.id = undefined;
		}
	}

	public update(): void {}

	public onExpirationUpdated(_sessionId: string, _expiration: number): void {}

	public onInitialVariantChosen(_variant: shaka.extern.Variant): void {}

	public banLocation(_uri: string): void {}

	public setMediaElement(_mediaElement: HTMLMediaElement | null): void {}
}

function isTypeSupported(mimeType: string): boolean {
	const MediaSourceClass = window.MediaSource ?? (window as any).ManagedMediaSource;
	return typeof MediaSourceClass !== "undefined" && MediaSourceClass.isTypeSupported(mimeType);
}
