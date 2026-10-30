import { hevcMimeCodec, hexString } from "../mp4/codecs.js";

export function videoMimeCodec(
	codecID: string,
	codecPrivate: ArrayBuffer,
): string | undefined {
	if (codecID === "V_MPEG4/ISO/AVC") {
		return `avc1.${hexString(codecPrivate.slice(1, 4)).toLowerCase()}`;
	}
	if (codecID === "V_MPEGH/ISO/HEVC") {
		return hevcMimeCodec(codecPrivate);
	}
	return undefined;
}

export function audioMimeCodec(codecID: string): string | undefined {
	if (codecID === "A_AAC") {
		return "mp4a.40.2";
	}
	if (codecID === "A_OPUS") {
		return "opus";
	}
	if (codecID === "A_FLAC") {
		return "fLaC";
	}
	return undefined;
}
