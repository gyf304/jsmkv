import { beforeAll, describe, expect, test } from "bun:test";

import { CacheBlobLike } from "./cache.js";

describe("Cache Tests", () => {
	test("can store and retrieve data", async () => {
		const raw = new Uint8Array(1024 * 1024 * 4).fill(0);
		for (let i = 0; i < raw.length; i++) {
			raw[i] = Math.floor(Math.random() * 256);
		}

		const cache = new CacheBlobLike(new Blob([raw.buffer as ArrayBuffer]));

		for (let i = 0; i < 100; i++) {
			const start1 = Math.floor(Math.random() * raw.length);
			const end1 = start1 + Math.floor(Math.random() * (raw.length - start1));
			const raw1 = raw.slice(start1, end1);
			const cache1 = cache.slice(start1, end1);
			for (let j = 0; j < 100; j++) {
				const start2 = Math.floor(Math.random() * raw1.length);
				const end2 = start2 + Math.floor(Math.random() * (raw1.length - start2));
				const raw2 = raw1.slice(start2, end2);
				const cache2 = cache1.slice(start2, end2);
				expect(new Uint8Array(await cache2.arrayBuffer())).toEqual(raw2);
			}
		}
	});
});
