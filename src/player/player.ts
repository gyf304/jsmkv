import { MediaTracksMixin } from "media-tracks";
import type { AudioTrack, VideoTrack } from "media-tracks";
import * as mkve from "../matroska/elements/index.js";
import { isMediaSourceTypeSupported, MediaSourceHandle } from "./media.js";
import {
	firstClusterPosition,
	readSeekPoints,
	type SeekIndex,
	type SeekPoint,
} from "./stream.js";
import type {
	MediaTracksElement,
	PlayerMediaTrack,
	PlayerOptions,
	Track,
	TrackPlugin,
} from "./types.js";

interface PlaybackSource {
	readonly segment: mkve.Segment;
	readonly timestampScale: number;
	readonly startPosition: number;
	readonly seekIndex: SeekIndex;
	position: number;
}

interface PendingTrack {
	readonly entry: mkve.TrackEntry;
	readonly mimeType: string;
	readonly mediaTrack: AudioTrack | VideoTrack;
	readonly plugin: TrackPlugin;
	track?: Track<PlayerMediaTrack>;
}

export class Player {
	private media?: MediaSourceHandle;
	private trackList: Track<PlayerMediaTrack>[] = [];
	private pendingTracks: PendingTrack[] = [];
	private source?: PlaybackSource;
	private seekState = { version: 0, target: 0, active: false };
	private queue: Promise<void> = Promise.resolve();
	private pumpPending = false;
	private rebuilding = false;
	private timer?: ReturnType<typeof setInterval>;
	private events?: AbortController;
	private destroyed = false;

	constructor(
		private readonly element: HTMLVideoElement,
		private readonly plugins: readonly TrackPlugin[],
		private readonly options: PlayerOptions = {},
	) {
		installMediaTracks();
	}

	public async load(segment: mkve.Segment): Promise<void> {
		await this.loadInternal(segment);
	}

	private async loadInternal(
		segment: mkve.Segment,
		preferred?: { audio?: number; video?: number },
	): Promise<void> {
		if (this.destroyed) {
			throw new Error("Player is destroyed");
		}
		await this.unload();
		try {
			const info = await segment.info;
			const timestampScale = await info.timestampScale;
			const durationTicks = await info.duration;
			const duration = durationTicks * timestampScale / 1e9;
			const tracksElement = await segment.tracks;
			if (tracksElement === undefined) {
				throw new Error("Tracks not found");
			}

			const media = await MediaSourceHandle.create(this.element, duration);
			this.media = media;
			const mediaElement = (this.element as unknown as MediaTracksElement);
			for await (const entry of tracksElement.tracks) {
				const codecType = await entry.trackType;
				if (codecType !== "video" &&
					codecType !== "audio" &&
					codecType !== "subtitle") {
					continue;
				}
				const codecId = await entry.codecID;
				const plugin = this.plugins.find((candidate) =>
					candidate.supports.some((support) =>
						support.codecType === codecType &&
						support.codecId === codecId));
				if (plugin === undefined) {
					continue;
				}
				const mimeType = await plugin.mimeType(entry);
				if (mimeType === undefined) {
					continue;
				}
				const label = (await entry.trackName) ?? "";
				const language = (await entry.languageIETF) ?? (await entry.language) ?? "";
				if (codecType === "subtitle") {
					const sink = mediaElement.addTextTrack("subtitles", label, language);
					this.trackList.push(await plugin.create(entry, sink));
					continue;
				}
				if (!isMediaSourceTypeSupported(mimeType)) {
					console.warn(`Unsupported media type: ${mimeType}`);
					continue;
				}
				const mediaTrack = codecType === "video" ?
					mediaElement.addVideoTrack("main", label, language) :
					mediaElement.addAudioTrack("main", label, language);
				mediaTrack.id = String(await entry.trackNumber);
				this.pendingTracks.push({
					entry,
					mimeType,
					mediaTrack,
					plugin,
				});
			}
			if (this.pendingTracks.length === 0 && this.trackList.length === 0) {
				throw new Error("No supported tracks found");
			}

			const audioTracks = [...mediaElement.audioTracks];
			const preferredAudio = preferred?.audio === undefined ?
				undefined :
				audioTracks.find((track) => track.id === String(preferred.audio));
			const audio = preferredAudio ?? audioTracks[0];
			for (const track of audioTracks) {
				track.enabled = track === audio;
			}
			const videoTracks = [...mediaElement.videoTracks];
			const preferredVideo = preferred?.video === undefined ?
				0 :
				videoTracks.findIndex((track) => track.id === String(preferred.video));
			const video = preferredVideo < 0 ? 0 : preferredVideo;
			videoTracks.forEach((track, index) => {
				track.selected = index === video;
			});
			for (const pending of this.selectedPending()) {
				await this.activate(pending);
			}
			if (this.trackList.length === 0) {
				throw new Error("No supported tracks found");
			}

			const startPosition = await firstClusterPosition(segment);
			if (startPosition === undefined) {
				throw new Error("No clusters found");
			}
			this.source = {
				segment,
				timestampScale,
				startPosition,
				position: startPosition,
				seekIndex: await readSeekPoints(segment, timestampScale),
			};

			const events = new AbortController();
			this.events = events;
			this.element.addEventListener("seeking", this.onSeeking.bind(this), {
				signal: events.signal,
			});
			this.element.addEventListener("play", this.onPlay.bind(this), {
				signal: events.signal,
			});
			this.element.addEventListener("timeupdate", this.onTimeUpdate.bind(this), {
				signal: events.signal,
			});
			await this.enqueue(async () => {
				await this.fill();
				this.settleSeek();
			});
			mediaElement.audioTracks.addEventListener("change", this.onMediaTracksChange.bind(this), {
				signal: events.signal,
			});
			mediaElement.videoTracks.addEventListener("change", this.onMediaTracksChange.bind(this), {
				signal: events.signal,
			});
			this.timer = setInterval(() => {
				this.settleSeek();
				this.requestPump();
			}, 250);
		} catch (error) {
			await this.unload();
			throw error;
		}
	}

	public async unload(): Promise<void> {
		this.seekState.version++;
		this.seekState.active = false;
		clearInterval(this.timer);
		this.timer = undefined;
		this.events?.abort();
		this.events = undefined;
		const mediaElement = (this.element as unknown as MediaTracksElement);

		const media = this.media;
		this.media = undefined;
		this.source = undefined;
		await this.queue;

		const tracks = this.trackList;
		const duration = media?.duration ?? 0;
		this.trackList = [];
		this.pendingTracks = [];
		this.pumpPending = false;
		await Promise.allSettled(tracks.map((track) =>
			track.remove(0, duration)));

		for (const track of [...(mediaElement.audioTracks ?? [])]) {
			mediaElement.removeAudioTrack(track);
		}
		for (const track of [...(mediaElement.videoTracks ?? [])]) {
			mediaElement.removeVideoTrack(track);
		}

		await media?.destroy();
	}

	public async destroy(): Promise<void> {
		this.destroyed = true;
		await this.unload();
	}

	private async activate(pending: PendingTrack): Promise<void> {
		if (pending.track !== undefined || this.media === undefined) {
			return;
		}
		const sourceBuffer = this.media.mediaSource.addSourceBuffer(pending.mimeType);
		sourceBuffer.mode = "segments";
		pending.mediaTrack.sourceBuffer = sourceBuffer;
		const track = await pending.plugin.create(pending.entry, pending.mediaTrack);
		pending.track = track;
		this.trackList.push(track);
	}

	private selectedPending(): PendingTrack[] {
		const mediaElement = (this.element as unknown as MediaTracksElement);
		const audio = [...mediaElement.audioTracks].find((track) => track.enabled);
		const videoIndex = mediaElement.videoTracks.selectedIndex;
		const video = videoIndex >= 0 ? mediaElement.videoTracks[videoIndex] : undefined;
		return this.pendingTracks.filter((pending) =>
			pending.mediaTrack === audio || pending.mediaTrack === video);
	}

	private enqueue(operation: () => Promise<void>): Promise<void> {
		const result = this.queue.then(() => operation());
		this.queue = result.then(() => {}, () => {});
		return result;
	}

	private run(operation: Promise<void>): void {
		void operation.catch((error) => {
			console.error(error);
		});
	}

	private requestPump(): void {
		if (this.media === undefined ||
			this.destroyed ||
			this.seekState.active ||
			this.pumpPending) {
			return;
		}
		this.pumpPending = true;
		this.run(this.enqueue(() => this.fill()).finally(() => {
			this.pumpPending = false;
		}));
	}

	private async fill(): Promise<void> {
		if (this.media === undefined || this.destroyed) {
			return;
		}
		const source = this.source;
		if (source === undefined) {
			return;
		}
		const version = this.seekState.version;
		const ahead = this.options.maxBufferAhead ?? 30;
		const time = this.element.currentTime;
		const scale = source.timestampScale / 1e9;
		for await (const cluster of source.segment.seekClusters(source.position)) {
			const startTime = (await cluster.timestamp) * scale;
			if (startTime >= time + ahead) {
				break;
			}
			await Promise.all(this.trackList.map((track) =>
				track.add(cluster)));
			if (version !== this.seekState.version || this.destroyed) {
				return;
			}
			source.position = cluster.element.offset -
				source.segment.element.dataOffset +
				cluster.element.size;
		}

		const behind = this.options.maxBufferBehind ?? 30;
		const before = this.element.currentTime - behind;
		if (before > 0) {
			await Promise.all(this.trackList.map((track) => track.remove(0, before)));
		}
	}

	private seekTo(time: number): void {
		if (this.media === undefined || this.destroyed) {
			return;
		}
		const version = ++this.seekState.version;
		this.seekState.target = time;
		this.seekState.active = true;
		this.run(this.enqueue(async () => {
			const media = this.media;
			const source = this.source;
			if (version !== this.seekState.version ||
				this.destroyed ||
				media === undefined ||
				source === undefined) {
				return;
			}
			if (this.isBuffered(time)) {
				return;
			}
			const point = this.seekPoint(time);
			const start = point?.time ?? 0;
			await Promise.all(this.trackList.map((track) =>
				track.remove(start, media.duration)));
			if (version !== this.seekState.version || this.destroyed) {
				return;
			}
			source.position = point?.position ?? source.startPosition;
			await this.fill();
			if (version === this.seekState.version && !this.destroyed) {
				this.settleSeek();
			}
		}).finally(() => {
			if (version === this.seekState.version) {
				this.seekState.active = false;
			}
		}));
	}

	private switchTracks(): void {
		const segment = this.source?.segment;
		if (segment === undefined || this.destroyed || this.rebuilding) {
			return;
		}
		this.rebuilding = true;
		const mediaElement = (this.element as unknown as MediaTracksElement);
		const audio = [...mediaElement.audioTracks].find((track) => track.enabled);
		const audioId = audio?.id === undefined ? undefined : Number(audio.id);
		const videoIndex = mediaElement.videoTracks.selectedIndex;
		const videoId = videoIndex < 0 ?
			undefined :
			Number(mediaElement.videoTracks[videoIndex]?.id);
		const time = this.element.currentTime;
		this.run((async () => {
			try {
				await this.loadInternal(segment, {
					audio: Number.isFinite(audioId) ? audioId : undefined,
					video: Number.isFinite(videoId) ? videoId : undefined,
				});
				if (!this.destroyed) {
					const current = this.element.currentTime;
					if (current < 0.5 && time >= 0.5 ||
						Math.abs(current - time) <= 0.5) {
						this.element.currentTime = time;
					}
					this.requestPump();
				}
			} finally {
				this.rebuilding = false;
			}
		})());
	}

	private seekPoint(time: number): SeekPoint | undefined {
		const points = this.seekPoints();
		if (points.length === 0) {
			return undefined;
		}
		let low = 0;
		let high = points.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (points[middle].time <= time) {
				low = middle + 1;
			} else {
				high = middle;
			}
		}
		return points[low === 0 ? 0 : low - 1];
	}

	private seekPoints(): readonly SeekPoint[] {
		const index = this.source?.seekIndex;
		if (index === undefined) {
			return [];
		}
		const track = this.selectedVideoTrack();
		return track === undefined ?
			index.any :
			index.byTrack.get(track) ?? index.any;
	}

	private selectedVideoTrack(): number | undefined {
		const mediaElement = (this.element as unknown as MediaTracksElement);
		const tracks = mediaElement.videoTracks;
		const index = tracks?.selectedIndex ?? -1;
		const id = tracks?.[index >= 0 ? index : 0]?.id;
		if (id === undefined || id === "") {
			return undefined;
		}
		const track = Number(id);
		return Number.isFinite(track) ? track : undefined;
	}

	private isBuffered(time: number): boolean {
		const buffered = this.element.buffered;
		for (let i = 0; i < buffered.length; i++) {
			if (time >= buffered.start(i) && time < buffered.end(i)) {
				return true;
			}
		}
		return false;
	}

	private settleSeek(): void {
		const time = this.element.currentTime;
		if (this.isBuffered(time)) {
			return;
		}
		const buffered = this.element.buffered;
		let next = Number.POSITIVE_INFINITY;
		for (let i = 0; i < buffered.length; i++) {
			const start = buffered.start(i);
			if (start > time && start < next) {
				next = start;
			}
		}
		if (!Number.isFinite(next)) {
			return;
		}
		this.seekState.target = next;
		this.element.currentTime = next;
	}

	private onSeeking(): void {
		const time = this.element.currentTime;
		if (this.seekState.active &&
			Math.abs(time - this.seekState.target) < 0.5) {
			return;
		}
		this.seekTo(time);
	}

	private onMediaTracksChange(): void {
		if (!this.rebuilding) {
			this.switchTracks();
		}
	}

	private onPlay(): void {
		this.requestPump();
	}

	private onTimeUpdate(): void {
		this.requestPump();
	}
}

function installMediaTracks(): void {
	const Element = globalThis.HTMLMediaElement;
	if (Element === undefined) {
		return;
	}
	const prototype = Element.prototype as typeof Element.prototype & {
		videoTracks?: unknown;
		audioTracks?: unknown;
		addVideoTrack?: unknown;
		addAudioTrack?: unknown;
		removeVideoTrack?: unknown;
		removeAudioTrack?: unknown;
	};
	if ("videoTracks" in prototype &&
		"audioTracks" in prototype &&
		typeof prototype.addVideoTrack === "function" &&
		typeof prototype.addAudioTrack === "function" &&
		typeof prototype.removeVideoTrack === "function" &&
		typeof prototype.removeAudioTrack === "function") {
		return;
	}
	MediaTracksMixin(Element);
}
