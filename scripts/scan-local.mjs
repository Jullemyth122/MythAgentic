// Scans a site and prints its placement map as a table.
//
//   node scripts/scan-local.mjs clinic|shop|clear      a test site, read from disk
//   node scripts/scan-local.mjs https://example.com    a real site you own or may scan
//   add --json for the full result

import path from "node:path";
import { fileURLToPath } from "node:url";
import { crawlSite } from "../src/scanner/crawl.js";
import { folderFetcher, httpFetcher, parse } from "../src/scanner/node.js";
import { findSpots } from "../src/spots.js";
import { decidePlan } from "../src/score.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
const asJson = process.argv.includes("--json");
if (!target) {
  console.error("Usage: node scripts/scan-local.mjs <clinic|shop|clear|URL> [--json]");
  process.exit(2);
}

const isUrl = /^https?:\/\//.test(target);
const origin = isUrl ? new URL(target).origin : `https://${target}.test`;
const fetcher = isUrl ? httpFetcher() : folderFetcher(path.join(here, "..", "test-sites", target), origin);
const crawl = await crawlSite(isUrl ? target : `${origin}/`, { fetcher, parse });
const { size, groups, spots } = findSpots(crawl);
const plan = decidePlan(spots, { size });

if (asJson) {
  console.log(JSON.stringify({ crawl: { ...crawl, pages: crawl.pages.map(({ hash, ...p }) => ({ ...p, hash: hash.toString(16) })) }, groups, plan }, null, 2));
} else {
  console.log(`${crawl.origin}: ${crawl.pages.length} pages, ${groups.length} groups, ${size} site`);
  for (const s of crawl.skipped) console.log(`  skipped ${s.url}: ${s.reason}`);
  console.table(plan.map((d) => ({
    spot: d.spot.label,
    "F·V·Fi·E·R": ["friction", "value", "fit", "effort", "risk"].map((k) => d.spot.scores[k]).join("·"),
    priority: Math.round(d.priority),
    decision: d.decision,
    placement: d.placement,
    rules: d.rules.join(" "),
  })));
}
