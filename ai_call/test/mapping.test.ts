import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  extractTokens,
  isPageLevel,
  locateByRoute,
  locateNode,
  routeOfPageFile,
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

// Real axe-core 4.14 snippets from a live run against the TanStack a11y-devtools example.
describe("locateNode on the TanStack a11y example", () => {
  const app = file(
    "app/src/App.tsx",
    readFileSync(join(import.meta.dirname, "fixtures", "tanstack-a11y-App.tsx"), "utf8"),
  );
  const index = file(
    "app/src/index.tsx",
    `import App from './App'\ncreateRoot(document.getElementById('root')!).render(<App />)\n`,
  );
  const files = [app, index];

  test.each([
    ["button-name", "section:nth-child(3) > div:nth-child(3) > button", `<button style="width: 40px; height: 40px; font-size: 20px;"><span aria-hidden="true">×</span></button>`],
    ["color-contrast", "div:nth-child(5) > p", `<p style="color: rgb(170, 170, 170); background-color: rgb(255, 255, 255);">This text has poor color contrast and may be hard to read.</p>`],
    ["color-contrast", "div:nth-child(7) > div", `<div style="padding: 12px 24px; background-color: rgb(14, 165, 233); color: white; border-radius: 4px; display: inline-block; cursor: pointer;">Click me (not a button!)</div>`],
    ["image-alt", 'img[width="24"]', `<img width="24" height="24" src="https://via.placeholder.com/24">`],
    ["image-alt", 'section:nth-child(3) > div:nth-child(2) > img[width="150"][height="150"]', `<img width="150" height="150" src="https://via.placeholder.com/150" style="border: 1px solid rgb(204, 204, 204);">`],
    ["link-name", "a", `<a href="https://example.com" style="display: inline-block;"><img width="24" height="24" src="https://via.placeholder.com/24"></a>`],
    ["select-name", "select", `<select style="padding: 8px;"><option>Option 1</option><option>Option 2</option><option>Option 3</option></select>`],
  ])("%s %s", (_rule, target, html) => {
    expect(locateNode({ html, target: [target] }, files).file?.rel).toBe("app/src/App.tsx");
  });
});

describe("weak tokens", () => {
  test("matches inline styles across React and HTML spellings, rgb() as hex", () => {
    const tokens = extractTokens({ html: `<p style="background-color: rgb(14, 165, 233); width: 40px">x</p>`, target: ["p"] });
    const style = tokens.filter((t) => t.kind === "style");
    expect(style.map((t) => t.value)).toEqual(["background-color: rgb(14, 165, 233)", "width: 40px"]);
    expect(style[0]!.test(`style={{ backgroundColor: '#0ea5e9' }}`)).toBe(true);
    expect(style[0]!.test(`style="background-color:#0EA5E9"`)).toBe(true);
    expect(style[0]!.test(`style={{ color: '#0ea5e9' }}`)).toBe(false);
    expect(style[1]!.test(`style={{ width: 40 }}`)).toBe(true);
    expect(style[1]!.test(`style={{ width: 400 }}`)).toBe(false);
  });

  test("rgb() inside a compound value accepts the short hex form", () => {
    const [border] = extractTokens({ html: `<img style="border: 1px solid rgb(204, 204, 204)">`, target: ["img"] }).filter(
      (t) => t.kind === "style",
    );
    expect(border!.test(`border: '1px solid #ccc'`)).toBe(true);
  });

  test("size attributes match quoted and JSX forms only", () => {
    const [width] = extractTokens({ html: `<img width="24">`, target: ['img[width="24"]'] }).filter((t) => t.value === "width=24");
    expect(width!.test(`<img width={24} />`)).toBe(true);
    expect(width!.test(`<img width="24">`)).toBe(true);
    expect(width!.test(`<img width={240} />`)).toBe(false);
    expect(width!.test(`const width = 24`)).toBe(false);
  });

  test("Vite-hashed asset names map back to the imported file name", () => {
    const tokens = extractTokens({ html: `<img src="/assets/hero-banner-BdF3x9Qa.png">`, target: ["img"] });
    const asset = tokens.find((t) => t.value === "hero-banner.png");
    expect(asset?.test(`import heroBanner from './assets/hero-banner.png'`)).toBe(true);
  });

  test("data: URIs are not used as tokens", () => {
    const tokens = extractTokens({ html: `<img src="data:image/png;base64,AAAA">`, target: ["img"] });
    expect(tokens.filter((t) => t.kind === "asset")).toEqual([]);
  });

  test("a short symbol counts as text, with its HTML entity", () => {
    const [symbol] = extractTokens({ html: `<button><span aria-hidden="true">×</span></button>`, target: ["button"] }).filter(
      (t) => t.kind === "text",
    );
    expect(symbol?.value).toBe("×");
    expect(symbol!.test("<span>&times;</span>")).toBe(true);
  });

  test("a single generic style declaration is not enough to locate an element", () => {
    const result = locateNode(
      { html: `<div style="display: inline-block;"></div>`, target: ["footer > div"] },
      [file("app/src/A.tsx", `export const A = () => <span style={{ display: 'inline-block' }} />;\n`)],
    );
    expect(result.file).toBeNull();
  });
});

describe("page-level rules", () => {
  test("isPageLevel recognises <html>/<body> targets", () => {
    expect(isPageLevel({ html: '<html lang="en" class="x">', target: ["html"] })).toBe(true);
    expect(isPageLevel({ html: "<body>", target: ["body"] })).toBe(true);
    expect(isPageLevel({ html: "<p>x</p>", target: ["p"] })).toBe(false);
  });

  test.each([
    ["website/src/app/page.tsx", "/"],
    ["website/src/app/demo/page.tsx", "/demo"],
    ["website/app/(marketing)/about/page.mdx", "/about"],
    ["website/src/app/@modal/login/page.tsx", "/login"],
    ["site/pages/index.tsx", "/"],
    ["site/pages/blog/index.jsx", "/blog"],
    ["site/pages/contact.tsx", "/contact"],
    ["site/pages/_app.tsx", null],
    ["site/pages/api/hello.ts", null],
    ["website/src/components/Hero.tsx", null],
    ["website/src/app/demo/layout.tsx", null],
  ])("routeOfPageFile(%s) = %s", (rel, route) => {
    expect(routeOfPageFile(rel)).toBe(route);
  });

  test("locateByRoute picks the changed page for the URL", () => {
    const home = file("website/src/app/page.tsx", "export default function Home() {}");
    const demo = file("website/src/app/demo/page.tsx", "export default function Demo() {}");
    expect(locateByRoute("http://localhost:4173/demo", [home, demo])?.rel).toBe("website/src/app/demo/page.tsx");
    expect(locateByRoute("http://localhost:4173/", [home, demo])?.rel).toBe("website/src/app/page.tsx");
    expect(locateByRoute("http://localhost:4173/other", [home, demo])).toBeNull();
    expect(locateByRoute(undefined, [home, demo])).toBeNull();
  });
});
