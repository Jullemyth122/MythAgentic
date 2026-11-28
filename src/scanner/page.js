// Measures one page. Everything here is plain DOM code: no LLM, no guessing.
// It works on any standard Document (linkedom in Node, DOMParser in the browser).

import { simhash, tagPaths } from "./simhash.js";

const PRICE_ON_REQUEST = /\b(price on request|prices? (available )?upon request|call (us )?for (a )?price|ask (us )?for (a )?price|contact us for pricing|request (a )?price|for (prices|pricing),? (please )?(call|contact|message) (us|the \w+))\b/gi;
const CALL_TO_BOOK = /\b(call (us )?to (book|order|reserve|schedule)|book by phone|call us to book)\b/i;
const PRICE_SHOWN = /(₱|PHP\s?|\$|€|£|USD\s?)\s?\d[\d,]*(\.\d+)?/g;
const HOURS = /\b(opening hours|open (daily|every day|from|monday|mon)|business hours|store hours|clinic hours|hours:)\b|\b\d{1,2}(:\d{2})?\s?(am|pm)\s?(to|-|–)\s?\d{1,2}(:\d{2})?\s?(am|pm)\b/i;
const HEALTH = /\b(medical|dental records?|x-rays?|treatment plans?|diagnos\w*|prescriptions?|lab results?|patients?|health records?)\b/i;
const MINORS = /\b(for kids|children's|for children|students under|minors?|parental consent)\b/i;
const ID_FIELD = /(ssn|social.?security|tin\b|passport|national.?id|drivers?.?licen[cs]e|sss|philhealth|umid|\bid.?number)/i;
const CARD_FIELD = /(card.?number|cc.?num|credit.?card|cvv|cvc|card.?expir)/i;
const PAY_WORDS = /\b(pay now|place order|checkout|pay with|complete purchase|buy now)\b/i;

/** Elements whose text is never page content. */
const NO_TEXT = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

/**
 * Text of a node with whitespace squeezed. Unlike textContent, it puts a space between
 * elements, so table cells such as "Price" and "Price on request" stay separate words.
 * @param {Node|null|undefined} node
 */
export function textOf(node) {
  if (!node) return "";
  const parts = [];
  const walk = (n) => {
    if (n.nodeType === 3) parts.push(n.data);
    else if (n.nodeType === 1 && !NO_TEXT.has(n.tagName)) for (const c of n.childNodes) walk(c);
    else if (n.nodeType === 9 || n.nodeType === 11) for (const c of n.childNodes) walk(c);
    if (n.nodeType === 1) parts.push(" ");
  };
  walk(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/**
 * The main content element: <main>, else [role=main], else <body>.
 * @param {Document} doc
 */
export function mainOf(doc) {
  return doc.querySelector("main") ?? doc.querySelector("[role=main]") ?? doc.body ?? doc.documentElement;
}

/**
 * The visible label for a form control, or "" when it has none.
 * A placeholder alone does not count as a label.
 * @param {Document} doc
 * @param {Element} el
 */
function labelFor(doc, el) {
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => textOf(doc.getElementById(id))).join(" ").trim();
    if (text) return text;
  }
  const id = el.getAttribute("id");
  if (id) {
    for (const label of doc.querySelectorAll("label[for]")) {
      if (label.getAttribute("for") === id && textOf(label)) return textOf(label);
    }
  }
  const wrapping = el.closest("label");
  if (wrapping && textOf(wrapping)) return textOf(wrapping);
  const fieldset = el.closest("fieldset");
  if ((el.getAttribute("type") === "radio" || el.getAttribute("type") === "checkbox") && fieldset) {
    // A radio group inside its own fieldset is labelled by its legend.
    const legend = fieldset.querySelector("legend");
    const controls = fieldset.querySelectorAll("input, select, textarea");
    if (legend && [...controls].every((c) => c.getAttribute("name") === el.getAttribute("name"))) return textOf(legend);
  }
  return "";
}

/**
 * Measures one form. Radio buttons and checkboxes with one name count as one field.
 * @param {Document} doc
 * @param {Element} form
 */
export function measureForm(doc, form) {
  const fields = [];
  const groups = new Map();
  for (const el of form.querySelectorAll("input, select, textarea")) {
    const tag = el.tagName.toLowerCase();
    const type = tag === "input" ? (el.getAttribute("type") ?? "text").toLowerCase() : tag;
    if (["hidden", "submit", "button", "reset", "image"].includes(type)) continue;
    const name = el.getAttribute("name") ?? el.getAttribute("id") ?? "";
    const label = labelFor(doc, el);
    const required = el.hasAttribute("required") || el.getAttribute("aria-required") === "true";
    const choices = tag === "select"
      ? [...el.querySelectorAll("option")].filter((o) => o.getAttribute("value") !== "").map((o) => o.getAttribute("value") ?? textOf(o))
      : [];
    const options = choices.length;
    if ((type === "radio" || type === "checkbox") && name) {
      const existing = groups.get(name);
      if (existing) {
        existing.required ||= required;
        existing.options += 1;
        existing.choices.push(el.getAttribute("value") ?? "on");
        if (!existing.label && label) existing.label = label;
        continue;
      }
      const field = { name, type, label, required, options: 1, choices: [el.getAttribute("value") ?? "on"] };
      groups.set(name, field);
      fields.push(field);
      continue;
    }
    fields.push({ name, type, label, required, options, choices: choices.slice(0, 60), placeholder: el.getAttribute("placeholder") ?? "" });
  }

  const legends = [...form.querySelectorAll("legend, h2, h3")].map(textOf);
  const stepOf = legends.map((t) => t.match(/\bstep\s+\d+\s+of\s+(\d+)\b/i)).find(Boolean);
  const dataSteps = new Set([...form.querySelectorAll("[data-step]")].map((el) => el.getAttribute("data-step"))).size;
  const steps = Math.max(1, stepOf ? Number(stepOf[1]) : 0, dataSteps);

  const submit = form.querySelector("button[type=submit], button:not([type]), input[type=submit]");
  const submitText = submit ? (textOf(submit) || submit.getAttribute("value") || "") : "";
  const all = fields.map((f) => `${f.name} ${f.label}`).join(" ");

  return {
    id: form.getAttribute("id") ?? "",
    action: form.getAttribute("action") ?? "",
    method: (form.getAttribute("method") ?? "get").toLowerCase(),
    fields,
    fieldCount: fields.length,
    requiredCount: fields.filter((f) => f.required).length,
    missingLabels: fields.filter((f) => !f.label).length,
    steps,
    largestSelect: Math.max(0, ...fields.map((f) => (f.type === "select" ? f.options : 0))),
    hasPassword: fields.some((f) => f.type === "password"),
    hasCard: CARD_FIELD.test(all) || fields.some((f) => /cc-/.test(f.name)),
    hasIdNumber: ID_FIELD.test(all),
    hasDate: fields.some((f) => f.type === "date" || /\bdate\b/i.test(`${f.name} ${f.label}`)),
    hasTime: fields.some((f) => f.type === "time" || /\btime\b/i.test(`${f.name} ${f.label}`)),
    submitText,
    pays: PAY_WORDS.test(submitText),
  };
}

/**
 * Measures a data table: rows, columns, and how many rows link to another page.
 * @param {Element} table
 */
function measureTable(table) {
  const rows = [...table.querySelectorAll("tr")];
  const header = rows[0] ? [...rows[0].querySelectorAll("th")].length : 0;
  const bodyRows = header > 0 ? rows.slice(1) : rows;
  const cols = Math.max(0, ...rows.map((r) => r.querySelectorAll("th, td").length));
  return {
    rows: bodyRows.length,
    cols,
    linkedRows: bodyRows.filter((r) => r.querySelector("a[href]")).length,
    priceOnRequest: (textOf(table).match(PRICE_ON_REQUEST) ?? []).length,
    prices: (textOf(table).match(PRICE_SHOWN) ?? []).length,
  };
}

/**
 * Measures one HTML page.
 * @param {Document} doc
 * @param {string} url  the page's own URL, used to resolve links
 */
export function measurePage(doc, url) {
  const main = mainOf(doc);
  const mainText = textOf(main);
  const bodyText = textOf(doc.body);
  const headings = [...main.querySelectorAll("h1, h2, h3, h4, summary")].map(textOf);
  const questions = headings.filter((h) => h.endsWith("?")).length;

  const links = [];
  for (const a of doc.querySelectorAll("a[href]")) {
    try {
      const href = new URL(a.getAttribute("href"), url);
      href.hash = "";
      links.push({ url: href.href, text: textOf(a) });
    } catch {
      // Skip a link that is not a URL.
    }
  }

  const forms = [...doc.querySelectorAll("form")].map((f, i) => ({ ...measureForm(doc, f), index: i + 1 }));
  const tables = [...main.querySelectorAll("table")].map(measureTable);
  const scripts = doc.querySelectorAll("script[src], script:not([src])").length;

  return {
    url,
    path: new URL(url).pathname,
    title: textOf(doc.querySelector("title")),
    h1: textOf(main.querySelector("h1")),
    words: mainText ? mainText.split(" ").length : 0,
    headings,
    questions,
    forms,
    tables,
    links,
    priceOnRequest: (mainText.match(PRICE_ON_REQUEST) ?? []).length,
    pricesShown: (mainText.match(PRICE_SHOWN) ?? []).length,
    callToBook: CALL_TO_BOOK.test(bodyText),
    hasHours: HOURS.test(bodyText),
    mentionsHealth: HEALTH.test(mainText),
    mentionsMinors: MINORS.test(mainText),
    // A page with scripts and almost no text probably draws itself with JavaScript:
    // tier 2 (a real browser) is needed to see it.
    needsBrowser: scripts > 0 && bodyText.length < 200,
    hash: simhash(tagPaths(main)),
  };
}
