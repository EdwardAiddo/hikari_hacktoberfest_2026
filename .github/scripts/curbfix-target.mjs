// Decide which app a pull request is audited on, and which of its pages.
//
//   BASE_REF=origin/main CURBFIX_APPS="website demo-app" node .github/scripts/curbfix-target.mjs
//
// The first app in CURBFIX_APPS that the PR changed wins. Supported apps:
// Next.js (served with `next start`) and Vite (served with `vite preview`).
// For Next.js app-router apps, every changed `app/**/page.*` adds its route;
// "/" is always audited. Writes app, kind and paths to $GITHUB_OUTPUT; app is
// empty when the PR changed no supported app.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_PATHS = 5;
const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/;
const PAGE_FILE = /^page\.(tsx|jsx|ts|js|mdx)$/;

/** "next", "vite" or null, from the app's package.json dependencies. */
export function appKind(pkg) {
	const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
	if (deps.next) return "next";
	if (deps.vite) return "vite";
	return null;
}

/**
 * Route of a changed Next.js app-router page, or null. Route groups "(x)" and
 * parallel slots "@x" do not appear in the URL; dynamic segments "[id]" cannot
 * be audited without a value, and anything unusual is skipped rather than
 * passed on to a URL.
 */
export function nextRoute(appDir, file) {
	for (const root of [`${appDir}/src/app/`, `${appDir}/app/`]) {
		if (!file.startsWith(root)) continue;
		const parts = file.slice(root.length).split("/");
		if (!PAGE_FILE.test(parts.pop() ?? "")) return null;
		const segments = parts.filter((p) => !/^\(.+\)$/.test(p) && !p.startsWith("@"));
		if (!segments.every((s) => SAFE_SEGMENT.test(s))) return null;
		return `/${segments.join("/")}`;
	}
	return null;
}

/** Pure: the target for a list of changed files and the configured apps. */
export function chooseTarget(changed, apps) {
	for (const { dir, kind } of apps) {
		const files = changed.filter((f) => f.startsWith(`${dir}/`));
		if (files.length === 0 || !kind) continue;
		const paths = ["/"];
		if (kind === "next") {
			for (const f of files) {
				const route = nextRoute(dir, f);
				if (route && !paths.includes(route)) paths.push(route);
			}
		}
		return { app: dir, kind, paths: paths.slice(0, MAX_PATHS) };
	}
	return null;
}

function main() {
	const base = process.env.BASE_REF;
	if (!base) throw new Error("BASE_REF is not set");
	const names = (process.env.CURBFIX_APPS ?? "").split(/\s+/).filter(Boolean);

	const apps = names.map((dir) => {
		const pkgPath = join(dir, "package.json");
		if (!existsSync(pkgPath) || !existsSync(join(dir, "package-lock.json"))) {
			console.log(`::warning::${dir}: no package.json or package-lock.json, skipped`);
			return { dir, kind: null };
		}
		const kind = appKind(JSON.parse(readFileSync(pkgPath, "utf8")));
		if (!kind) console.log(`::warning::${dir}: neither Next.js nor Vite, skipped`);
		return { dir, kind };
	});

	const changed = execFileSync("git", ["diff", "--name-only", "--diff-filter=AM", `${base}...HEAD`], {
		encoding: "utf8",
	})
		.split("\n")
		.filter(Boolean);

	const target = chooseTarget(changed, apps);
	const lines = target
		? [`app=${target.app}`, `kind=${target.kind}`, `paths=${target.paths.join(" ")}`]
		: ["app=", "kind=", "paths="];
	console.log(target ? `Auditing ${target.app} (${target.kind}): ${target.paths.join(" ")}` : "This PR changes no audited app: nothing to do.");
	if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
