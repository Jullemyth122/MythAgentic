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
  clinic: ["fill_book_form", "send_book_form", "read_faq", "read_contact"],
  shop: ["list_catalog_options", "fill_quote_form", "send_quote_form", "read_contact"],
  tours: ["list_tours_options", "fill_reserve_form", "send_reserve_form", "read_policies", "read_contact"],
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

      // The assistant is mounted only on the pages with an approved spot.
      for (const page of pack.mounted) {
        const html = await readFile(path.join(out, page.replace(/^\//, "")), "utf8");
        assert.match(html, /<script type="module" src="(\.\.\/)*site\.js"><\/script>/);
        assert.match(html, /id="agent-app"/);
      }
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
}

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
    assert.deepEqual(pack.tools, ["read_faq", "read_contact"]);
    assert.deepEqual(pack.mounted, ["/faq.html"]);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
