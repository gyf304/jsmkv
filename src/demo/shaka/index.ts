import shaka from "shaka-player";
import { registerMatroska } from "../../shaka/index.js";
import { AssTextParser } from "./parsers.js";

const DEFAULT_URL = "https://gyf304.github.io/jsmkv/spring-blender-open-movie.mkv";

const video = document.getElementById("video") as HTMLVideoElement;
const urlInput = document.getElementById("url") as HTMLInputElement;
const fileInput = document.getElementById("file") as HTMLInputElement;
const loadButton = document.getElementById("load") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLDivElement;

const urlParam = new URLSearchParams(location.search).get("url");
urlInput.value = urlParam ?? DEFAULT_URL;

const files = new Map<string, File>();

registerMatroska(shaka);
shaka.net.NetworkingEngine.registerScheme(
	"mkvfile",
	(uri, request) => shaka.util.AbortableOperation.notAbortable((async () => {
		const file = files.get(uri);
		if (file === undefined) {
			throw new Error(`File not found: ${uri}`);
		}
		if (request.method === "HEAD") {
			return {
				uri,
				originalUri: uri,
				originalRequest: request,
				data: new Uint8Array(0),
				headers: {
					"Content-Length": String(file.size),
					"Accept-Ranges": "bytes",
				},
				status: 200,
			};
		}
		const range = parseRange(getHeader(request.headers, "range"), file.size);
		if (range === undefined) {
			throw new Error(`Range required: ${uri}`);
		}
		const data = new Uint8Array(await file.slice(range.start, range.end + 1).arrayBuffer());
		return {
			uri,
			originalUri: uri,
			originalRequest: request,
			data,
			headers: {
				"Content-Type": "video/x-matroska",
				"Content-Length": String(data.byteLength),
				"Content-Range": `bytes ${range.start}-${range.end}/${file.size}`,
				"Accept-Ranges": "bytes",
			},
			status: 206,
		};
	})()) as any,
	shaka.net.NetworkingEngine.PluginPriority.APPLICATION,
);
shaka.text.TextEngine.registerParser("text/x-ssa", () => new AssTextParser(shaka));
const player = new shaka.Player();
player.configure({
	streaming: {
		bufferingGoal: 30,
	},
});

const showStatus = (message: string) => {
	status.textContent = message;
};

const loadUri = async (uri: string) => {
	loadButton.disabled = true;
	showStatus("Loading...");
	try {
		await player.load(uri, undefined, "video/x-matroska");
		const textTracks = player.getTextTracks();
		if (textTracks.length > 0) {
			await player.selectTextTrack(textTracks[0]);
		}
		showStatus("");
	} catch (error) {
		showStatus(error instanceof Error ? error.message : String(error));
		console.error(error);
	} finally {
		loadButton.disabled = false;
	}
};

const load = async () => {
	const uri = urlInput.value.trim();
	if (uri === "") {
		return;
	}
	await loadUri(uri);
};

const main = async () => {
	try {
		await player.attach(video);
	} catch (error) {
		showStatus(error instanceof Error ? error.message : String(error));
		console.error(error);
		return;
	}

	player.addEventListener("error", (event) => {
		const detail = (event as CustomEvent).detail;
		showStatus(detail?.message ?? String(event));
		console.error(event);
	});

	loadButton.addEventListener("click", () => {
		void load();
	});
	urlInput.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			void load();
		}
	});
	fileInput.addEventListener("change", () => {
		const file = fileInput.files?.[0];
		if (file === undefined) {
			return;
		}
		const uri = `mkvfile://${crypto.randomUUID()}`;
		files.set(uri, file);
		void loadUri(uri);
	});

	await load();
};

void main();

function getHeader(headers: Record<string, string>, name: string): string | undefined {
	const lower = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lower) {
			return value;
		}
	}
	return undefined;
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | undefined {
	if (header === undefined) {
		return undefined;
	}
	const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
	if (match === null) {
		return undefined;
	}
	const start = Number(match[1]);
	const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
	if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
		return undefined;
	}
	return { start, end };
}
