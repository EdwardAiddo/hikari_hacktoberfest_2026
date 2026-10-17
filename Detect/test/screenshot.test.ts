import assert from "node:assert/strict";
import { test } from "node:test";
import { screenshotFor } from "../src/screenshot.js";

test("first page keeps the name, later pages get a suffix", () => {
	assert.equal(screenshotFor("out/iteration-1.png", 0), "out/iteration-1.png");
	assert.equal(screenshotFor("out/iteration-1.png", 1), "out/iteration-1-2.png");
	assert.equal(screenshotFor("out.d/shot", 2), "out.d/shot-3");
	assert.equal(screenshotFor(undefined, 1), undefined);
});
