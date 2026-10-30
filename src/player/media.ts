interface MediaSourceConstructor {
	new (): MediaSource;
	isTypeSupported(mimeType: string): boolean;
}

function scope(): {
	MediaSource?: MediaSourceConstructor;
	ManagedMediaSource?: MediaSourceConstructor;
} {
	return globalThis as {
		MediaSource?: MediaSourceConstructor;
		ManagedMediaSource?: MediaSourceConstructor;
	};
}

export function mediaSourceConstructor(): MediaSourceConstructor | undefined {
	return scope().MediaSource ?? scope().ManagedMediaSource;
}

export function isMediaSourceTypeSupported(mimeType: string): boolean {
	return mediaSourceConstructor()?.isTypeSupported(mimeType) ?? false;
}

export class MediaSourceHandle {
	private destroyed = false;

	public static async create(
		element: HTMLVideoElement,
		duration: number,
	): Promise<MediaSourceHandle> {
		const Constructor = mediaSourceConstructor();
		if (Constructor === undefined) {
			throw new Error("MediaSource is not supported");
		}
		const mediaSource = new Constructor();
		const url = URL.createObjectURL(mediaSource);
		const handle = new MediaSourceHandle(element, mediaSource, url, duration);
		try {
			await handle.open();
		} catch (error) {
			await handle.destroy();
			throw error;
		}
		return handle;
	}

	private constructor(
		public readonly element: HTMLVideoElement,
		public readonly mediaSource: MediaSource,
		private readonly url: string,
		public readonly duration: number,
	) {}

	public addSourceBuffer(mimeType: string): SourceBuffer {
		if (this.mediaSource.readyState !== "open") {
			throw new Error("MediaSource is not open");
		}
		return this.mediaSource.addSourceBuffer(mimeType);
	}

	public async destroy(): Promise<void> {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		for (const sourceBuffer of Array.from(this.mediaSource.sourceBuffers)) {
			try {
				this.mediaSource.removeSourceBuffer(sourceBuffer);
			} catch {
				// The source buffer cannot be removed while it is updating.
			}
		}
		try {
			if (this.mediaSource.readyState === "open") {
				this.mediaSource.endOfStream();
			}
		} catch {
			// The media source may already be closed by the element.
		}
		if (this.element.getAttribute("src") === this.url) {
			this.element.removeAttribute("src");
			this.element.load();
		}
		URL.revokeObjectURL(this.url);
	}

	private open(): Promise<void> {
		const element = this.element;
		const mediaSource = this.mediaSource;
		const ManagedMediaSource = scope().ManagedMediaSource;
		if (ManagedMediaSource !== undefined &&
			mediaSource instanceof ManagedMediaSource) {
			(element as HTMLVideoElement & { disableRemotePlayback?: boolean })
				.disableRemotePlayback = true;
		}
		return new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				mediaSource.removeEventListener("sourceopen", onOpen);
				mediaSource.removeEventListener("sourceclose", onClose);
				element.removeEventListener("error", onError);
			};
			const onOpen = () => {
				cleanup();
				resolve();
			};
			const onClose = () => {
				cleanup();
				reject(new Error("MediaSource closed before it opened"));
			};
			const onError = () => {
				cleanup();
				reject(new Error("Failed to attach MediaSource to the video element"));
			};
			mediaSource.addEventListener("sourceopen", onOpen);
			mediaSource.addEventListener("sourceclose", onClose);
			element.addEventListener("error", onError);
			element.src = this.url;
		}).then(() => {
			if (Number.isFinite(this.duration) && this.duration >= 0) {
				this.mediaSource.duration = this.duration;
			}
		});
	}
}
