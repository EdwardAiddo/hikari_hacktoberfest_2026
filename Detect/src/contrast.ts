// WCAG 2 contrast math, used to recheck color-contrast results that axe leaves
// "incomplete" because an image or overlapping element hides the background.

export type Rgba = [number, number, number, number];

/** Composite `top` over an opaque `bottom` (alpha blending in sRGB, as browsers paint). */
export function over(top: Rgba, bottom: Rgba): Rgba {
	const a = top[3];
	return [
		top[0] * a + bottom[0] * (1 - a),
		top[1] * a + bottom[1] * (1 - a),
		top[2] * a + bottom[2] * (1 - a),
		1,
	];
}

/**
 * Background seen through a stack of layers, innermost first (the element's
 * own background, then its parent's, ...). Stops at the first opaque layer;
 * white below everything, like the browser canvas.
 */
export function flatten(layers: Rgba[]): Rgba {
	let color: Rgba = [255, 255, 255, 1];
	const stack: Rgba[] = [];
	for (const layer of layers) {
		if (layer[3] <= 0) continue;
		stack.push(layer);
		if (layer[3] >= 1) break;
	}
	for (const layer of stack.reverse()) color = over(layer, color);
	return color;
}

/** WCAG relative luminance of an sRGB color. */
export function luminance([r, g, b]: Rgba): number {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: Rgba, b: Rgba): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

/** "4.5:1" -> 4.5; axe's own default when missing. */
export function parseExpected(value: unknown): number {
	const n = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : NaN;
	return Number.isFinite(n) && n > 0 ? n : 4.5;
}

export function toHex([r, g, b]: Rgba): string {
	return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}
