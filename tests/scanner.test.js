import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowed, parseRobots } from "../src/scanner/robots.js";
import { parseSitemap } from "../src/scanner/sitemap.js";
import { distance, groupByTemplate, simhash } from "../src/scanner/simhash.js";
import { measurePage } from "../src/scanner/page.js";
import { crawlSite } from "../src/scanner/crawl.js";
import { folderFetcher, parse } from "../src/scanner/node.js";
import { findSpots } from "../src/spots.js";
import { decidePlan } from "../src/score.js";

const sites = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test-sites");

/** Scans one test site from disk. */
async function scan(name) {
  const origin = `https://${name}.test`;
  const crawl = await crawlSite(`${origin}/`, { fetcher: folderFetcher(path.join(sites, name), origin), parse });
  const found = findSpots(crawl);
  return { crawl, ...found, plan: decidePlan(found.spots, { size: found.size }) };
}

test("robots.txt: longest rule wins, Allow wins a tie, * and $ work", () => {
  const robots = parseRobots(`
User-agent: *
Disallow: /private/
Allow: /private/open.html
Disallow: /*.pdf$
Disallow:

User-agent: OtherBot
Disallow: /

Sitemap: https://x.test/sitemap.xml
`);
  assert.equal(isAllowed(robots, "/"), true);
  assert.equal(isAllowed(robots, "/private/a.html"), false);
  assert.equal(isAllowed(robots, "/private/open.html"), true);
  assert.equal(isAllowed(robots, "/files/a.pdf"), false);
  assert.equal(isAllowed(robots, "/files/a.pdf?x=1"), true);
  assert.equal(isAllowed(robots, "/anything", "OtherBot"), false);
  assert.deepEqual(robots.sitemaps, ["https://x.test/sitemap.xml"]);
  assert.equal(isAllowed(parseRobots("User-agent: MythAgenticScanner\nDisallow: /\n"), "/a"), false);
});

test("sitemap: pages, a sitemap index, relative locations and entities", () => {
  const pages = parseSitemap("<urlset><url><loc>/a.html</loc></url><url><loc>https://x.test/b?x=1&amp;y=2</loc></url></urlset>", "https://x.test/sitemap.xml");
  assert.deepEqual(pages.pages, ["https://x.test/a.html", "https://x.test/b?x=1&y=2"]);
  const index = parseSitemap("<sitemapindex><sitemap><loc>https://x.test/s1.xml</loc></sitemap></sitemapindex>", "https://x.test/");
  assert.deepEqual(index, { pages: [], sitemaps: ["https://x.test/s1.xml"] });
});

test("simhash: same features match, different features differ; groups need 3 pages in a folder", () => {
  const a = simhash(["main>h1", "main>p", "main>table>tr>td"]);
  assert.equal(distance(a, simhash(["main>h1", "main>p", "main>table>tr>td"])), 0);
  assert.ok(distance(a, simhash(["main>form>input", "main>form>select", "main>h2", "main>ul>li"])) > 3);
  const two = groupByTemplate([{ url: "https://x.test/p/a", hash: a }, { url: "https://x.test/p/b", hash: a }]);
  assert.equal(two.length, 2);
  const three = groupByTemplate(["a", "b", "c"].map((x) => ({ url: `https://x.test/p/${x}`, hash: a })));
  assert.equal(three.length, 1);
  assert.equal(three[0].id, "template:/p/");
  const otherFolder = groupByTemplate(["/p/a", "/p/b", "/q/c"].map((x) => ({ url: `https://x.test${x}`, hash: a })));
  assert.equal(otherFolder.length, 3);
});

test("a page: table cells stay separate words, and form fields are measured", () => {
  const doc = parse(`<html><head><title>T</title></head><body><main>
    <h1>Book</h1>
    <table><tr><th>Price</th><td>Price on request</td></tr></table>
    <form id="f" method="post">
      <label for="n">Name</label><input id="n" name="name" required>
      <input name="email" type="email" placeholder="Email">
      <fieldset><legend>Size</legend><input type="radio" name="size" value="s"><input type="radio" name="size" value="m"></fieldset>
      <input type="hidden" name="token"><input type="password" name="pw" aria-label="Password">
      <select name="pick"><option value="">Pick</option><option>A</option><option>B</option></select>
      <button>Pay now</button>
    </form></main></body></html>`);
  const page = measurePage(doc, "https://x.test/book.html");
  assert.equal(page.priceOnRequest, 1);
  const form = page.forms[0];
  assert.equal(form.fieldCount, 5, "radio group counts once; hidden is skipped");
  assert.equal(form.requiredCount, 1);
  assert.equal(form.missingLabels, 2, "a placeholder is not a label; the select has none");
  assert.equal(form.largestSelect, 2, "the empty prompt option is not counted");
  assert.equal(form.hasPassword, true);
  assert.equal(form.pays, true);
});

test("crawl: robots, sitemap, and one template group for the shop's 8 product pages", async () => {
  const shop = await scan("shop");
  assert.equal(shop.crawl.robotsFound, true);
  assert.equal(shop.crawl.pages.length, 12);
  const products = shop.groups.find((g) => g.id === "template:/products/");
  assert.equal(products.urls.length, 8);
  assert.equal(shop.groups.length, 5);
});

test("crawl: the login page is measured, but its links are not followed", async () => {
  const origin = "https://login.test";
  const files = {
    "/": '<a href="/login.html">Log in</a>',
    "/login.html": '<form><input type="password" name="pw"></form><a href="/secret.html">x</a>',
    "/secret.html": "<p>secret</p>",
    "/cart/": "<p>cart</p>",
  };
  const fetcher = async (url) => {
    const p = new URL(url).pathname;
    return p in files ? { status: 200, contentType: "text/html", text: files[p] } : { status: 404, contentType: "", text: "" };
  };
  files["/"] += '<a href="/cart/">Cart</a>';
  const crawl = await crawlSite(`${origin}/`, { fetcher, parse });
  assert.deepEqual(crawl.pages.map((p) => p.path), ["/", "/login.html"]);
  assert.deepEqual(crawl.skipped, [{ url: "https://login.test/cart/", reason: "account, cart or checkout page" }]);
});

/** decision and placement for each spot, by a short key. */
function decisions(plan) {
  return plan.map((d) => [d.spot.id, d.decision, d.placement]);
}

test("clinic: the build plan's placement map, from measured signals", async () => {
  const { plan, size } = await scan("clinic");
  assert.equal(size, "small");
  assert.deepEqual(decisions(plan), [
    ["form:/book.html#booking", "agent", "inline_form_helper"],
    ["answers:/faq.html", "agent", "answer_desk"],
    ["action:check_slots:/book.html", "plan_next", "agent_action"],
    ["prices", "fix", "none"],
    ["contact:/contact.html", "fix", "none"],
    ["login:/portal/login.html", "veto", "human_handoff"],
  ]);
  const booking = plan[0];
  assert.deepEqual(booking.spot.scores, { friction: 5, value: 5, fit: 5, effort: 1, risk: 2 });
  assert.equal(Math.round(booking.priority), 63);
  assert.ok(booking.spot.signals.some((s) => s.text === "12 fields, 9 required"));
  assert.ok(booking.spot.signals.some((s) => s.text === "3 steps"));
  assert.deepEqual(booking.fixes, ["Add labels to 3 form fields"]);
  assert.ok(plan[1].rules.includes("V2"), "health FAQ: public facts only");
  assert.deepEqual(plan[3].fixes, ["Publish your prices, or price ranges"]);
  assert.deepEqual(plan[4].fixes, ["Add opening hours"]);
  for (const d of plan) assert.equal(d.confidence, "measured", `${d.spot.id} quotes at least two signals`);
});

test("shop: compare helper and quote helper; publish the prices", async () => {
  const { plan } = await scan("shop");
  assert.deepEqual(decisions(plan), [
    ["compare:/catalog.html", "agent", "compare_helper"],
    ["form:/quote.html#form-1", "agent", "inline_form_helper"],
    ["prices", "fix", "none"],
    ["contact:/contact.html", "fine", "none"],
  ]);
  assert.equal(plan[2].spot.pages.length, 9, "catalog plus 8 product pages");
});

test("staff handbooks: build cards, the Q&A and the request form get an agent; the call list is fine", async () => {
  const want = {
    cafe: [["compare:/drinks.html", "agent", "compare_helper"], ["answers:/food-safety.html", "agent", "answer_desk"], ["form:/shift-swap.html#swap", "agent", "inline_form_helper"], ["contact:/contact.html", "fine", "none"]],
    warehouse: [["compare:/codes.html", "agent", "compare_helper"], ["answers:/safety.html", "agent", "answer_desk"], ["form:/damage-report.html#damage", "agent", "inline_form_helper"], ["contact:/contact.html", "fine", "none"]],
  };
  for (const [name, decided] of Object.entries(want)) {
    const { plan } = await scan(name);
    assert.deepEqual(decisions(plan), decided, name);
  }
});

test("call center handbook: the payroll form with Social Security and tax ID numbers is vetoed (V3)", async () => {
  const { plan } = await scan("callcenter");
  assert.deepEqual(decisions(plan), [
    ["compare:/escalation.html", "agent", "compare_helper"],
    ["answers:/call-handling.html", "agent", "answer_desk"],
    ["form:/leave.html#leave", "agent", "inline_form_helper"],
    ["form:/payroll.html#payroll", "veto", "human_handoff"],
    ["contact:/contact.html", "fine", "none"],
  ]);
  const payroll = plan[3];
  assert.ok(payroll.rules.includes("V3"));
  assert.equal(payroll.spot.scores.risk, 5);
});

test("social video app: the agent prepares moderation decisions, the real console stays behind a password, teen consent gets no agent (V4)", async () => {
  const { plan } = await scan("social");
  assert.deepEqual(decisions(plan), [
    ["compare:/rules.html", "agent", "compare_helper"],
    ["answers:/guidelines.html", "agent", "answer_desk"],
    ["form:/moderators/queue.html#decision", "agent", "inline_form_helper"],
    ["form:/report.html#report", "plan_next", "inline_form_helper"],
    ["form:/appeal.html#appeal", "fine", "none"],
    ["form:/teens.html#consent", "veto", "none"],
    ["contact:/contact.html", "fine", "none"],
    ["login:/moderators/console.html", "veto", "human_handoff"],
  ]);
  const teens = plan.find((d) => d.spot.id === "form:/teens.html#consent");
  assert.ok(teens.rules.includes("V4"), "a form on a page for minors gets no agent");
  assert.ok(teens.spot.signals.some((s) => s.id === "minors_words"));
  assert.ok(plan.find((d) => d.spot.id.startsWith("login:")).rules.includes("V3"), "the console that removes clips is behind a password");
  assert.ok(plan.find((d) => d.spot.id === "form:/report.html#report").rules.includes("R3"), "a small site's first plan has at most 3 agent spots");
});

test("clear site: no agent anywhere", async () => {
  const { plan } = await scan("clear");
  assert.ok(plan.length > 0);
  for (const d of plan) assert.equal(d.decision, "fine", d.spot.id);
});

/** Crawls a made-up site held in memory. */
async function scanFiles(files) {
  const origin = "https://mem.test";
  const fetcher = async (url) => {
    const p = new URL(url).pathname;
    return p in files ? { status: 200, contentType: "text/html", text: `<!doctype html><html><body>${files[p]}</body></html>` } : { status: 404, contentType: "", text: "" };
  };
  const crawl = await crawlSite(`${origin}/`, { fetcher, parse });
  return findSpots(crawl);
}

test("answers: one answer desk for the whole site, and long pages with no questions are not one", async () => {
  const words = (n) => `<p>${"lorem ".repeat(n)}</p>`;
  const qs = (n, topic) => Array.from({ length: n }, (_, i) => `<h3>How does ${topic} ${i} work?</h3><p>It works.</p>`).join("");
  const files = {
    "/": `<h1>Home</h1><a href="/guide-a.html">a</a><a href="/guide-b.html">b</a><a href="/help.html">h</a><a href="/blog.html">x</a>${words(50)}`,
    "/guide-a.html": `<h1>Guide A</h1>${words(900)}`,
    "/guide-b.html": `<h1>Guide B</h1>${qs(1, "b")}${words(700)}`,
    "/help.html": `<h1>Help</h1>${qs(6, "help")}`,
    "/blog.html": `<h1>Blog</h1>${qs(3, "blog")}${words(650)}`,
  };
  const { spots } = await scanFiles(files);
  const answers = spots.filter((s) => s.kind === "answers");
  assert.equal(answers.length, 1, "one answer desk, not one per page");
  const desk = answers[0];
  assert.equal(desk.id, "answers:/help.html", "named after the page with the most questions");
  assert.deepEqual(desk.source.pages.map((p) => p.path), ["/help.html", "/blog.html"], "pages with no or one question are left out");
  assert.equal(desk.source.questions, 9, "questions on every page it covers");
  assert.ok(desk.signals.some((s) => s.id === "more_pages"));
});

test("every spot says where it is on the page", async () => {
  for (const name of ["clinic", "shop", "tours"]) {
    const { spots } = await scan(name);
    for (const s of spots) {
      assert.ok(s.target?.path?.startsWith("/"), `${name} ${s.id} has a page`);
      assert.ok(["form", "table", "question", "price", "page"].includes(s.target.find), `${name} ${s.id} has a find kind`);
    }
  }
  const { spots } = await scan("clinic");
  assert.deepEqual(spots.find((s) => s.id === "form:/book.html#booking").target, { path: "/book.html", find: "form", index: 1 });
  assert.deepEqual(spots.find((s) => s.id === "prices").target.find, "price");
});

test("compare: a table of facts with no links or prices is not a choice", async () => {
  const row = (i, link) => `<tr><td>${link ? `<a href="/item-${i}.html">Item ${i}</a>` : `Item ${i}`}</td><td>a</td><td>b</td><td>c</td></tr>`;
  const table = (link) => `<table><tr><th>Name</th><th>A</th><th>B</th><th>C</th></tr>${Array.from({ length: 8 }, (_, i) => row(i, link)).join("")}</table>`;
  const files = {
    "/": '<h1>Home</h1><a href="/privacy.html">p</a><a href="/items.html">i</a>',
    "/privacy.html": `<h1>Privacy</h1>${table(false)}`,
    "/items.html": `<h1>Items</h1>${table(true)}`,
  };
  const { spots } = await scanFiles(files);
  assert.deepEqual(spots.filter((s) => s.kind === "compare").map((s) => s.id), ["compare:/items.html"]);
});
