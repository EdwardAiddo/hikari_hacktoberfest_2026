// Shared contract between Tool 1 (detect), Tool 2 (fix) and Tool 3 (comment).
// Changing this file affects everyone: tell the team before you do.

export type Impact = "minor" | "moderate" | "serious" | "critical";

/** One failing element reported by axe-core (a rule can fail on several elements). */
export interface Violation {
  /** axe rule id, e.g. "image-alt", "button-name", "color-contrast" */
  ruleId: string;
  impact: Impact | null;
  /** short human description of the rule, from axe's `help` */
  help: string;
  /** outerHTML snippet of the failing element */
  html: string;
  /** CSS selector path(s) to the element, from axe's `target` */
  target: string[];
  /** axe's explanation of what to change */
  failureSummary: string;
  /** extra rule data; for color-contrast: fgColor, bgColor, contrastRatio, expectedContrastRatio */
  data?: Record<string, unknown>;
  /** set when Tool 2 listed this element in out-of-scope.json: reported, but not counted for the exit code */
  outOfScope?: boolean;
  /** page the element was found on (set when several URLs are audited) */
  url?: string;
}

/** What scanPage() returns for one URL. */
export interface PageResult {
  url: string;
  violations: Violation[];
  /** path of the screenshot file, if one was taken */
  screenshotPath?: string;
}

/** Shape of the file detect.ts writes to --out (violations.json). */
export interface DetectOutput {
  /** first audited URL (kept for tools that read a single url) */
  url: string;
  /** every audited URL, in the order given */
  urls: string[];
  /** ISO timestamp of the scan */
  scannedAt: string;
  violations: Violation[];
}

/** Exit codes of detect.ts, relied on by .github/workflows/curbfix.yml */
export const EXIT_CLEAN = 0;
export const EXIT_VIOLATIONS = 2;
