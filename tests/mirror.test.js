import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crawlSite } from "../src/scanner/crawl.js";
import { folderFetcher, parse } from "../src/scanner/node.js";
import { findSpots, siteNameOf } from "../src/spots.js";
import { decidePlan } from "../src/score.js";
import { buildPack } from "../src/pack/build.js";
import { fileFor, mirrorPage } from "../src/pack/mirror.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("fileFor: site paths become files", () => {
  assert.equal(fileFor("/"), "index.html");
  assert.equal(fileFor("/docs"), "docs/index.html");
  assert.equal(fileFor("/guides/a-b"), "guides/a-b/index.html");
  assert.equal(fileFor("/faq.html"), "faq.html");
  assert.equal(fileFor("/tours/"), "tours/index.html");
});

test("mirrorPage: no page scripts, links between scanned pages stay in the copy, forms send nothing", () => {
  const html = `<!doctype html><html><head><link rel="stylesheet" href="/css/site.css"><script src="/app.js"></script></head>
    <body onload="x()"><a href="/docs">Docs</a><a href="/pricing#pro">Pricing</a><a href="https://other.test/">Other</a>
    <img src="logo.png" srcset="/a.png 1x, /b.png 2x"><div style="background:url('/bg.jpg')"></div>
    <form action="/subscribe" method="post"><input name="email"></form></body></html>`;
  const doc = mirrorPage(html, { pageUrl: "https://site.test/guides/x", pagePaths: new Set(["/", "/docs", "/guides/x"]), parse });
  const out = doc.documentElement.outerHTML;
  assert.doesNotMatch(out, /<script|onload/);
  assert.match(out, /href="https:\/\/site.test\/css\/site.css"/, "styles load from the real site");
  assert.match(out, /href="\.\.\/\.\.\/docs\/"/, "a scanned page links to its copy");
  assert.match(out, /href="https:\/\/site.test\/pricing#pro"/, "a page that was not scanned links to the real site");
  assert.match(out, /src="https:\/\/site.test\/guides\/logo.png"/);
  assert.match(out, /srcset="https:\/\/site.test\/a.png 1x, https:\/\/site.test\/b.png 2x"/);
  assert.match(out, /url\('https:\/\/site.test\/bg.jpg'\)/);
  assert.match(out, /<form(?=[^>]*action="#")(?=[^>]*data-preview-form)/);
});

test("mirrorPage: sections a script would reveal on scroll are shown without it", () => {
  const html = `<!doctype html><html><head></head><body><main>
    <div data-reveal="true" class="section-title"><h2>Features</h2></div>
    <div style="opacity:0; transform:translateY(24px); color:red"><p>Animated in by a library</p></div>
    <div style="opacity:0.5"><p>Half see-through on purpose</p></div></main></body></html>`;
  const doc = mirrorPage(html, { pageUrl: "https://site.test/", pagePaths: new Set(["/"]), parse });
  const out = doc.documentElement.outerHTML;
  assert.match(out, /\[data-reveal\][^{]*\{\s*opacity: 1 !important/, "the reveal rule is in the page");
  assert.match(out, /<div style=" color:red"><p>Animated in/, "an inline start state (opacity 0 + transform) is removed");
  assert.match(out, /style="opacity:0.5"/, "a deliberate opacity stays");
});

test("markSpots: the Ask bar for questions goes before the first question's own card", async () => {
  const { markSpots } = await import("../src/pack/build.js");
  const doc = parse(`<!doctype html><html><body><main><h1>Guide</h1><section><h2>All flowers</h2>
    <section class="card"><h3>What does a rose mean?</h3><p>Love.</p></section>
    <section class="card"><h3>What does a lily mean?</h3><p>Peace.</p></section></section></main></body></html>`);
  const spot = { id: "answers:/guide", kind: "answers", path: "/guide", paths: ["/guide"], target: { find: "question", index: 0 } };
  assert.equal(markSpots(doc, [spot], "/guide/"), 1);
  const marked = doc.querySelector("[data-agent-spot]");
  assert.equal(marked.className, "card", "the card, not the heading inside it");
  assert.equal(markSpots(parse("<!doctype html><html><body><main><h2>Why us?</h2></main></body></html>"), [spot], "/other"), 0, "only on the spot's pages");
});

test("mirror pack: a live site's copy with the assistant placed right after its form, passing --check", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "mythagentic-mirror-"));
  try {
    const origin = "https://tours.test";
    const fetcher = folderFetcher(path.join(root, "test-sites", "tours"), origin);
    const htmls = new Map();
    const crawl = await crawlSite(`${origin}/`, { fetcher: async (url) => { const r = await fetcher(url); htmls.set(url, r.text); return r; }, parse });
    const { size, spots } = findSpots(crawl);
    const plan = decidePlan(spots, { size });
    const pagePaths = new Set(crawl.pages.map((p) => p.path));
    const pages = crawl.pages.map((p) => ({ path: p.path, html: `<!doctype html>\n${mirrorPage(htmls.get(p.url), { pageUrl: p.url, pagePaths, parse }).documentElement.outerHTML}` }));

    const pack = await buildPack({ siteName: siteNameOf(crawl), plan, mirror: { pages }, outDir: out });
    assert.equal(pack.ok, true, pack.check);
    assert.equal(pack.companion, false);
    assert.ok(pack.tools.includes("fill_reserve_form"), "a copy we host can fill its own forms");

    const reserve = await readFile(path.join(out, "reserve.html"), "utf8");
    assert.match(reserve, /<form(?=[^>]*data-agent-spot="form)(?=[^>]*data-agent-kind="form")/, "the form gets the Ask bar");
    assert.match(reserve, /id="assistant"/);
    assert.match(reserve, /src="site.js"/);
    assert.match(reserve, /src="assistant-dock.js"/);
    assert.match(reserve, /src="mirror-page.js"/);
    assert.doesNotMatch(reserve, /src="demo-form.js"/, "the page's own scripts are gone");
    const tour = await readFile(path.join(out, "tours", "tour-a-lagoons.html"), "utf8");
    assert.match(tour, /src="\.\.\/mirror-page.js"/, "every page gets the preview banner");
    assert.match(tour, /id="assistant"/, "the side panel opens from every page");
    assert.doesNotMatch(tour, /data-agent-spot=/, "no Ask bar where there is no spot");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
