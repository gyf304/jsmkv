import { describe, expect, test } from "bun:test";

import type { Transmuxer } from "../transmuxer/segment.js";
import { sources } from "./manifest.js";

describe("Matroska sources", () => {
	test("stores and removes a transmuxer by id", () => {
		const transmuxer = {} as Transmuxer;
		const id = crypto.randomUUID();
		sources.set(id, transmuxer);
		expect(sources.get(id)).toBe(transmuxer);
		sources.delete(id);
		expect(sources.get(id)).toBeUndefined();
	});
});
