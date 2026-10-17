import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import type { Impact, PageResult, Violation } from "./types.js";

export interface ScanOptions {
	/** where to save the screenshot; omit to skip it */
	screenshotPath?: string;
}

const IMPACT_SCORE: Record<Impact, number> = {
	critical: 4,
	serious: 3,
	moderate: 2,
	minor: 1,
};

function impactScore(impact: Impact | null): number {
	return impact ? IMPACT_SCORE[impact] : 0;
}

/** Open `url` in headless Chromium, run axe-core, return one Violation per failing node. */
export async function scanPage(
	url: string,
	opts: ScanOptions = {},
): Promise<PageResult> {
	const browser = await chromium.launch({ headless: true });
	try {
		// axe requires a page created from an explicit context
		const context = await browser.newContext();
		const page = await context.newPage();
		await page.goto(url, { waitUntil: "networkidle" });

		const results = await new AxeBuilder({ page }).analyze();

		const violations: Violation[] = [];
		for (const rule of results.violations) {
			for (const node of rule.nodes) {
				// color-contrast keeps its fgColor/bgColor/contrastRatio in the checks' data
				const check = node.any.find((c) => c.data !== undefined);

				violations.push({
					ruleId: rule.id,
					impact: (node.impact ?? rule.impact ?? null) as Impact | null,
					help: rule.help,
					html: node.html,
					target: node.target.map(String),
					failureSummary: node.failureSummary ?? "No summary available",
					data: check?.data as Record<string, unknown> | undefined,
				});
			}
		}

		// most severe first
		violations.sort((a, b) => impactScore(b.impact) - impactScore(a.impact));

		let screenshotPath: string | undefined;
		if (opts.screenshotPath) {
			await mkdir(dirname(opts.screenshotPath), { recursive: true });
			await page.screenshot({ path: opts.screenshotPath, fullPage: true });
			screenshotPath = opts.screenshotPath;
		}

		return { url, violations, screenshotPath };
	} finally {
		await browser.close();
	}
}
