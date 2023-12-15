import { describe, expect, test } from "bun:test";

import { Vint } from ".";

interface VintTest {
	vint: Vint;
	id: number;
	n: number;
}

const vintTests: VintTest[] = [
	{ vint: new Vint(new Uint8Array([0x18, 0x53, 0x80, 0x67])), id: 0x18538067, n: 0x8538067 },
];

describe("Vint Tests", () => {
	test.each(vintTests)("Vint ID and Uint64 Tests", (test) => {
		expect(test.vint.id).toBe(test.id);
		expect(test.vint.number).toBe(test.n);
		expect(test.vint.valid).toBe(true);
	});
});

describe("Vint Range Tests", () => {
	for (let i = 0n; i < 0x100n; i++) {
		test(`Testing Vint fromBigInt with value ${i}`, () => {
			const v = Vint.fromBigInt(i);
			const i2 = v.toBigInt();
			expect(i2).toBe(i);
		});
	}

	for (let i = 1n; i < 0x100n; i <<= 1n) {
		test(`Testing Vint fromBigInt with value ${i}`, () => {
			const v = Vint.fromBigInt(i);
			const i2 = v.toBigInt();
			expect(i2).toBe(i);
		});
	}
});
