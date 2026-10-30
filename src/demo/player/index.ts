import { FetchBlobLike } from "../../bloblike/index.js";
import type { BlobLike } from "../../bloblike/index.js";
import * as ebml from "../../ebml/index.js";
import { Segment } from "../../matroska/elements/index.js";
import { File as MatroskaFile } from "../../matroska/index.js";
import { Player, defaultTrackPlugins } from "../../player/index.js";
import type { AudioTrackList, VideoTrackList } from "media-tracks";

const DEFAULT_URL = "https://gyf304.github.io/jsmkv/spring-blender-open-movie.mkv";

const video = document.getElementById("video") as HTMLVideoElement;
const media = video as unknown as HTMLVideoElement & {
	audioTracks: AudioTrackList;
	videoTracks: VideoTrackList;
};
const urlInput = document.getElementById("url") as HTMLInputElement;
const fileInput = document.getElementById("file") as HTMLInputElement;
const loadButton = document.getElementById("load") as HTMLButtonElement;
const audioSelect = document.getElementById("audioTracks") as HTMLSelectElement;
const videoSelect = document.getElementById("videoTracks") as HTMLSelectElement;
const textSelect = document.getElementById("textTracks") as HTMLSelectElement;
const status = document.getElementById("status") as HTMLDivElement;

const urlParam = new URLSearchParams(location.search).get("url");
urlInput.value = urlParam ?? DEFAULT_URL;

let player: Player | undefined;
let loadId = 0;

const showStatus = (message: string) => {
	status.textContent = message;
};

const errorMessage = (error: unknown) => {
	return error instanceof Error ? error.message : String(error);
};

const setTextTracks = (tracks: readonly TextTrack[]) => {
	textSelect.replaceChildren();
	tracks.forEach((track, index) => {
		const option = document.createElement("option");
		option.value = String(index);
		option.textContent = track.label || track.language || `Track ${index + 1}`;
		textSelect.append(option);
	});
	textSelect.hidden = tracks.length === 0;
	tracks.forEach((track, index) => {
		track.mode = index === 0 ? "showing" : "disabled";
	});
	if (tracks.length > 0) {
		textSelect.value = "0";
	}
};

const setAudioTracks = () => {
	const tracks = [...media.audioTracks];
	audioSelect.replaceChildren();
	tracks.forEach((track, index) => {
		const option = document.createElement("option");
		option.value = String(index);
		option.textContent = track.label || track.language || `Audio ${index + 1}`;
		audioSelect.append(option);
	});
	audioSelect.hidden = tracks.length === 0;
	const selected = tracks.findIndex((track) => track.enabled);
	if (tracks.length > 0) {
		audioSelect.value = String(selected < 0 ? 0 : selected);
	}
};

const setVideoTracks = () => {
	const tracks = [...media.videoTracks];
	videoSelect.replaceChildren();
	tracks.forEach((track, index) => {
		const option = document.createElement("option");
		option.value = String(index);
		option.textContent = track.label || track.language || `Video ${index + 1}`;
		videoSelect.append(option);
	});
	videoSelect.hidden = tracks.length === 0;
	if (tracks.length > 0) {
		videoSelect.value = String(Math.max(0, media.videoTracks.selectedIndex));
	}
};

const clearTrackSelects = () => {
	audioSelect.replaceChildren();
	audioSelect.hidden = true;
	videoSelect.replaceChildren();
	videoSelect.hidden = true;
};

const loadSource = async (source: BlobLike) => {
	const id = ++loadId;
	loadButton.disabled = true;
	showStatus("Loading...");
	try {
		await player?.destroy();
		player = undefined;
		clearTrackSelects();
		setTextTracks([]);

		const file = new MatroskaFile(new ebml.Stream(source));
		const segment = await file.one(Segment);
		if (segment === undefined) {
			throw new Error("No segment found");
		}
		if (id !== loadId) {
			return;
		}

		const next = new Player(video, defaultTrackPlugins);
		player = next;
		await next.load(segment);
		if (id !== loadId) {
			await next.destroy();
			return;
		}
		showStatus(`Loaded ${media.audioTracks.length + media.videoTracks.length + media.textTracks.length} tracks`);
		setAudioTracks();
		setVideoTracks();
		setTextTracks([...media.textTracks]);
		await video.play().catch(() => {});
	} catch (error) {
		if (id !== loadId) {
			return;
		}
		showStatus(errorMessage(error));
		console.error(error);
	} finally {
		if (id === loadId) {
			loadButton.disabled = false;
		}
	}
};

const loadUrl = async () => {
	const uri = urlInput.value.trim();
	if (uri === "") {
		return;
	}
	loadButton.disabled = true;
	showStatus("Loading...");
	try {
		await loadSource(await FetchBlobLike.fromUrl(uri));
	} catch (error) {
		showStatus(errorMessage(error));
		console.error(error);
	} finally {
		loadButton.disabled = false;
	}
};

const main = () => {
	loadButton.addEventListener("click", () => {
		void loadUrl();
	});
	urlInput.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			void loadUrl();
		}
	});
	fileInput.addEventListener("change", () => {
		const file = fileInput.files?.[0];
		if (file !== undefined) {
			void loadSource(file);
		}
		fileInput.value = "";
	});
	audioSelect.addEventListener("change", () => {
		const selected = Number(audioSelect.value);
		[...media.audioTracks].forEach((track, index) => {
			track.enabled = index === selected;
		});
	});
	videoSelect.addEventListener("change", () => {
		const selected = Number(videoSelect.value);
		[...media.videoTracks].forEach((track, index) => {
			track.selected = index === selected;
		});
	});
	textSelect.addEventListener("change", () => {
		if (player === undefined) {
			return;
		}
		const selected = Number(textSelect.value);
		[...media.textTracks].forEach((track, index) => {
			track.mode = index === selected ? "showing" : "disabled";
		});
	});
	window.addEventListener("pagehide", () => {
		void player?.destroy();
	});
};

void main();
