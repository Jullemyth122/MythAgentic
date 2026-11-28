// Makes a preview copy of a live site's scanned pages, so the owner can see their own site
// with the assistant placed on it before changing anything.
//
// The copy keeps the page's HTML and styles (loaded from the real site), drops the page's
// own scripts, points links between scanned pages at the copy, and turns every form into a
// preview form that sends nothing. Node only (uses the linkedom parser).

import { mainOf } from "../scanner/page.js";
import { findTarget, REVEAL_CSS, revealStatic } from "../view.js";

/**
 * The file a site path is written to: "/" → index.html, "/docs" → docs/index.html,
 * "/faq.html" → faq.html.
 * @param {string} p
 */
export function fileFor(p) {
  const clean = decodeURIComponent(p).replace(/^\/+/, "");
  if (clean === "" || clean.endsWith("/")) return `${clean}index.html`;
  return /\.[a-z0-9]{2,5}$/i.test(clean) ? clean : `${clean}/index.html`;
}

/** The relative URL from one written file to another. */
function relativeUrl(fromFile, toFile) {
  const from = fromFile.split("/").slice(0, -1);
  const to = toFile.split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i += 1;
  const up = "../".repeat(from.length - i);
  const rest = to.slice(i).join("/").replace(/(^|\/)index\.html$/, "$1");
  return `${up}${rest}` || "./";
}

const URL_IN_CSS = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/**
 * One page of the preview copy.
 *
 * @param {string} html  the page as scanned
 * @param {object} options
 * @param {string} options.pageUrl  the page's real URL
 * @param {Set<string>} options.pagePaths  paths of every scanned page (these link to the copy)
 * @param {(html:string)=>Document} options.parse
 * @returns {Document}
 */
export function mirrorPage(html, { pageUrl, pagePaths, parse }) {
  const doc = parse(html);
  const origin = new URL(pageUrl).origin;
  const here = fileFor(new URL(pageUrl).pathname);
  const abs = (value) => {
    try { return new URL(value, pageUrl).href; } catch { return value; }
  };

  for (const el of doc.querySelectorAll("script, noscript, iframe, object, embed, base, meta[http-equiv], link[rel=preload][as=script], link[rel=modulepreload], link[rel=manifest]")) el.remove();
  for (const el of doc.querySelectorAll("*")) {
    for (const name of el.getAttributeNames()) {
      if (/^on/i.test(name)) el.removeAttribute(name);
    }
    for (const name of ["src", "poster", "data-src"]) {
      if (el.hasAttribute(name)) el.setAttribute(name, abs(el.getAttribute(name)));
    }
    for (const name of ["srcset", "data-srcset"]) {
      if (el.hasAttribute(name)) {
        el.setAttribute(name, el.getAttribute(name).split(",").map((part) => {
          const [u, ...rest] = part.trim().split(/\s+/);
          return [abs(u), ...rest].join(" ");
        }).join(", "));
      }
    }
    if (el.hasAttribute("style")) el.setAttribute("style", el.getAttribute("style").replace(URL_IN_CSS, (m, q, u) => `url(${q}${abs(u)}${q})`));
    if (el.hasAttribute("href")) {
      const raw = el.getAttribute("href");
      if (/^(#|mailto:|tel:|javascript:)/i.test(raw)) {
        if (/^javascript:/i.test(raw)) el.setAttribute("href", "#");
        continue;
      }
      let target;
      try { target = new URL(raw, pageUrl); } catch { continue; }
      if (el.tagName === "A" && target.origin === origin && pagePaths.has(target.pathname)) {
        el.setAttribute("href", `${relativeUrl(here, fileFor(target.pathname))}${target.hash}`);
      } else {
        el.setAttribute("href", target.href);
      }
    }
  }
  for (const style of doc.querySelectorAll("style")) {
    style.textContent = style.textContent.replace(URL_IN_CSS, (m, q, u) => `url(${q}${abs(u)}${q})`);
  }
  // Forms in the copy never reach the real site: no action, and mirror-page.js stops them.
  for (const form of doc.querySelectorAll("form")) {
    form.setAttribute("action", "#");
    form.setAttribute("data-preview-form", "");
  }
  // Sections a script would reveal on scroll stay hidden without it: show them.
  revealStatic(doc);
  const reveal = doc.createElement("style");
  reveal.setAttribute("data-mythagentic", "reveal");
  reveal.textContent = REVEAL_CSS;
  (doc.head ?? doc.documentElement).append(reveal);
  return doc;
}

/**
 * Where the assistant goes on a page: right after the spot's form or table, so it sits
 * where the visitor needs it; for answers and other spots, at the end of the main content.
 *
 * @param {Document} doc
 * @param {{kind:string, formIndex?:number, tableIndex?:number}|undefined} spot
 * @returns {{after?:Element, inside:Element}}
 */
export function placeFor(doc, spot) {
  const main = mainOf(doc);
  let el = null;
  if (spot?.kind === "form") el = findTarget(doc, { find: "form", index: spot.formIndex });
  if (spot?.kind === "compare") el = findTarget(doc, { find: "table", index: spot.tableIndex });
  if (!el) return { inside: main };
  // Step out of plain wrappers (a scroll box around a table, a card around a form), so the
  // assistant sits beside the element, not squeezed inside its frame.
  while (el.parentElement && el.parentElement !== main && el.parentElement.children.length === 1) el = el.parentElement;
  return { after: el, inside: main };
}
