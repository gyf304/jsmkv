import { BlobLike, FetchBlobLike } from "../bloblike/index.js";
import { MatroskaToFmp4Muxer } from "../transmuxer/muxer.js";

interface Options {
	maxBufferSeconds?: number;
}

export class MKVVideoPlayer {
	private destroyed = false;
	private readonly destroyPromise: Promise<void>;
	private readonly resolveDestroy: () => void;
	public readonly ready: Promise<void>;

	constructor(private readonly source: BlobLike, private readonly video: HTMLVideoElement, private options?: Options) {
		let resolveDestroy!: () => void;
		this.destroyPromise = new Promise<void>((resolve) => {
			resolveDestroy = resolve;
		});
		this.resolveDestroy = resolveDestroy;
		this.ready = this.init();
		this.ready.catch(() => {});
	}

	public async destroy(): Promise<void> {
		this.destroyed = true;
		this.resolveDestroy();
		await this.ready.catch(() => {});
	}

	private async init() {
		let mediaSource: MediaSource | undefined;
		let sourceBuffer: SourceBuffer | undefined;
		let objectUrl: string | undefined;
		let onSeeking: (() => void) | undefined;
		const video = this.video;
		try {
			// initialize muxer
			const muxer = new MatroskaToFmp4Muxer(this.source);
			const mimeType = await muxer.getMimeType();
			const durationSeconds = await muxer.getDuration();
			const initSegment = await muxer.getInitSegment();

			// initialize video element and media source
			const ms = new MediaSource();
			mediaSource = ms;
			objectUrl = URL.createObjectURL(ms);
			video.src = objectUrl;

			await Promise.race([
				new Promise<void>((resolve) => {
					const sourceopen = () => {
						ms.removeEventListener("sourceopen", sourceopen);
						resolve();
					};
					ms.addEventListener("sourceopen", sourceopen);
				}),
				this.destroyPromise,
			]);
			if (this.destroyed) {
				return;
			}

			ms.duration = durationSeconds;
			const sb = ms.addSourceBuffer(mimeType);
			sourceBuffer = sb;
			const waitForSourceBuffer = () => Promise.race([
				new Promise<void>((resolve) => {
					if (sb.updating) {
						const updateend = () => {
							sb.removeEventListener("updateend", updateend);
							resolve();
						};
						sb.addEventListener("updateend", updateend);
					} else {
						resolve();
					}
				}),
				this.destroyPromise,
			]);
			sb.mode = "segments";

			// initialize header
			sb.appendBuffer(initSegment);
			await waitForSourceBuffer();
			if (this.destroyed) {
				return;
			}

			const maxBufferSeconds = this.options?.maxBufferSeconds ?? 60;

			let seeked = true;
			onSeeking = () => {
				seeked = true;
			};
			video.addEventListener("seeking", onSeeking);

			while (true) {
				seeked = false;

				const videoTime = video.currentTime;
				const stream = muxer.streamFrom(videoTime);

				for await (const chunk of stream) {
					if (seeked || this.destroyed) {
						break;
					}
					const timeRanges: [number, number][] = [];
					for (let i = 0; i < video.buffered.length; i++) {
						const start = video.buffered.start(i);
						const end = video.buffered.end(i);
						if (timeRanges.length > 0) {
							const last = timeRanges[timeRanges.length - 1];
							const threshold = 0.5;
							if (start - last[1] < threshold) {
								last[1] = end;
								continue;
							}
						}
						timeRanges.push([start, end]);
					}
					const currentTime = video.currentTime;
					const currentTimeRange = timeRanges.find(([start, end]) => start <= currentTime && currentTime <= end);
					while (currentTimeRange !== undefined && (video.currentTime + maxBufferSeconds) < currentTimeRange[1]) {
						if (seeked || this.destroyed) {
							break;
						}
						await new Promise<void>((resolve) => { window.setTimeout(resolve, 100); });
					}
					if (seeked || this.destroyed) {
						break;
					}
					sb.appendBuffer(chunk);
					await waitForSourceBuffer();
					if (this.destroyed) {
						break;
					}

					if (timeRanges.length > 0) {
						const currentTime = video.currentTime;
						const bufferStart = timeRanges[0][0];
						const bufferEnd = timeRanges[timeRanges.length - 1][1];

						const desiredBufferStart = Math.max(bufferStart, currentTime - maxBufferSeconds * 2);
						const desiredBufferEnd = Math.min(bufferEnd, currentTime + maxBufferSeconds * 2);

						if (bufferStart < desiredBufferStart) {
							sb.remove(0, desiredBufferStart);
							await waitForSourceBuffer();
						}

						if (bufferEnd > desiredBufferEnd) {
							sb.remove(desiredBufferEnd, bufferEnd);
							await waitForSourceBuffer();
						}
					}
				}

				if (this.destroyed) {
					break;
				}

				// end of stream, wait for seek
				while (!seeked && !this.destroyed) {
					await new Promise<void>((resolve) => { window.setTimeout(resolve, 100); });
				}
			}
		} finally {
			if (onSeeking !== undefined) {
				video.removeEventListener("seeking", onSeeking);
			}
			if (mediaSource !== undefined) {
				if (mediaSource.readyState === "open") {
					try {
						mediaSource.endOfStream();
					} catch {
						// ignore: the media source may already be closed
					}
				}
				if (sourceBuffer !== undefined) {
					try {
						mediaSource.removeSourceBuffer(sourceBuffer);
					} catch {
						// ignore: the source buffer may already be detached
					}
				}
			}
			if (objectUrl !== undefined) {
				video.removeAttribute("src");
				video.load();
				URL.revokeObjectURL(objectUrl);
			}
		}
	}
}

export function polyfill() {
	const mkvUrls = new Map<HTMLVideoElement, string>(); // video element -> source URL
	const players = new Map<HTMLVideoElement, MKVVideoPlayer>(); // video element -> player
	const runOnce = async () => {
		const videos = document.querySelectorAll<HTMLVideoElement>("video.mkv-player");
		const newVideos: [HTMLVideoElement, string][] = [];
		for (const video of videos) {
			const sources = video.querySelectorAll("source");
			let mkvSource: string | undefined;
			for (const source of sources) {
				if (source.type === "video/x-matroska" || (source.type === "" && source.src.endsWith(".mkv"))) {
					mkvSource = source.src;
					break;
				}
			}
			if (mkvSource === undefined) {
				continue;
			}
			const prevSource = mkvUrls.get(video);
			if (prevSource === mkvSource) {
				continue;
			}
			players.get(video)?.destroy();
			mkvUrls.set(video, mkvSource);
			newVideos.push([video, mkvSource]);
		}
		for (const [video, mkvSource] of newVideos) {
			const blobLike = await FetchBlobLike.fromUrl(mkvSource);
			const player = new MKVVideoPlayer(blobLike, video);
			player.ready.catch((error) => console.error("MKV playback failed", error));
			players.set(video, player);
		}
	};
	runOnce();
	setInterval(runOnce, 1000);
}
