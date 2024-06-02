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

const maxBigInt = 1n << 63n;
const maxNumber = 0x100000;

describe("Vint Range Tests", () => {
	test(`Testing Vint fromBigInt to ${maxBigInt} (shift)`, () => {
		for (let i = 0x1234n; i < maxBigInt; i <<= 1n) {
			const v = Vint.fromBigInt(i);
			const i2 = v.toBigInt();
			expect(i2).toBe(i);
		}
	});

	test(`Testing Vint fromNumber to ${maxNumber} (iteration)`, () => {
		for (let i = 0; i < maxNumber; i++) {
			const v = Vint.fromNumber(i);
			const i2 = v.toNumber();
			expect(i2).toBe(i);
		}
	});
});
