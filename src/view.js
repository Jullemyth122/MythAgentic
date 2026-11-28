// Shows a scanned page as it was read, with the spot's part of the page outlined.
//
// The page's own scripts are removed and the response is served with a CSP sandbox, so a
// scanned site cannot run code on this server's origin. Styles and images still load from
// the real site through <base href>, so the snapshot looks like the page.

import { mainOf } from "./scanner/page.js";

/** The id the outlined element gets, so the iframe URL can scroll to it with #ma-target. */
export const TARGET_ID = "ma-target";

const PRICE_ON_REQUEST = /price on request|prices? (available )?(up)?on request|call for (a )?price|for prices,? please (call|contact|message)/i;

/**
 * Many sites hide sections until a script reveals them on scroll ("reveal on scroll" or
 * entrance animations): `[data-reveal] { opacity: 0 }` plus a script that adds a class, or
 * an animation library's start state written inline (`style="opacity:0; transform:…"`).
 * A copy with its scripts removed would stay blank there, so these rules show them.
 */
export const REVEAL_CSS = `[data-reveal], [data-aos], [data-animate], [data-animation], [data-scroll], [data-sal],
[data-motion], [data-inview], .reveal, .reveal-on-scroll, .js-reveal, .fade-in, .fade-up, .fade-in-up,
.animate-on-scroll, .wow, .aos-init, .scroll-reveal, .will-animate, .appear {
  opacity: 1 !important; visibility: visible !important; transform: none !important; animation: none !important;
}`;

/**
 * Remove an animation's inline start state (opacity 0, with or without a transform), so
 * the element shows without the script that would have animated it in.
 * @param {Document} doc
 */
export function revealStatic(doc) {
  for (const el of doc.querySelectorAll("[style]")) {
    const style = el.getAttribute("style");
    if (!/(^|;)\s*opacity\s*:\s*0(\.0+)?\s*(;|$)/i.test(style)) continue;
    const kept = style.split(";").filter((d) => !/^\s*(opacity|transform|visibility)\s*:/i.test(d)).join(";");
    el.setAttribute("style", kept);
  }
}

/** Headers for a snapshot response: no scripts, no plugins, no frames, opaque origin. */
export const VIEW_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "sandbox; script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

/**
 * The element a spot is about.
 * @param {Document} doc
 * @param {{find:string, index:number}} target  form numbers start at 1 (as in measurePage); tables at 0
 */
export function findTarget(doc, target) {
  if (!target) return null;
  if (target.find === "form") return doc.querySelectorAll("form")[target.index - 1] ?? null;
  // Tables and questions are counted inside <main>, as measurePage counts them; forms in the whole page.
  if (target.find === "table") return mainOf(doc).querySelectorAll("table")[target.index] ?? null;
  if (target.find === "question") {
    return [...mainOf(doc).querySelectorAll("h1, h2, h3, h4, summary")].find((h) => h.textContent.trim().endsWith("?")) ?? null;
  }
  if (target.find === "price") {
    // The smallest element whose own text says "price on request".
    let best = null;
    for (const el of doc.querySelectorAll("body *")) {
      if (["SCRIPT", "STYLE", "TEMPLATE"].includes(el.tagName)) continue;
      if (PRICE_ON_REQUEST.test(el.textContent) && (!best || best.contains(el))) best = el;
    }
    return best;
  }
  return null;
}

/**
 * The page HTML with scripts removed, links resolving to the real site, and the target
 * outlined and dimmed around.
 *
 * @param {string} html  the page as fetched
 * @param {{base:string, target?:{find:string, index:number}, parse:(html:string)=>Document}} options
 * @returns {{html:string, found:boolean}}
 */
export function viewHtml(html, { base, target, parse }) {
  const doc = parse(html);
  for (const el of doc.querySelectorAll("script, noscript, iframe, object, embed, meta[http-equiv], base, link[rel=preload][as=script], link[rel=modulepreload]")) el.remove();
  for (const el of doc.querySelectorAll("*")) {
    for (const name of el.getAttributeNames()) if (/^on/i.test(name)) el.removeAttribute(name);
  }
  const head = doc.head ?? doc.documentElement;
  const baseEl = doc.createElement("base");
  baseEl.setAttribute("href", base);
  head.prepend(baseEl);

  const el = findTarget(doc, target);
  if (el) {
    // A separate anchor to scroll to, so the element keeps its own id (and its styles).
    el.setAttribute("data-ma-target", "");
    const anchor = doc.createElement("span");
    anchor.setAttribute("id", TARGET_ID);
    anchor.setAttribute("style", "display:block;height:0;scroll-margin-top:90px");
    el.before(anchor);
  }
  const style = doc.createElement("style");
  revealStatic(doc);
  style.textContent = `${REVEAL_CSS}
    html { scroll-behavior: auto !important; }
    [data-ma-target] {
      outline: 3px solid #e0365e !important; outline-offset: 6px !important;
      box-shadow: 0 0 0 100vmax rgba(9, 9, 11, .32) !important;
      position: relative !important; z-index: 2147483000 !important;
      scroll-margin-top: 90px !important; border-radius: 4px;
    }`;
  head.append(style);
  return { html: `<!doctype html>\n${doc.documentElement.outerHTML}`, found: !!el };
}
