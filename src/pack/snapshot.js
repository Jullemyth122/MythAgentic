// Builds site-content.json for a companion assistant (the agentify-website skill's live
// URL mode): the main text of each public page, plus each compare table as records.

import { mainOf, textOf } from "../scanner/page.js";

/** Most characters of text kept for one page. */
const MAX_TEXT = 12_000;

/** @param {string} s */
const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

/**
 * The page's main content as plain text, without navigation, header, footer or forms.
 * @param {Document} doc
 */
export function mainText(doc) {
  const main = mainOf(doc);
  for (const el of main.querySelectorAll("nav, header, footer, aside, form, script, style, noscript, template, svg")) el.remove();
  return textOf(main).slice(0, MAX_TEXT);
}

/**
 * One record per table row, keyed by the header cells, with the row's link when it has one.
 * @param {Document} doc
 * @param {number} tableIndex
 * @param {string} pageUrl
 */
export function tableRecords(doc, tableIndex, pageUrl) {
  const table = mainOf(doc).querySelectorAll("table")[tableIndex];
  if (!table) return [];
  const rows = [...table.querySelectorAll("tr")];
  const head = rows.find((r) => r.querySelector("th")) ?? rows[0];
  if (!head) return [];
  const names = [...head.querySelectorAll("th, td")].map((c, i) => key(textOf(c)) || `column_${i + 1}`);
  const records = [];
  const ids = new Set();
  for (const row of rows) {
    if (row === head) continue;
    const cells = [...row.querySelectorAll("th, td")];
    if (cells.length === 0) continue;
    const record = {};
    cells.forEach((c, i) => { record[names[i] ?? `column_${i + 1}`] = textOf(c); });
    let id = key(textOf(cells[0])) || `row_${records.length + 1}`;
    for (let n = 2; ids.has(id); n += 1) id = `${key(textOf(cells[0]))}_${n}`;
    ids.add(id);
    const link = row.querySelector("a[href]");
    let url = pageUrl;
    if (link) {
      try { url = new URL(link.getAttribute("href"), pageUrl).href; } catch { /* keep the page */ }
    }
    records.push({ id, ...record, url });
  }
  return records;
}

/**
 * site-content.json for a companion assistant.
 *
 * @param {object} options
 * @param {string} options.source  the site's home URL
 * @param {string} options.fetchedAt  YYYY-MM-DD
 * @param {Array<{url:string, title:string, html:string}>} options.pages
 * @param {Array<{collection:string, url:string, tableIndex:number}>} [options.tables]
 * @param {(html:string)=>Document} options.parse
 */
export function snapshotFor({ source, fetchedAt, pages, tables = [], parse }) {
  const out = { source, fetchedAt, pages: [], records: {} };
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  for (const p of pages) {
    const text = mainText(parse(p.html));
    if (text) out.pages.push({ url: p.url, title: p.title, text });
  }
  for (const t of tables) {
    const page = byUrl.get(t.url);
    if (!page) continue;
    const records = tableRecords(parse(page.html), t.tableIndex, t.url);
    if (records.length) out.records[t.collection] = records;
  }
  return out;
}
