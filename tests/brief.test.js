import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crawlSite } from "../src/scanner/crawl.js";
import { folderFetcher, parse } from "../src/scanner/node.js";
import { findSpots } from "../src/spots.js";
import { briefFor } from "../src/brief.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("briefFor: the real questions with their answers, form fields and table rows of each spot", async () => {
  const origin = "https://tours.test";
  const fetcher = folderFetcher(path.join(root, "test-sites", "tours"), origin);
  const htmls = new Map();
  const crawl = await crawlSite(`${origin}/`, { fetcher: async (url) => { const r = await fetcher(url); htmls.set(url, r.text); return r; }, parse });
  const { spots } = findSpots(crawl);
  const brief = briefFor({ spots, pages: crawl.pages, htmls, parse });

  assert.match(brief.home.h1, /\S/);
  const answers = brief.spots["answers:/policies.html"];
  assert.ok(answers.questions.length >= 8);
  const cancel = answers.questions.find((q) => /cancellation/i.test(q.q));
  assert.match(cancel.a, /24 hours/, "each question carries the start of its answer");

  const form = Object.values(brief.spots).find((b) => b.kind === "form");
  assert.ok(form.fields.length > 3);
  assert.ok(form.fields.every((f) => f.label));
  // The whole site, page by page, so the helper knows more than the scored parts.
  assert.equal(brief.site.length, crawl.pages.length);
  const reserve = brief.site.find((p) => p.path === "/reserve.html");
  assert.match(reserve.text, /^# Reserve a tour/m);
  assert.match(reserve.text, /Pay in cash at the pier/);

  const table = Object.values(brief.spots).find((b) => b.kind === "compare");
  assert.equal(table.totalRows, 6);
  assert.ok(table.columns.length >= 3);
});
