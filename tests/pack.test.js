import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crawlSite } from "../src/scanner/crawl.js";
import { folderFetcher, parse } from "../src/scanner/node.js";
import { findSpots, siteNameOf } from "../src/spots.js";
import { decidePlan } from "../src/score.js";
import { buildPack } from "../src/pack/build.js";
import { checkSchema } from "../vendor/agentify-website/runtime/actions.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function planFor(name) {
  const origin = `https://${name}.test`;
  const crawl = await crawlSite(`${origin}/`, { fetcher: folderFetcher(path.join(root, "test-sites", name), origin), parse });
  const { size, spots } = findSpots(crawl);
  return { siteName: siteNameOf(crawl), plan: decidePlan(spots, { size }) };
}

const expected = {
  clinic: ["fill_book_form", "send_book_form", "read_faq", "read_contact", "search_site", "site_map", "go_to_page", "show_on_page", "guide_on_page", "highlight_table"],
  shop: ["list_catalog_options", "fill_quote_form", "send_quote_form", "read_contact", "search_site", "site_map", "go_to_page", "show_on_page", "guide_on_page", "highlight_table"],
  cafe: ["list_drinks_options", "read_food_safety", "fill_shift_swap_form", "send_shift_swap_form", "read_contact", "search_site", "site_map", "go_to_page", "show_on_page", "guide_on_page", "highlight_table"],
  warehouse: ["list_codes_options", "read_safety", "fill_damage_report_form", "send_damage_report_form", "read_contact", "search_site", "site_map", "go_to_page", "show_on_page", "guide_on_page", "highlight_table"],
  callcenter: ["list_escalation_options", "read_call_handling", "fill_leave_form", "send_leave_form", "read_contact", "search_site", "site_map", "go_to_page", "show_on_page", "guide_on_page", "highlight_table"],
  social: ["list_rules_options", "read_guidelines", "fill_queue_form", "send_queue_form", "read_contact", "search_site", "site_map", "go_to_page", "show_on_page", "guide_on_page", "highlight_table"],
  tours: ["list_tours_options", "fill_reserve_form", "send_reserve_form", "read_policies", "read_contact", "search_site", "site_map", "go_to_page", "show_on_page", "guide_on_page", "highlight_table"],
};

for (const [name, tools] of Object.entries(expected)) {
  test(`${name}: the agent pack passes build_network.mjs --check, and the runtime accepts every action`, async () => {
    const out = await mkdtemp(path.join(os.tmpdir(), `mythagentic-${name}-`));
    try {
      const { siteName, plan } = await planFor(name);
      const pack = await buildPack({ siteName, plan, siteDir: path.join(root, "test-sites", name), outDir: out });
      assert.equal(pack.ok, true, pack.check);
      assert.deepEqual([...pack.tools].sort(), [...tools].sort());
      assert.doesNotMatch(await readFile(path.join(out, "site.js"), "utf8"), /TODO/);

      // Register the actions the way the browser runtime does, with its own schema check.
      const { PackActions } = await import(pathToFileURL(path.join(out, "site-actions.js")).href);
      PackActions.usePlacement(JSON.parse(await readFile(path.join(out, "placement.json"), "utf8")));
      const registered = [];
      await PackActions.registerActions({
        register(def) {
          checkSchema(def.inputSchema);
          assert.ok(["read", "write", "irreversible"].includes(def.effect));
          registered.push(def.name);
        },
      });
      assert.deepEqual(registered.sort(), [...tools].sort());

      // One side panel on every page; an Ask bar only at the parts of the page with an approved spot.
      const file = (p) => path.join(out, p.replace(/^\//, "").replace(/(^|\/)$/, "$1index.html"));
      for (const page of pack.mounted) {
        const html = await readFile(file(page), "utf8");
        assert.match(html, /<script(?=[^>]*type="module")(?=[^>]*src="(\.\.\/)*site\.js")[^>]*><\/script>/);
        assert.match(html, /<script(?=[^>]*type="module")(?=[^>]*src="(\.\.\/)*assistant-dock\.js")[^>]*><\/script>/);
        assert.match(html, /id="agent-app"/);
        assert.match(html, /data-agent-spot="/);
      }
      const index = await readFile(file("/"), "utf8");
      assert.match(index, /id="agent-app"/, "the launcher is on every page");
      if (!pack.mounted.includes("/")) assert.doesNotMatch(index, /data-agent-spot=/, "no Ask bar where there is no spot");
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
}

test("the owner's approved words reach the pack as text only, and change no decision", async () => {
  const { cleanTuning } = await import("../src/pack/build.js");
  const out = await mkdtemp(path.join(os.tmpdir(), "mythagentic-tuning-"));
  try {
    const { siteName, plan } = await planFor("tours");
    const tuning = {
      greeting: "Mabuhay! Ask me about our island tours.\u0000",
      rules: ["Answer in Tagalog when the visitor writes in Tagalog.", "", "x".repeat(500)],
      askBars: {
        "answers:/policies.html": { title: "Before you book", sub: "Weather, kids, lunch", questions: ["Can children join?", "What if it rains?", "a", "b", "c"] },
        "not-a-spot": { title: "ignored" },
      },
    };
    const clean = cleanTuning(tuning, [{ id: "answers:/policies.html" }]);
    assert.equal(clean.greeting, "Mabuhay! Ask me about our island tours.");
    assert.equal(clean.rules.length, 2);
    assert.equal(clean.rules[1].length, 200);
    assert.deepEqual(Object.keys(clean.askBars), ["answers:/policies.html"]);
    assert.equal(clean.askBars["answers:/policies.html"].questions.length, 4);
    assert.equal(cleanTuning({ greeting: " " }, []), null);

    const pack = await buildPack({ siteName, plan, siteDir: path.join(root, "test-sites", "tours"), tuning, outDir: out });
    assert.equal(pack.ok, true, pack.check);
    assert.equal(pack.tuned, true);
    assert.deepEqual([...pack.tools].sort(), [...expected.tours].sort(), "the same tools: words change no decision");
    assert.match(await readFile(path.join(out, "site.js"), "utf8"), /static GREETING = "Mabuhay! Ask me about our island tours\.";/);
    assert.match(await readFile(path.join(out, `${pack.network}.hocon`), "utf8"), /site owner's own notes[\s\S]*Answer in Tagalog/);
    const placement = JSON.parse(await readFile(path.join(out, "placement.json"), "utf8"));
    assert.equal(placement.spots.find((s) => s.id === "answers:/policies.html").ask.title, "Before you book");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("clear site: nothing to build", async () => {
  const { siteName, plan } = await planFor("clear");
  await assert.rejects(buildPack({ siteName, plan, outDir: path.join(os.tmpdir(), "mythagentic-clear") }), { code: "NOTHING_TO_BUILD" });
});

test("only the spots the owner approved are built", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "mythagentic-approved-"));
  try {
    const { siteName, plan } = await planFor("clinic");
    const pack = await buildPack({ siteName, plan, approved: ["answers:/faq.html"], siteDir: path.join(root, "test-sites", "clinic"), outDir: out });
    assert.equal(pack.ok, true, pack.check);
    assert.deepEqual(pack.tools, ["read_faq", "read_contact", "search_site", "site_map", "go_to_page", "show_on_page", "guide_on_page", "highlight_table"]);
    assert.deepEqual(pack.mounted, ["/faq.html"]);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("companion: a site we only have the public pages of gets a snapshot assistant that passes --check", async () => {
  const { snapshotFor } = await import("../src/pack/snapshot.js");
  const { collectionFor, placementFor } = await import("../src/pack/build.js");
  const out = await mkdtemp(path.join(os.tmpdir(), "mythagentic-companion-"));
  try {
    const origin = "https://tours.test";
    const fetcher = folderFetcher(path.join(root, "test-sites", "tours"), origin);
    const htmls = new Map();
    const crawl = await crawlSite(`${origin}/`, { fetcher: async (url) => { const r = await fetcher(url); htmls.set(url, r.text); return r; }, parse });
    const { size, spots } = findSpots(crawl);
    const plan = decidePlan(spots, { size });
    const compare = placementFor(plan).spots.find((s) => s.kind === "compare");
    const snapshot = snapshotFor({
      source: `${origin}/`, fetchedAt: "2026-11-27", parse,
      pages: crawl.pages.map((p) => ({ url: p.url, title: p.title, html: htmls.get(p.url) })),
      tables: [{ collection: collectionFor(compare), url: new URL(compare.path, origin).href, tableIndex: 0 }],
    });
    assert.ok(snapshot.pages.length >= 8);
    assert.equal(snapshot.records[collectionFor(compare)].length, 6, "one record per tour");
    assert.ok(snapshot.records[collectionFor(compare)][0].url.startsWith(`${origin}/tours/`), "each record links to its tour page");

    const pack = await buildPack({ siteName: siteNameOf(crawl), plan, snapshot, outDir: out });
    assert.equal(pack.ok, true, pack.check);
    assert.equal(pack.companion, true);
    assert.deepEqual(pack.tools, ["search_site_content", "get_site_records"]);
    assert.deepEqual(pack.mounted, ["/"]);
    const index = await readFile(path.join(out, "index.html"), "utf8");
    assert.match(index, /id="agent-app"/);
    assert.doesNotMatch(index + await readFile(path.join(out, "site.js"), "utf8"), /TODO/);
    const manifest = JSON.parse(await readFile(path.join(out, "agent-manifest.json"), "utf8"));
    assert.equal(manifest.actions.module, "./content-actions.js");
    const net = await readFile(path.join(out, `${pack.network}.hocon`), "utf8");
    assert.match(net, /cannot fill or send it from here/);
    assert.match(net, /snapshot of https:\/\/tours\.test\/ taken on 2026-11-27/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
