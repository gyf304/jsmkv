import { MatroskaManifestParser } from "./manifest.js";
import { registerMatroskaScheme } from "./scheme.js";

type ShakaNamespace = typeof import("shaka-player").default;

export const MATROSKA_MIME_TYPES = ["video/x-matroska", "audio/x-matroska"] as const;

export function registerMatroska(shaka: ShakaNamespace): void {
	registerMatroskaScheme(shaka);
	for (const mimeType of MATROSKA_MIME_TYPES) {
		shaka.media.ManifestParser.registerParserByMime(
			mimeType,
			() => new MatroskaManifestParser(shaka),
		);
	}
}

export * from "./scheme.js";
export * from "./manifest.js";
