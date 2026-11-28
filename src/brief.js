// What the "Improve with AI" helper reads about a site: the real words of each spot, taken
// from the pages the scanner already fetched. Questions with the start of their answers,
// form fields, table columns and rows, and the home page's opening text.
//
// It is plain text for a model to read. Nothing here changes a score or a decision.

import { mainOf, textOf } from "./scanner/page.js";

const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Question headings on a page, each with the start of its answer.
 * @param {Document} doc
 * @param {number} max
 */
function questionsOf(doc, max) {
  const out = [];
  const heads = [...mainOf(doc).querySelectorAll("h1, h2, h3, h4, summary")];
  for (const h of heads) {
    const q = textOf(h);
    if (!q.endsWith("?")) continue;
    // The answer: text after the heading up to the next heading (or the rest of its <details>).
    let answer = "";
    if (h.tagName === "SUMMARY") {
      answer = textOf(h.parentElement).slice(q.length);
    } else {
      for (let n = h.nextElementSibling; n && !/^H[1-4]$/.test(n.tagName) && answer.length < 500; n = n.nextElementSibling) answer += ` ${textOf(n)}`;
    }
    out.push({ q: cut(q, 140), a: cut(answer.trim(), 320) });
    if (out.length >= max) break;
  }
  return out;
}

const BLOCKS = "h1, h2, h3, h4, h5, p, li, summary, dt, dd, th, td, button, label, figcaption, blockquote, option";

/**
 * A page's words in reading order, one block per line, headings marked with "#".
 * Buttons and options are kept: on many sites they carry real content (prompt ideas,
 * occasions, plans).
 * @param {Document} doc
 * @param {number} max  most characters
 */
export function pageText(doc, max = 8000) {
  let root = mainOf(doc);
  if (textOf(root).length < 200 && doc.body) root = doc.body;
  const lines = [];
  let size = 0;
  for (const el of root.querySelectorAll(BLOCKS)) {
    // A block inside another block (a <p> in an <li>) is already in its parent's text.
    if (el.parentElement?.closest(BLOCKS) && root.contains(el.parentElement.closest(BLOCKS))) continue;
    if (el.closest("nav, footer, script, style, template, [hidden], [aria-hidden=true]")) continue;
    const t = textOf(el);
    if (!t || t === lines.at(-1)?.replace(/^#+ /, "")) continue;
    const line = /^H[1-5]$/.test(el.tagName) ? `${"#".repeat(Number(el.tagName[1]))} ${t}` : t;
    lines.push(line);
    size += line.length + 1;
    if (size >= max) break;
  }
  return cut(lines.join("\n"), max);
}

/**
 * A short brief per spot, plus the home page's opening.
 *
 * @param {object} options
 * @param {Array<object>} options.spots  findSpots() spots
 * @param {Array<object>} options.pages  crawl pages ({path, url, title})
 * @param {Map<string,string>} options.htmls  page URL → HTML as fetched
 * @param {(html:string)=>Document} options.parse
 */
export function briefFor({ spots, pages, htmls, parse }) {
  const docs = new Map();
  const doc = (p) => {
    if (!docs.has(p)) {
      const page = pages.find((x) => x.path === p);
      const html = page && htmls.get(page.url);
      docs.set(p, html ? parse(html) : null);
    }
    return docs.get(p);
  };

  const homeDoc = doc("/") ?? doc(pages[0]?.path);
  const home = homeDoc
    ? { title: textOf(homeDoc.querySelector("title")), h1: textOf(homeDoc.querySelector("h1")), opening: cut(textOf(mainOf(homeDoc)), 600) }
    : null;

  // Every page's words, so the helper knows the whole site, not only the scored parts.
  const site = [];
  let total = 0;
  for (const p of pages) {
    const d = doc(p.path);
    if (!d) continue;
    const text = pageText(d, 8000);
    if (!text) continue;
    site.push({ path: p.path, title: textOf(d.querySelector("title")) || p.title || "", text });
    total += text.length;
    if (total > 150_000) break;
  }

  const out = {};
  for (const spot of spots) {
    const src = spot.source ?? {};
    if (spot.kind === "answers") {
      const questions = [];
      for (const p of (src.pages ?? [{ path: src.path }]).slice(0, 10)) {
        const d = doc(p.path);
        if (!d) continue;
        for (const item of questionsOf(d, 40 - questions.length)) questions.push({ page: p.path, ...item });
        if (questions.length >= 40) break;
      }
      out[spot.id] = { kind: "answers", questions };
    } else if (spot.kind === "form" && src.fields) {
      out[spot.id] = {
        kind: "form", page: src.path, submit: src.submitText ?? "",
        fields: src.fields.slice(0, 20).map((f) => ({ label: f.label || f.placeholder || f.name, type: f.type, required: !!f.required, choices: (f.choices ?? []).slice(0, 8) })),
      };
    } else if (spot.kind === "compare") {
      const d = doc(src.path);
      const table = d && mainOf(d).querySelectorAll("table")[src.tableIndex];
      if (!table) continue;
      const rows = [...table.querySelectorAll("tr")].map((r) => [...r.querySelectorAll("th, td")].map((c) => cut(textOf(c), 60)));
      out[spot.id] = { kind: "compare", page: src.path, columns: rows[0] ?? [], rows: rows.slice(1, 9), totalRows: Math.max(0, rows.length - 1) };
    }
  }
  return { home, spots: out, site };
}
