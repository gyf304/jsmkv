import type shaka from "shaka-player";
import { MATROSKA_SCHEME, sources } from "./manifest.js";

type ShakaNamespace = typeof import("shaka-player").default;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function registerMatroskaScheme(shaka: ShakaNamespace): void {
	shaka.net.NetworkingEngine.registerScheme(
		MATROSKA_SCHEME,
		(uri, request) => shaka.util.AbortableOperation.notAbortable(
			handleRequest(shaka, uri, request),
		),
		shaka.net.NetworkingEngine.PluginPriority.APPLICATION,
	);
}

async function handleRequest(
	shaka: ShakaNamespace,
	uri: string,
	request: shaka.extern.Request,
): Promise<shaka.extern.Response> {
	const url = new URL(uri);
	const transmuxer = sources.get(url.hostname);
	if (transmuxer === undefined) {
		throw createHttpError(shaka, uri, 404);
	}
	const [name, ...route] = url.pathname.slice(1).split("/");
	if (name === "attachments" && route.length === 1) {
		const attachment = transmuxer.attachments[Number(route[0])];
		if (attachment === undefined) {
			throw createHttpError(shaka, uri, 404);
		}
		const data = new Uint8Array(await attachment.data.arrayBuffer());
		return createResponse(uri, data, attachment.mediaType, request);
	}

	if (name === "tracks" && route.length === 2 && route[1] === "init.mp4") {
		const track = transmuxer.tracks.find(
			(candidate) => candidate.info.number === Number(route[0]),
		);
		if (track === undefined) {
			throw createHttpError(shaka, uri, 404);
		}
		const mimeType = track.info.type === "text" ?
			track.info.mimeType :
			`${track.info.type}/mp4`;
		return createResponse(uri, track.init, mimeType, request);
	}

	if (name === "tracks" && route.length === 3 && route[1] === "segments") {
		const track = transmuxer.tracks.find(
			(candidate) => candidate.info.number === Number(route[0]),
		);
		const segmentIndex = route[2].endsWith(".m4s") ?
			Number(route[2].slice(0, -4)) :
			undefined;
		const cuePoint = segmentIndex === undefined ? undefined : track?.cuePoints[segmentIndex];
		if (track === undefined || cuePoint === undefined) {
			throw createHttpError(shaka, uri, 404);
		}
		const fragments: Uint8Array[] = [];
		for await (const fragment of cuePoint.streamFragments()) {
			fragments.push(fragment);
		}
		const mimeType = track.info.type === "text" ?
			track.info.mimeType :
			`${track.info.type}/mp4`;
		let data = concat(fragments);
		if (track.info.type === "text" && track.info.mimeType === "text/vtt") {
			const text = textDecoder.decode(data);
			if (!text.startsWith("WEBVTT")) {
				data = textEncoder.encode(`WEBVTT\n\n${text}`);
			}
		}
		return createResponse(uri, data, mimeType, request);
	}

	throw createHttpError(shaka, uri, 400);
}

function concat(fragments: Uint8Array[]): Uint8Array {
	const length = fragments.reduce((sum, fragment) => sum + fragment.byteLength, 0);
	const output = new Uint8Array(length);
	let offset = 0;
	for (const fragment of fragments) {
		output.set(fragment, offset);
		offset += fragment.byteLength;
	}
	return output;
}

function createResponse(
	uri: string,
	data: Uint8Array,
	mimeType: string,
	request: shaka.extern.Request,
): shaka.extern.Response {
	return {
		uri,
		originalUri: uri,
		originalRequest: request,
		data,
		headers: {
			"Content-Type": mimeType,
			"Content-Length": String(data.byteLength),
		},
		status: 200,
	};
}

function createHttpError(
	shaka: ShakaNamespace,
	uri: string,
	status: number,
): Error {
	return new shaka.util.Error(
		shaka.util.Error.Severity.RECOVERABLE,
		shaka.util.Error.Category.NETWORK,
		shaka.util.Error.Code.BAD_HTTP_STATUS,
		uri,
		status,
		"",
		{},
		shaka.net.NetworkingEngine.RequestType.SEGMENT,
		uri,
	);
}
