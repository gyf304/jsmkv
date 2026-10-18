import shaka from "shaka-player";
import { registerMatroska } from "../../shaka/index.js";

const DEFAULT_URL = "https://gyf304.github.io/jsmkv/spring-blender-open-movie.mkv";

const video = document.getElementById("video") as HTMLVideoElement;
const urlInput = document.getElementById("url") as HTMLInputElement;
const loadButton = document.getElementById("load") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLDivElement;

const urlParam = new URLSearchParams(location.search).get("url");
urlInput.value = urlParam ?? DEFAULT_URL;

registerMatroska(shaka);
console.log(await shaka.Player.probeSupport());

const player = new shaka.Player(video);

const showStatus = (message: string) => {
	status.textContent = message;
};

player.addEventListener("error", (event) => {
	const detail = (event as CustomEvent).detail;
	showStatus(detail?.message ?? String(event));
	console.error(event);
});

const load = async () => {
	const uri = urlInput.value.trim();
	if (uri === "") {
		return;
	}
	loadButton.disabled = true;
	showStatus("Loading...");
	try {
		await player.load(uri, undefined, "video/x-matroska");
		showStatus("");
	} catch (error) {
		showStatus(error instanceof Error ? error.message : String(error));
		console.error(error);
	} finally {
		loadButton.disabled = false;
	}
};

loadButton.addEventListener("click", () => {
	void load();
});
urlInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter") {
		void load();
	}
});

void load();
