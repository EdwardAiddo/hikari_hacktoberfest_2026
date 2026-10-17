// OWNER: person B (branch feature/detect-scanner)
// Browser + axe part of Tool 1. Replace the stub body; keep the exported signature.
import type { PageResult } from "./types.js";

export interface ScanOptions {
  /** where to save the screenshot; omit to skip it */
  screenshotPath?: string;
}

/**
 * Open `url` in headless Chromium, run axe-core, return normalized violations.
 *
 * Reminders:
 *  - axe needs `browser.newContext()` then `context.newPage()` (not `browser.newPage()`)
 *  - one Violation per failing node (axe groups nodes under a rule: flatten them)
 *  - keep nodes[].any[].data for color-contrast
 *  - sort by impact (critical first) and close the browser even on errors
 */
export async function scanPage(url: string, _opts: ScanOptions = {}): Promise<PageResult> {
  // STUB: returns no violations so detect.ts can be tested before this exists.
  return { url, violations: [] };
}
