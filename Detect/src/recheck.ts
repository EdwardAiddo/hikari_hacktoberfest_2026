// axe reports color-contrast as "incomplete" when an image or an overlapping
// element hides the background (for example decorative art behind the text).
// Recheck those nodes with the CSS background colors only, ignoring the image,
// and report the ones that fail as violations, labelled as rechecked.
import type AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright";
import { contrastRatio, flatten, over, parseExpected, toHex, type Rgba } from "./contrast.js";
import type { Impact, Violation } from "./types.js";

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;

/** axe's reasons for not deciding that this recheck can answer. */
const RECHECK_REASONS = new Set(["imgNode", "bgImage", "bgOverlap"]);

interface Measured {
	fg: Rgba;
	layers: Rgba[];
}

/**
 * Runs in the page: text color and background layers (innermost first) as sRGB.
 * Kept as plain JavaScript text on purpose: tsx/esbuild would insert helpers
 * such as __name() into a compiled function, and those do not exist in the page.
 */
const MEASURE_JS = `(selector) => {
	const el = document.querySelector(selector);
	if (!el) return null;
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = 1;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return null;
	// Let the browser convert any CSS color (oklch, lab, named...) to sRGB.
	function toRgba(css) {
		ctx.clearRect(0, 0, 1, 1);
		ctx.fillStyle = "rgba(0, 0, 0, 0)";
		ctx.fillStyle = css;
		ctx.fillRect(0, 0, 1, 1);
		const d = ctx.getImageData(0, 0, 1, 1).data;
		return [d[0], d[1], d[2], d[3] / 255];
	}
	const layers = [];
	for (let node = el; node; node = node.parentElement) {
		layers.push(toRgba(getComputedStyle(node).backgroundColor));
	}
	return { fg: toRgba(getComputedStyle(el).color), layers };
}`;

async function measure(page: Page, selector: string): Promise<Measured | null> {
	try {
		return (await page.evaluate(`(${MEASURE_JS})(${JSON.stringify(selector)})`)) as Measured | null;
	} catch (err) {
		console.error(`detect: contrast recheck of ${selector} failed: ${(err as Error).message.split("\n")[0]}`);
		return null;
	}
}

export async function recheckContrast(page: Page, incomplete: AxeResults["incomplete"]): Promise<Violation[]> {
	const out: Violation[] = [];
	for (const rule of incomplete) {
		if (rule.id !== "color-contrast") continue;
		for (const node of rule.nodes) {
			const check = [...node.any, ...node.all, ...node.none].find((c) => c.data);
			const data = (check?.data ?? {}) as Record<string, unknown>;
			const reason = String(data.messageKey ?? "");
			// Only plain selectors: shadow DOM targets are nested arrays.
			const selector = node.target.length === 1 && typeof node.target[0] === "string" ? node.target[0] : null;
			if (!RECHECK_REASONS.has(reason) || !selector) continue;

			const measured = await measure(page, selector);
			if (!measured) continue;
			const bg = flatten(measured.layers);
			const fg = measured.fg[3] < 1 ? over(measured.fg, bg) : measured.fg;
			const ratio = contrastRatio(fg, bg);
			const expected = parseExpected(data.expectedContrastRatio);
			if (ratio >= expected) continue;

			const shown = Math.floor(ratio * 100) / 100;
			out.push({
				ruleId: rule.id,
				impact: (node.impact ?? rule.impact ?? "serious") as Impact,
				help: rule.help,
				html: node.html,
				target: [selector],
				failureSummary:
					`Fix any of the following:\n  Element has insufficient color contrast of ${shown} ` +
					`(foreground color: ${toHex(fg)}, background color: ${toHex(bg)}, ` +
					`expected contrast ratio of ${expected}:1)\n` +
					`  Rechecked by curbfix: axe could not determine the background (${reason}); ` +
					`this ratio uses the CSS background colors and ignores the image.`,
				data: {
					fgColor: toHex(fg),
					bgColor: toHex(bg),
					contrastRatio: shown,
					expectedContrastRatio: `${expected}:1`,
					fontSize: data.fontSize,
					fontWeight: data.fontWeight,
					recheckedBecause: reason,
				},
			});
		}
	}
	return out;
}
