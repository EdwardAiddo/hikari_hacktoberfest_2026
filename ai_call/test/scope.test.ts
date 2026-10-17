import { realpath, symlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { denyReason, listCandidateFiles } from "../src/lib/scope.ts";
import { git, makeRepo } from "./helpers.ts";

describe("denyReason", () => {
  const app = "/repo/app";
  test.each([
    ["/repo/app/src/App.tsx", null],
    ["/repo/app/index.html", null],
    ["/repo/app/src/styles.css", null],
    ["/repo/app/package.json", "package.json is protected"],
    ["/repo/app/package-lock.json", "lockfiles are protected"],
    ["/repo/app/vite.config.ts", "config files are protected"],
    ["/repo/app/tailwind.config.js", "config files are protected"],
    ["/repo/app/tsconfig.app.json", "tsconfig files are protected"],
    ["/repo/app/node_modules/x/index.js", "inside a protected directory"],
    ["/repo/app/dist/index.html", "inside a protected directory"],
    ["/repo/app/.github/workflows/x.js", "inside a protected directory"],
    ["/repo/other/App.tsx", "outside the app directory"],
    ["/repo/app/../app2/App.tsx", "outside the app directory"],
    ["/repo/app/README.md", "extension not allowed"],
  ])("%s", (path, expected) => {
    expect(denyReason(path, app)).toBe(expected);
  });
});

describe("listCandidateFiles", () => {
  test("returns added and modified allowed files inside the app", async () => {
    const root = await makeRepo(
      {
        "app/src/Old.tsx": "export const Old = 1;\n",
        "app/src/Untouched.tsx": "export const U = 1;\n",
        "app/src/Gone.tsx": "export const G = 1;\n",
      },
      {
        "app/src/Old.tsx": "export const Old = 2;\n",
        "app/src/New.tsx": "export const New = 1;\n",
        "app/package.json": "{}\n",
        "app/vite.config.ts": "export default {};\n",
        "other/Outside.tsx": "export const O = 1;\n",
      },
    );
    git(root, "rm", "-q", "app/src/Gone.tsx");
    git(root, "commit", "-q", "-m", "delete");

    const files = await listCandidateFiles({ base: "main", appDir: "app", cwd: root });
    const real = await realpath(root);
    const rel = files.map((f) => f.slice(real.length + 1));
    expect(rel).toEqual(["app/src/New.tsx", "app/src/Old.tsx"]);
  });

  test("drops a symlink that points at a protected file", async () => {
    const root = await makeRepo({ "app/package.json": "{}\n" }, {});
    await symlink("package.json", join(root, "app/sneaky.js"));
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "link");
    const files = await listCandidateFiles({ base: "main", appDir: "app", cwd: root });
    expect(files).toEqual([]);
  });
});
