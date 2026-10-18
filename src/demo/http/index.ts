import { player } from "../../index.js";

const video = document.querySelector<HTMLVideoElement>("video.mkv-player");
const source = video?.querySelector<HTMLSourceElement>("source");
const urlInput = document.getElementById("url") as HTMLInputElement | null;
const loadButton = document.getElementById("load") as HTMLButtonElement | null;

if (source != null && urlInput != null) {
	urlInput.value = source.src;
}

const load = () => {
	const uri = urlInput?.value.trim();
	if (source == null || uri === undefined || uri === "") {
		return;
	}
	source.src = uri;
};

loadButton?.addEventListener("click", load);
urlInput?.addEventListener("keydown", (event) => {
	if (event.key === "Enter") {
		load();
	}
});

player.polyfill();
