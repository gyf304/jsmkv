import { buildMatroskaSegmentIndex, parseMatroskaInfo, readMatroskaSegment } from "../transmuxer/index.js";
import type { MatroskaInfo } from "../transmuxer/metadata.js";
import { primeMatroskaAttachments } from "./scheme.js";
import { NetworkingBlobLike } from "./bloblike.js";
import type {
	ShakaManifest,
	ShakaManifestConfiguration,
	ShakaManifestParser,
	ShakaNamespace,
	ShakaPlayerInterface,
	ShakaSegmentReference,
	ShakaStream,
	ShakaVariant,
} from "./types.js";

export class MatroskaManifestParser implements ShakaManifestParser {
	private stopped = false;
	private readonly uris = new Set<string>();

	constructor(
		private readonly shaka: ShakaNamespace,
		private readonly infoCache?: Map<string, MatroskaInfo>,
	) {}

	public configure(_config: ShakaManifestConfiguration, _isPreloadFn?: () => boolean): void {}

	public async start(uri: string, playerInterface: ShakaPlayerInterface): Promise<ShakaManifest> {
		if (this.stopped) {
			throw new Error("Parser stopped");
		}
		const source = await NetworkingBlobLike.fromUri(this.shaka, playerInterface, uri);
		const segment = await readMatroskaSegment(source);
		const info = await parseMatroskaInfo(segment);
		this.infoCache?.set(uri, info);
		primeMatroskaAttachments(uri, info.attachments, source);
		this.uris.add(uri);
		const index = await buildMatroskaSegmentIndex(source, segment, info);

		const video = info.tracks.find((track) => track.type === "video");
		const audio = info.tracks.find((track) => track.type === "audio");
		if (video === undefined && audio === undefined) {
			throw new Error("No supported tracks found");
		}
		if (index.initEnd < index.initStart) {
			throw new Error("No init segment found");
		}

		const codecs = [video?.codecs, audio?.codecs].filter((codec): codec is string => codec !== undefined).join(",");
		const mimeType = "video/x-matroska";
		const fullMimeType = `${mimeType}; codecs="${codecs}"`;
		const references: ShakaSegmentReference[] = index.segments
			.filter((segment) => segment.endByte >= segment.startByte)
			.map((segment) => new this.shaka.media.SegmentReference(
				segment.startTime,
				Math.max(segment.endTime, segment.startTime + 0.001),
				() => [uri],
				segment.startByte,
				segment.endByte,
				null,
				0,
				0,
				info.duration,
			));
		if (references.length === 0) {
			throw new Error("No segments found");
		}

		const type = video !== undefined ? "video" : "audio";
		const bandwidth = info.duration > 0 ? Math.round(source.size * 8 / info.duration) : 0;
		const stream: ShakaStream = {
			id: 0,
			originalId: null,
			groupId: null,
			createSegmentIndex: async () => {},
			closeSegmentIndex: undefined,
			segmentIndex: new this.shaka.media.SegmentIndex(references),
			mimeType,
			codecs,
			supplementalCodecs: "",
			frameRate: undefined,
			pixelAspectRatio: undefined,
			hdr: undefined,
			colorGamut: undefined,
			videoLayout: undefined,
			bandwidth,
			width: video?.width,
			height: video?.height,
			kind: undefined,
			encrypted: false,
			drmInfos: [],
			keyIds: new Set<string>(),
			language: audio?.language ?? video?.language ?? "und",
			originalLanguage: null,
			label: null,
			type,
			primary: true,
			trickModeVideo: null,
			dependencyStream: null,
			emsgSchemeIdUris: null,
			roles: [],
			accessibilityPurpose: null,
			forced: false,
			channelsCount: audio?.channels ?? null,
			audioSamplingRate: audio?.sampleRate ?? null,
			spatialAudio: false,
			closedCaptions: new Map<string, string>(),
			tilesLayout: undefined,
			matchedStreams: undefined,
			external: false,
			fastSwitching: false,
			fullMimeTypes: new Set([fullMimeType]),
			isAudioMuxedInVideo: false,
			baseOriginalId: null,
			isIframe: false,
			preselection: null,
		};

		const variant: ShakaVariant = {
			id: 0,
			language: audio?.language ?? video?.language ?? "und",
			disabledUntilTime: 0,
			primary: true,
			audio: video === undefined ? stream : null,
			video: video === undefined ? null : stream,
			bandwidth,
			allowedByApplication: true,
			allowedByKeySystem: true,
			decodingInfos: [],
		};

		const timeline = new this.shaka.media.PresentationTimeline(0, 0);
		timeline.setStatic(true);
		timeline.setDuration(info.duration);

		return {
			presentationTimeline: timeline,
			variants: [variant],
			textStreams: [],
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
		};
	}

	public async stop(): Promise<void> {
		this.stopped = true;
		for (const uri of this.uris) {
			this.infoCache?.delete(uri);
		}
		this.uris.clear();
	}

	public update(): void {}

	public onExpirationUpdated(_sessionId: string, _expiration: number): void {}

	public onInitialVariantChosen(_variant: ShakaVariant): void {}

	public banLocation(_uri: string): void {}

	public setMediaElement(_mediaElement: HTMLMediaElement | null): void {}
}
