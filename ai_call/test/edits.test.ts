import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { countOccurrences, planEdits, revertFiles, writePlan } from "../src/lib/edits.ts";
import type { SourceFile } from "../src/lib/mapping.ts";
import type { Edit } from "../src/lib/schema.ts";
import { checkCss, checkHtml, checkSyntax } from "../src/lib/syntax.ts";

const tsx = `export function Logo() {
  return <img src={logo} className="brand-logo" />;
}
`;
const css = `.nav-link { color: #aaa; }\n`;

const src = (rel: string, content: string): SourceFile => ({ path: `/repo/${rel}`, rel, content });
const edit = (file: string, oldStr: string, newStr: string): Edit => ({
  file,
  oldStr,
  newStr,
  ruleId: "image-alt",
  rationale: "r",
});

describe("checkSyntax", () => {
  test.each([
    ["a.tsx", tsx, true],
    ["a.tsx", "export const A = () => <div>;", false],
    ["a.ts", "export const id = <T,>(x: T): T => x;", true],
    ["a.ts", "const x: = 1;", false],
    ["a.jsx", "const A = () => <p aria-label='x'>hi</p>;", true],
    ["a.js", "const a = {", false],
    ["a.css", css, true],
    ["a.css", ".a { color: red;", false],
    ["a.css", '.a::before { content: "}"; }', true],
    ["a.css", ".a { /* never closed", false],
    ["a.html", '<!doctype html><html lang="en"><body><script>if (a<b) {}</script></body></html>', true],
    ["a.html", '<html lang="en><body></body></html>', false],
    ["a.html", "<div><!-- open", false],
    ["a.html", "<script>const a = ;</script>", false],
    ["a.vue", '<template><img alt="x"></template><script setup lang="ts">const a: number = 1;</script>', true],
    ["a.svelte", "<script>let a = ;</script><img alt='x'>", false],
    ["a.md", "# x", false],
  ])("%s %#", (path, content, ok) => {
    expect(checkSyntax(path, content) === null).toBe(ok);
  });

  test("checkCss and checkHtml explain the problem", () => {
    expect(checkCss(".a { color: red; ]")).toMatch(/unexpected "\]"/);
    expect(checkHtml('<img alt="x>')).toMatch(/malformed tag <img/);
  });
});

describe("countOccurrences", () => {
  test("counts non-overlapping matches", () => {
    expect(countOccurrences("aaaa", "aa")).toBe(2);
    expect(countOccurrences("abc", "")).toBe(0);
  });
});

describe("planEdits", () => {
  test("applies a unique edit and parse-checks it", () => {
    const file = src("app/src/Logo.tsx", tsx);
    const plan = planEdits([edit("app/src/Logo.tsx", 'className="brand-logo"', 'className="brand-logo" alt="Acme"')], [file]);
    expect(plan.disallowed).toEqual([]);
    expect(plan.files[0]?.error).toBeNull();
    expect(plan.files[0]?.content).toContain('alt="Acme"');
  });

  test("accepts ./ prefixed paths", () => {
    const plan = planEdits([edit("./app/src/Logo.tsx", "brand-logo", "brand-logo x")], [src("app/src/Logo.tsx", tsx)]);
    expect(plan.files).toHaveLength(1);
  });

  test("rejects a file that is not allowed for the call", () => {
    const plan = planEdits([edit("app/package.json", "{", "{")], [src("app/src/Logo.tsx", tsx)]);
    expect(plan.files).toEqual([]);
    expect(plan.disallowed[0]?.reason).toMatch(/not an editable file/);
  });

  test("rejects oldStr that is missing or not unique", () => {
    const file = src("app/src/A.tsx", `const a = <p className="x" />;\nconst b = <p className="x" />;\n`);
    expect(planEdits([edit(file.rel, "nope", "x")], [file]).files[0]?.error).toBe("oldStr not found in the file");
    expect(planEdits([edit(file.rel, 'className="x"', "y")], [file]).files[0]?.error).toMatch(/occurs 2 times/);
  });

  test("applies edits in order, each against the updated content", () => {
    const file = src("app/src/Logo.tsx", tsx);
    const plan = planEdits(
      [
        edit(file.rel, 'className="brand-logo"', 'className="brand-logo" alt="Acme"'),
        edit(file.rel, 'alt="Acme"', 'alt="Acme logo"'),
      ],
      [file],
    );
    expect(plan.files[0]?.content).toContain('alt="Acme logo"');
  });

  test("rejects the whole file when one edit fails", () => {
    const file = src("app/src/Logo.tsx", tsx);
    const plan = planEdits(
      [edit(file.rel, 'className="brand-logo"', 'className="brand-logo" alt="Acme"'), edit(file.rel, "missing", "x")],
      [file],
    );
    expect(plan.files[0]?.content).toBeNull();
  });

  test("rejects an edit that breaks the syntax", () => {
    const file = src("app/src/Logo.tsx", tsx);
    const plan = planEdits([edit(file.rel, " />;", ">;")], [file]);
    expect(plan.files[0]?.error).toMatch(/does not parse/);
  });

  test("rejects a no-op edit", () => {
    const file = src("app/src/Logo.tsx", tsx);
    expect(planEdits([edit(file.rel, "img", "img")], [file]).files[0]?.error).toBe("edit does not change anything");
  });
});

describe("writePlan and revertFiles", () => {
  test("write accepted files, then restore them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "curbfix-edits-"));
    const file: SourceFile = { path: join(dir, "Logo.tsx"), rel: "Logo.tsx", content: tsx };
    await writeFile(file.path, tsx);
    const plan = planEdits([edit("Logo.tsx", 'className="brand-logo"', 'className="brand-logo" alt=""')], [file]);
    await writePlan(plan);
    expect(await readFile(file.path, "utf8")).toContain('alt=""');
    expect(file.content).toContain('alt=""');
    await revertFiles([{ file, previous: tsx }]);
    expect(await readFile(file.path, "utf8")).toBe(tsx);
  });
});
