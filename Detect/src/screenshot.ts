// Screenshot file names when several pages are audited in one run.

/** First page keeps the given name; later pages get -2, -3 ... before the extension. */
export function screenshotFor(path: string | undefined, index: number): string | undefined {
	if (!path || index === 0) return path;
	const dot = path.lastIndexOf(".");
	return dot > path.lastIndexOf("/") ? `${path.slice(0, dot)}-${index + 1}${path.slice(dot)}` : `${path}-${index + 1}`;
}
