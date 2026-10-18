import type shaka from "shaka-player";
import type { BlobLike } from "../bloblike/index.js";
import { FetchBlobLike } from "../bloblike/index.js";
import { parseMatroskaInfo, readMatroskaSegment } from "../transmuxer/index.js";
import type { MatroskaAttachmentInfo } from "../transmuxer/metadata.js";
import type { ShakaNamespace } from "./types.js";

const SCHEME = "matroska";
const PREFIX = `${SCHEME}://attachment/`;

interface AttachmentStore {
	attachments: Map<string, MatroskaAttachmentInfo>;
	source: BlobLike;
}

const stores = new Map<string, Promise<AttachmentStore>>();
const registered = new WeakSet<object>();

export function getMatroskaAttachmentBase(assetUri: string): string {
	return `${PREFIX}${encodeAssetUri(assetUri)}/`;
}

export function getMatroskaAttachmentUri(assetUri: string, name: string): string {
	return `${getMatroskaAttachmentBase(assetUri)}${encodeURIComponent(name)}`;
}

export function primeMatroskaAttachments(
	assetUri: string,
	attachments: MatroskaAttachmentInfo[],
	source: BlobLike,
): void {
	stores.set(assetUri, Promise.resolve({
		attachments: new Map(attachments.map((attachment) => [attachment.name, attachment])),
		source,
	}));
}

export function clearMatroskaAttachmentCache(assetUri: string): void {
	stores.delete(assetUri);
}

export function registerMatroskaAttachmentScheme(shaka: ShakaNamespace): void {
	if (registered.has(shaka)) {
		return;
	}
	registered.add(shaka);

	shaka.net.NetworkingEngine.registerScheme(
		SCHEME,
		(uri, request) => shaka.util.AbortableOperation.notAbortable((async () => {
			const parsed = parseAttachmentUri(uri);
			if (parsed === undefined) {
				throw createHttpError(shaka, uri, 400);
			}
			const store = await getAttachments(parsed.assetUri);
			if (parsed.name === "") {
				const index = Array.from(store.attachments.values()).map((attachment) => ({
					name: attachment.name,
					mimeType: attachment.mimeType,
					uid: attachment.uid,
					description: attachment.description,
					offset: attachment.offset,
					size: attachment.size,
					uri: getMatroskaAttachmentUri(parsed.assetUri, attachment.name),
				}));
				return createResponse(
					uri, new TextEncoder().encode(JSON.stringify(index)),
					"application/json", request,
				);
			}

			const attachment = store.attachments.get(parsed.name);
			if (attachment === undefined) {
				throw createHttpError(shaka, uri, 404);
			}
			const data = new Uint8Array(await store.source
				.slice(attachment.offset, attachment.offset + attachment.size)
				.arrayBuffer());
			return createResponse(uri, data, attachment.mimeType, request);
		})()),
		shaka.net.NetworkingEngine.PluginPriority.APPLICATION,
	);
}

async function getAttachments(assetUri: string): Promise<AttachmentStore> {
	let store = stores.get(assetUri);
	if (store === undefined) {
		store = (async () => {
			const source = await FetchBlobLike.fromUrl(assetUri);
			const segment = await readMatroskaSegment(source);
			const info = await parseMatroskaInfo(segment);
			return {
				attachments: new Map(info.attachments.map((attachment) => [attachment.name, attachment])),
				source,
			};
		})();
		stores.set(assetUri, store);
		store.catch(() => stores.delete(assetUri));
	}
	return await store;
}

function parseAttachmentUri(uri: string): { assetUri: string; name: string } | undefined {
	if (!uri.startsWith(PREFIX)) {
		return undefined;
	}
	const rest = uri.slice(PREFIX.length);
	const slash = rest.indexOf("/");
	if (slash < 0) {
		return {
			assetUri: decodeAssetUri(rest),
			name: "",
		};
	}
	const id = rest.slice(0, slash);
	const name = decodeURIComponent(rest.slice(slash + 1));
	return {
		assetUri: decodeAssetUri(id),
		name,
	};
}

function encodeAssetUri(assetUri: string): string {
	const bytes = new TextEncoder().encode(assetUri);
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeAssetUri(id: string): string {
	const base64 = id.replace(/-/g, "+").replace(/_/g, "/");
	const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
	const binary = atob(padded);
	return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function createResponse(
	uri: string,
	data: Uint8Array,
	mimeType: string,
	request: shaka.extern.Request,
): shaka.extern.Response {
	const range = parseRange(getHeader(request.headers, "range"), data.byteLength);
	const body = range === undefined ? data : data.subarray(range.start, range.end + 1);
	const headers: Record<string, string> = range === undefined ? {
		"Content-Type": mimeType,
		"Content-Length": String(body.byteLength),
	} : {
		"Content-Type": mimeType,
		"Content-Length": String(body.byteLength),
		"Content-Range": `bytes ${range.start}-${range.end}/${data.byteLength}`,
	};
	return {
		uri,
		originalUri: uri,
		originalRequest: request,
		data: body,
		headers,
		status: range === undefined ? 200 : 206,
	};
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

function getHeader(headers: Record<string, string>, name: string): string | undefined {
	const lower = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lower) {
			return value;
		}
	}
	return undefined;
}

function createHttpError(shaka: ShakaNamespace, uri: string, status: number): Error {
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
