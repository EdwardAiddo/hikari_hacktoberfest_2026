import assert from "node:assert/strict";
import { test } from "node:test";
import { appKind, chooseTarget, nextRoute } from "./curbfix-target.mjs";

const apps = [
	{ dir: "website", kind: "next" },
	{ dir: "demo-app", kind: "vite" },
];

test("PR #4: Next.js pages map to their routes, / always included", () => {
	const changed = ["website/src/app/demo/page.tsx", "website/src/app/page.tsx"];
	assert.deepEqual(chooseTarget(changed, apps), { app: "website", kind: "next", paths: ["/", "/demo"] });
});

test("a Vite app is audited at /", () => {
	assert.deepEqual(chooseTarget(["demo-app/src/components/Header.tsx"], apps), {
		app: "demo-app",
		kind: "vite",
		paths: ["/"],
	});
});

test("the first configured app wins when a PR changes several", () => {
	assert.equal(chooseTarget(["demo-app/index.html", "website/src/app/page.tsx"], apps)?.app, "website");
});

test("a PR that changes no app has no target", () => {
	assert.equal(chooseTarget(["README.md", "ai_call/src/fix.ts"], apps), null);
});

test("an unsupported app is skipped", () => {
	assert.equal(chooseTarget(["website/x.ts"], [{ dir: "website", kind: null }]), null);
});

test("nextRoute: groups and slots vanish, dynamic or unsafe segments are skipped", () => {
	assert.equal(nextRoute("website", "website/src/app/page.tsx"), "/");
	assert.equal(nextRoute("website", "website/app/(marketing)/about/page.mdx"), "/about");
	assert.equal(nextRoute("website", "website/src/app/@modal/login/page.tsx"), "/login");
	assert.equal(nextRoute("website", "website/src/app/blog/[slug]/page.tsx"), null);
	assert.equal(nextRoute("website", "website/src/app/a$(id)/page.tsx"), null);
	assert.equal(nextRoute("website", "website/src/app/demo/layout.tsx"), null);
	assert.equal(nextRoute("website", "website/src/components/Hero.tsx"), null);
});

test("appKind reads dependencies", () => {
	assert.equal(appKind({ dependencies: { next: "16" } }), "next");
	assert.equal(appKind({ devDependencies: { vite: "8" } }), "vite");
	assert.equal(appKind({}), null);
});
