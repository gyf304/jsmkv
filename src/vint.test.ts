import { describe, expect, test } from "bun:test";

import { VInt } from "./vint.js";

interface VIntTest {
	vint: VInt;
	id: number;
	n: number;
}

const vintTests: VIntTest[] = [
	{ vint: new VInt(new Uint8Array([0x18, 0x53, 0x80, 0x67])), id: 0x18538067, n: 0x8538067 },
];

describe('VInt Tests', () => {
	test.each(vintTests)('VInt ID and Uint64 Tests', (test) => {
		expect(test.vint.id).toBe(test.id);
		expect(test.vint.number).toBe(test.n);
		expect(test.vint.valid).toBe(true);
	});

	// Additional tests here
});

describe('VInt Range Tests', () => {
	for (let i = 0n; i < 0x100n; i++) {
		test(`Testing VInt fromBigInt with value ${i}`, () => {
			const v = VInt.fromBigInt(i);
			const i2 = v.toBigInt();
			expect(i2).toBe(i);
		});
	}

	for (let i = 1n; i < 0x100n; i <<= 1n) {
		test(`Testing VInt fromBigInt with value ${i}`, () => {
			const v = VInt.fromBigInt(i);
			const i2 = v.toBigInt();
			expect(i2).toBe(i);
		});
	}
});
