import { describe, expect, test } from "vitest";
import {
  extractTokens,
  locateNode,
  parseRootTag,
  selectorParts,
  textChunks,
  type SourceFile,
} from "../src/lib/mapping.ts";

const file = (rel: string, content: string): SourceFile => ({ path: `/repo/${rel}`, rel, content });

const header = file(
  "app/src/Header.tsx",
  `import "./Header.css";
export function Header() {
  return (
    <header className="site-header">
      <img src={logo} className="brand-logo" />
      <button className="icon-btn menu-toggle" onClick={toggle}>
        <svg viewBox="0 0 24 24"><path d="M3 6h18" /></svg>
      </button>
      <a href="/pricing" className="nav-link">See our pricing plans</a>
    </header>
  );
}
`,
);
const form = file(
  "app/src/SignupForm.tsx",
  `export function SignupForm() {
  return (
    <form>
      <input id="email" type="email" placeholder="you@example.com" />
      <button className="icon-btn" type="submit">Join</button>
    </form>
  );
}
`,
);
const headerCss = file("app/src/Header.css", ".nav-link { color: #aaa; }\n");
const otherCss = file("app/src/theme.css", ".brand-logo { width: 40px; }\n.unrelated { color: red; }\n");
const indexHtml = file(
  "app/index.html",
  `<!doctype html>
<html>
  <head><title></title></head>
  <body><div id="root"></div></body>
</html>
`,
);
const files = [header, form, headerCss, otherCss, indexHtml];

describe("parseRootTag", () => {
  test("reads attributes with all quoting styles", () => {
    const parsed = parseRootTag(`<input id="email" type=email data-x='a b' disabled placeholder="a &amp; b">`);
    expect(parsed?.tag).toBe("input");
    expect(Object.fromEntries(parsed!.attrs)).toEqual({
      id: "email",
      type: "email",
      "data-x": "a b",
      disabled: "",
      placeholder: "a & b",
    });
  });

  test("handles > inside attribute values", () => {
    expect(parseRootTag(`<a title="1 > 0" href="/x">`)?.attrs.get("href")).toBe("/x");
  });

  test("returns null for non-HTML", () => {
    expect(parseRootTag("just text")).toBeNull();
  });
});

describe("textChunks", () => {
  test("ignores svg content, decodes entities and drops axe truncation", () => {
    const html = `<a class="x">Terms &amp; conditions<svg><title>icon title</title></svg> and a very long tail...</a>`;
    expect(textChunks(html)).toEqual(["and a very long tail", "Terms & conditions"]);
  });
});

describe("selectorParts", () => {
  test("uses the last compound selector only", () => {
    expect(selectorParts(`#root > .card .btn.primary[data-testid="buy"]`)).toEqual({
      ids: [],
      classes: ["btn", "primary"],
      attrs: [["data-testid", "buy"]],
    });
  });

  test("unescapes escaped characters in ids", () => {
    expect(selectorParts("#field\\:r1\\:").ids).toEqual(["field:r1:"]);
  });
});

describe("extractTokens", () => {
  test("weights ids above classes", () => {
    const tokens = extractTokens({ html: `<input id="email" class="field">`, target: ["#email"] });
    expect(tokens.map((t) => [t.kind, t.value, t.weight])).toEqual([
      ["id", "email", 10],
      ["class", "field", 3],
    ]);
  });
});

describe("locateNode", () => {
  test("finds an element by a unique class", () => {
    const result = locateNode({ html: `<img src="/assets/logo-abc.png" class="brand-logo">`, target: ["img"] }, files);
    expect(result.file?.rel).toBe("app/src/Header.tsx");
  });

  test("a class shared by two files is not enough on its own", () => {
    const result = locateNode({ html: `<button class="icon-btn"><svg></svg></button>`, target: [".icon-btn"] }, files);
    expect(result.file).toBeNull();
  });

  test("a shared class plus a unique one is enough", () => {
    const result = locateNode(
      { html: `<button class="icon-btn menu-toggle"><svg></svg></button>`, target: [".menu-toggle"] },
      files,
    );
    expect(result.file?.rel).toBe("app/src/Header.tsx");
  });

  test("finds an element by id and placeholder", () => {
    const result = locateNode({ html: `<input id="email" type="email" placeholder="you@example.com">`, target: ["#email"] }, files);
    expect(result.file?.rel).toBe("app/src/SignupForm.tsx");
  });

  test("finds an element by visible text across line breaks", () => {
    const result = locateNode({ html: `<p>See our   pricing plans</p>`, target: ["p"] }, files);
    expect(result.file?.rel).toBe("app/src/Header.tsx");
  });

  test("maps document-level elements to the HTML entry point", () => {
    const result = locateNode({ html: `<html>`, target: ["html"] }, files);
    expect(result.file?.rel).toBe("app/index.html");
  });

  test("attaches imported CSS and CSS that styles the element", () => {
    const result = locateNode({ html: `<a href="/pricing" class="nav-link">See our pricing plans</a>`, target: [".nav-link"] }, files);
    expect(result.file?.rel).toBe("app/src/Header.tsx");
    expect(result.file && result.related.map((f) => f.rel)).toEqual(["app/src/Header.css"]);
  });

  test("an element from an untouched file is out of scope with a reason", () => {
    const result = locateNode({ html: `<footer class="site-footer">© 2026 Acme</footer>`, target: ["footer"] }, files);
    expect(result.file).toBeNull();
    expect(!result.file && result.reason).toMatch(/not found in files changed by this PR/);
  });

  test("CSS files alone never locate an element", () => {
    const result = locateNode({ html: `<div class="unrelated">x</div>`, target: [".unrelated"] }, [otherCss]);
    expect(result.file).toBeNull();
    expect(!result.file && result.reason).toBe("no markup files changed in this PR");
  });
});
