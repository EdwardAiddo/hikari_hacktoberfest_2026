import assert from "node:assert/strict";
import { test } from "node:test";
import { contrastRatio, flatten, over, parseExpected, toHex, type Rgba } from "../src/contrast.js";

const white: Rgba = [255, 255, 255, 1];
const black: Rgba = [0, 0, 0, 1];

test("black on white is 21:1, same colors are 1:1", () => {
	assert.equal(contrastRatio(black, white).toFixed(2), "21.00");
	assert.equal(contrastRatio(white, white), 1);
});

test("matches axe for #aaaaaa on white (2.32:1)", () => {
	assert.equal(contrastRatio([170, 170, 170, 1], white).toFixed(2), "2.32");
});

test("flatten stops at the first opaque layer and blends translucent ones", () => {
	assert.deepEqual(flatten([[0, 0, 0, 0], [10, 20, 30, 1], black]), [10, 20, 30, 1]);
	assert.deepEqual(flatten([[0, 0, 0, 0.5]]), [127.5, 127.5, 127.5, 1]);
	assert.deepEqual(flatten([]), white);
});

test("over blends by alpha", () => {
	assert.deepEqual(over([0, 0, 0, 0.25], white), [191.25, 191.25, 191.25, 1]);
});

test("parseExpected and toHex", () => {
	assert.equal(parseExpected("4.5:1"), 4.5);
	assert.equal(parseExpected("3:1"), 3);
	assert.equal(parseExpected(undefined), 4.5);
	assert.equal(toHex([14, 165, 233, 1]), "#0ea5e9");
});
