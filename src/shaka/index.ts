import type { MatroskaInfo } from "../transmuxer/metadata.js";
import { registerMatroskaAttachmentScheme } from "./scheme.js";
import { MatroskaManifestParser } from "./manifest.js";
import { MatroskaShakaTransmuxer } from "./transmuxer.js";
import type { ShakaNamespace } from "./types.js";

export const MATROSKA_MIME_TYPES = ["video/x-matroska", "audio/x-matroska"] as const;

export function registerMatroska(shaka: ShakaNamespace): void {
	registerMatroskaAttachmentScheme(shaka);
	const infoCache = new Map<string, MatroskaInfo>();
	for (const mimeType of MATROSKA_MIME_TYPES) {
		shaka.media.ManifestParser.registerParserByMime(
			mimeType,
			() => new MatroskaManifestParser(shaka, infoCache),
		);
		shaka.transmuxer.TransmuxerEngine.registerTransmuxer(
			mimeType,
			() => new MatroskaShakaTransmuxer(infoCache),
			shaka.transmuxer.TransmuxerEngine.PluginPriority.APPLICATION,
		);
	}
}

export * from "./scheme.js";
export * from "./manifest.js";
export * from "./transmuxer.js";
export * from "./types.js";
