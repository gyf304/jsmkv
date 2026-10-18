export function bitReverse32(n: number) {
	n = ((n & 0x55555555) << 1) | ((n & 0xAAAAAAAA) >>> 1);
	n = ((n & 0x33333333) << 2) | ((n & 0xCCCCCCCC) >>> 2);
	n = ((n & 0x0F0F0F0F) << 4) | ((n & 0xF0F0F0F0) >>> 4);
	n = ((n & 0x00FF00FF) << 8) | ((n & 0xFF00FF00) >>> 8);
	n = ((n & 0x0000FFFF) << 16) | ((n & 0xFFFF0000) >>> 16);
	return n >>> 0;
}

export function hexString(buffer: ArrayBuffer) {
	return Array
		.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("").toUpperCase();
}

export function hevcMimeCodec(cpd: ArrayBuffer) {
	// see: https://www.w3.org/TR/webcodecs-hevc-codec-registration/
	// HEVCDecoderConfigurationRecord in ISO/IEC 14496-15 (8.3.3.1.2)
	const v = new DataView(cpd);
	// gp = general profile
	const gpSpace = ["", "A", "B", "C"][(v.getUint8(1) >> 6) & 0b11];
	const gpTierFlag = ["L", "H"][(v.getUint8(1) >> 5) & 1];
	const gpIDC = v.getUint8(1) & 0x1F;
	const gpCompatibility = bitReverse32(v.getUint32(2));
	const gpLevelIdc = v.getUint8(12);
	const gpConstraintFlags = hexString(cpd.slice(6, 12)).replace(/(00)*$/, "");
	return `hvc1.${gpSpace}${gpIDC}.${gpCompatibility}.${gpTierFlag}${gpLevelIdc}.${gpConstraintFlags}`;
}

export function videoMimeCodec(codecID: string, codecPrivate: ArrayBuffer): string | undefined {
	if (codecID === "V_MPEG4/ISO/AVC") {
		return `avc1.${hexString(codecPrivate.slice(1, 4))}`;
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
	return undefined;
}
