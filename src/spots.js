// Turns measured pages into spots (tasks a visitor does), each with 1–5 scores and the
// measured signals behind every score.
//
// These are the rule-based baseline scores. The LLM may later classify a task's purpose
// and adjust Fit, but only by quoting these signals. Everything here is repeatable.

import { groupByTemplate } from "./scanner/simhash.js";

const COVERAGE_WORDS = /\b(hmo|insurance|coverage|covered|warranty|returns?|refunds?|cancel\w*|payments?|shipping|delivery|installments?)\b/i;
const CONTACT_PAGE = /\b(contact|find us|visit (us|our)|location|directions)\b/i;

/**
 * A task's purpose from words on its button, form id and page heading.
 * @param {string} text
 */
export function purposeOf(text) {
  const t = text.toLowerCase();
  if (/\b(log ?in|sign ?in|password)\b/.test(t)) return "account";
  if (/\b(book|booking|appointment|reserv\w*|schedule)\b/.test(t)) return "book";
  if (/\b(quote|estimate)\b/.test(t)) return "quote";
  if (/\b(order|pre-order|buy|checkout|cart|purchase|pay)\b/.test(t)) return "buy";
  if (/\b(contact|message|inquir\w*|enquir\w*)\b/.test(t)) return "contact";
  if (/\b(subscribe|newsletter)\b/.test(t)) return "subscribe";
  return "other";
}

/**
 * The business's name, from the home page title ("Home · Ngiti Dental Clinic") or host.
 * @param {{origin:string, pages:Array<{path:string,title:string}>}} crawl
 */
export function siteNameOf(crawl) {
  const home = crawl.pages.find((p) => p.path === "/" || p.path.endsWith("/index.html")) ?? crawl.pages[0];
  const title = home?.title ?? "";
  const parts = title.split(/\s+[·|–—-]\s+/).map((t) => t.trim()).filter(Boolean);
  if (parts.length > 1) return parts.at(-1).slice(0, 60);
  if (parts[0] && parts[0].length <= 60) return parts[0];
  return new URL(crawl.origin).hostname.replace(/^www\./, "");
}

/** Baseline Value for each purpose (the owner can change it). */
const VALUE_FOR_PURPOSE = { book: 5, buy: 5, account: 4, quote: 4, compare: 4, learn: 3, contact: 2, price: 2, subscribe: 1, other: 3 };

/** @param {number} n @param {Array<[number, number]>} steps  [min, score] pairs, highest min first */
function band(n, steps) {
  for (const [min, score] of steps) if (n >= min) return score;
  return 1;
}

/** @param {number} n */
const clamp = (n) => Math.max(1, Math.min(5, n));

/** @param {number} n @param {string} one @param {string} [many] */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A spot under construction.
 * @param {object} init
 */
function makeSpot(init) {
  return { signals: [], fixes: [], flags: {}, needsConnector: false, publicFactsOnly: false, why: {}, ...init };
}

/**
 * Spots for one form.
 * @param {ReturnType<import("./scanner/page.js").measurePage>} page
 * @param {ReturnType<import("./scanner/page.js").measureForm>} form
 * @param {string[]} pages  every page that has this same form
 */
function formSpots(page, form, pages) {
  const isSearch = form.fieldCount <= 2 && form.fields.some((f) => f.type === "search" || /^(q|s|search|query)$/i.test(f.name));
  if (isSearch || form.fieldCount === 0) return [];

  const purpose = form.hasPassword ? "account" : purposeOf(`${form.submitText} ${form.id} ${page.h1}`);
  const where = page.h1 || page.title || page.path;

  if (purpose === "account") {
    const spot = makeSpot({
      id: `login:${page.path}`,
      label: `${where} (behind a login)`,
      kind: "form",
      purpose,
      pages,
      scores: { friction: 3, value: VALUE_FOR_PURPOSE.account, fit: 3, effort: 5, risk: 5 },
      flags: { secrets: true, regulated: page.mentionsHealth },
      source: { path: page.path },
    });
    spot.signals.push({ id: "password_field", text: "The form asks for a password" });
    if (page.mentionsHealth) spot.signals.push({ id: "health_words", text: "The page mentions health records (records, X-rays, treatment, patients)" });
    spot.why = {
      friction: "Unknown: what is behind the login cannot be scanned; 3 is a middle guess",
      value: "Account tasks matter to existing customers",
      fit: "Unknown without the owner's same-origin script; 3 is a middle guess",
      effort: "Behind a login, so an agent needs the business's own system",
      risk: page.mentionsHealth ? "Passwords and health data" : "Passwords",
    };
    return [spot];
  }

  const value = VALUE_FOR_PURPOSE[purpose] ?? 3;
  let friction = band(form.fieldCount, [[12, 5], [9, 4], [6, 3], [4, 2]]);
  if (form.steps >= 3) friction += 1;
  friction = clamp(friction);
  let fit = form.fieldCount >= 8 ? 5 : form.fieldCount >= 6 ? 4 : form.fieldCount >= 4 ? 3 : 2;
  if (form.largestSelect >= 10) fit = clamp(fit + 1);
  const effort = page.needsBrowser ? 3 : 1;

  let risk = form.method === "post" ? 2 : 1;
  const flags = {};
  if (form.pays) { risk = 5; flags.payment = true; }
  if (form.hasCard) { risk = 5; flags.payment = true; flags.secrets = true; }
  if (form.hasIdNumber) { risk = 5; flags.secrets = true; }

  const spot = makeSpot({
    id: `form:${page.path}#${form.id || `form-${form.index}`}`,
    label: `${where} form (${plural(form.fieldCount, "field")}${form.steps > 1 ? `, ${form.steps} steps` : ""})`,
    kind: "form",
    purpose,
    pages,
    scores: { friction, value, fit, effort, risk },
    flags,
    source: { path: page.path, formIndex: form.index, formId: form.id, title: where, submitText: form.submitText, steps: form.steps, fields: form.fields },
  });
  spot.signals.push({ id: "field_count", text: `${plural(form.fieldCount, "field")}, ${form.requiredCount} required` });
  if (form.steps > 1) spot.signals.push({ id: "steps", text: `${form.steps} steps` });
  if (form.largestSelect >= 8) spot.signals.push({ id: "big_dropdown", text: `A dropdown with ${form.largestSelect} options` });
  if (form.missingLabels > 0) spot.signals.push({ id: "missing_labels", text: `${plural(form.missingLabels, "field")} with no label` });
  if (form.submitText) spot.signals.push({ id: "submit_text", text: `Submit button: "${form.submitText}"` });
  if (form.missingLabels > 0) spot.fixes.push({ text: `Add labels to ${plural(form.missingLabels, "form field")}` });
  spot.why = {
    friction: `${plural(form.fieldCount, "field")}${form.steps >= 3 ? ` in ${form.steps} steps` : ""}`,
    value: `Purpose "${purpose}"`,
    fit: `${plural(form.fieldCount, "field")} an agent can fill from one sentence${form.largestSelect >= 10 ? `, and a ${form.largestSelect}-option dropdown` : ""}`,
    effort: page.needsBrowser ? "The form is drawn by JavaScript" : "A plain HTML form",
    risk: flags.payment ? "Takes a payment" : flags.secrets ? "Asks for ID or card numbers" : form.method === "post" ? "Sends a request the business can undo" : "Read-only",
  };

  const spots = [spot];
  if (purpose === "book" && form.hasDate && form.hasTime) {
    const slots = makeSpot({
      id: `action:check_slots:${page.path}`,
      label: "check_slots for other agents",
      kind: "action",
      purpose: "book",
      pages,
      needsConnector: true,
      scores: { friction: 3, value: 5, fit: 4, effort: 3, risk: 1 },
      source: { path: page.path },
    });
    slots.signals.push({ id: "date_time_typed", text: "The visitor types a date and a time" });
    slots.signals.push({ id: "no_slots_shown", text: "No free slots are shown before sending" });
    slots.why = {
      friction: "Visitors guess a time and wait for a reply",
      value: "Booking is the business's main task",
      fit: "Personal agents need to check a slot before booking",
      effort: "Free slots live in the business's own schedule, not on the page",
      risk: "Checking a slot is read-only",
    };
    spots.push(slots);
  }
  return spots;
}

/**
 * Finds every spot on a crawled site.
 *
 * @param {Awaited<ReturnType<import("./scanner/crawl.js").crawlSite>>} crawl
 * @returns {{size:"small"|"medium"|"large", groups: ReturnType<typeof groupByTemplate>, spots: object[]}}
 */
export function findSpots(crawl) {
  const pages = crawl.pages;
  const groups = groupByTemplate(pages.map((p) => ({ url: p.url, hash: p.hash })));
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const groupOf = new Map(groups.flatMap((g) => g.urls.map((u) => [u, g])));
  const size = pages.length <= 50 ? "small" : pages.length <= 1000 ? "medium" : "large";
  const spots = [];

  // Forms. The same form on many pages (such as a footer form) is one spot.
  const formSeen = new Map();
  for (const group of groups) {
    const page = byUrl.get(group.representative);
    for (const form of page.forms) {
      const key = form.fields.map((f) => `${f.name}:${f.type}`).join("|");
      if (formSeen.has(key)) {
        formSeen.get(key).pages.push(...group.urls);
        continue;
      }
      const found = formSpots(page, form, [...group.urls]);
      if (found[0]) formSeen.set(key, found[0]);
      spots.push(...found);
    }
  }

  // Compare: a table of many similar items that link to pages of one template.
  for (const page of pages) {
    for (const [tableIndex, table] of page.tables.entries()) {
      if (table.rows < 6 || table.cols < 4) continue;
      const targets = page.links.map((l) => groupOf.get(l.url)).filter((g) => g && g.urls.length > 1);
      const template = targets[0];
      const spot = makeSpot({
        id: `compare:${page.path}`,
        label: `Choosing between ${table.rows} options (${page.h1 || page.path})`,
        kind: "compare",
        purpose: "compare",
        pages: [page.url],
        scores: { friction: 4, value: VALUE_FOR_PURPOSE.compare, fit: clamp(table.rows >= 10 ? 5 : 4), effort: 1, risk: 1 },
        source: { path: page.path, tableIndex, title: page.h1 || page.title, rows: table.rows, cols: table.cols },
      });
      spot.signals.push({ id: "similar_items", text: `${table.rows} similar items in one table` });
      spot.signals.push({ id: "attributes", text: `${table.cols} columns to compare` });
      if (template) spot.signals.push({ id: "template_pages", text: `${template.urls.length} pages share one item template` });
      if (table.priceOnRequest > 0) spot.signals.push({ id: "no_price_in_table", text: `${table.priceOnRequest} of ${table.rows} rows have no price` });
      spot.why = {
        friction: "Visitors compare many rows by hand",
        value: "Choosing comes right before buying",
        fit: "Matching needs to options is language work",
        effort: "The data is already on the page",
        risk: "Read-only",
      };
      spots.push(spot);
    }
  }

  // Answers: a long FAQ or policy page.
  for (const group of groups) {
    const page = byUrl.get(group.representative);
    if (page.questions < 5 && page.words < 600) continue;
    const coverage = COVERAGE_WORDS.test(page.headings.join(" "));
    const friction = page.words >= 1500 ? 4 : page.words >= 600 || page.questions >= 8 ? 3 : 2;
    const fit = page.questions >= 8 ? 4 : 3;
    const spot = makeSpot({
      id: `answers:${page.path}`,
      label: `Questions on ${page.h1 || page.path}`,
      kind: "answers",
      purpose: "learn",
      pages: [...group.urls],
      scores: { friction, value: coverage ? 4 : VALUE_FOR_PURPOSE.learn, fit, effort: 1, risk: 1 },
      publicFactsOnly: page.mentionsHealth,
      source: { path: page.path, title: page.h1 || page.title, questions: page.questions, words: page.words },
    });
    spot.signals.push({ id: "questions", text: `${plural(page.questions, "question")} answered in ${plural(page.words, "word")}` });
    if (coverage) spot.signals.push({ id: "coverage_questions", text: "Questions about coverage, payment or delivery, asked before buying" });
    if (page.mentionsHealth) spot.signals.push({ id: "health_topic", text: "Health topic: public facts only" });
    spot.why = {
      friction: `${plural(page.words, "word")} to read for one answer`,
      value: coverage ? "Coverage questions decide whether a visitor books or buys" : "Learning supports a later task",
      fit: `${plural(page.questions, "question")}: answering from text is language work`,
      effort: "The answers are already on the page",
      risk: "Read-only",
    };
    spots.push(spot);
  }

  // Prices: "price on request" with no prices anywhere.
  const priceless = pages.filter((p) => p.priceOnRequest > 0);
  const anyPrices = pages.some((p) => p.pricesShown > 0);
  if (priceless.length > 0 && !anyPrices) {
    const mentions = priceless.reduce((n, p) => n + p.priceOnRequest, 0);
    const spot = makeSpot({
      id: "prices",
      label: "Prices (\"price on request\")",
      kind: "answers",
      purpose: "price",
      pages: priceless.map((p) => p.url),
      scores: { friction: 4, value: VALUE_FOR_PURPOSE.price, fit: 2, effort: 1, risk: 1 },
      source: { path: priceless[0].path, mentions },
    });
    spot.signals.push({ id: "price_on_request", text: `"Price on request" ${plural(mentions, "time")} on ${plural(priceless.length, "page")}` });
    spot.signals.push({ id: "no_prices", text: `No prices shown on any of ${plural(pages.length, "page")}` });
    spot.fixes.push({ text: "Publish your prices, or price ranges" });
    spot.why = {
      friction: "Visitors must call or write to learn a price",
      value: "A price is a step on the way to buying",
      fit: "An agent cannot answer a price the site never publishes",
      effort: "Plain text",
      risk: "Read-only",
    };
    spots.push(spot);
  }

  // Contact: opening hours shown or not.
  const contact = pages.find((p) => CONTACT_PAGE.test(`${p.path} ${p.h1}`));
  if (contact) {
    const hours = pages.some((p) => p.hasHours);
    const callToBook = pages.some((p) => p.callToBook);
    const spot = makeSpot({
      id: `contact:${contact.path}`,
      label: hours ? `${contact.h1 || "Contact"} page` : `${contact.h1 || "Contact"} page (no opening hours)`,
      kind: "page",
      purpose: "contact",
      pages: [contact.url],
      scores: { friction: hours ? 1 : 2, value: VALUE_FOR_PURPOSE.contact, fit: 1, effort: 1, risk: 1 },
      source: { path: contact.path, title: contact.h1 || contact.title },
    });
    if (hours) {
      spot.signals.push({ id: "hours_shown", text: "Opening hours are shown" });
      spot.signals.push({ id: "short_page", text: `${plural(contact.words, "word")}, easy to read` });
    } else {
      spot.signals.push({ id: "no_hours", text: `No opening hours on any of ${plural(pages.length, "page")}` });
      if (callToBook) spot.signals.push({ id: "call_to_book", text: "Says \"call us to book\" but not when to call" });
      spot.fixes.push({ text: "Add opening hours" });
    }
    spot.why = {
      friction: hours ? "Everything a visitor needs is shown" : "Visitors cannot tell when to call",
      value: "Contact details support other tasks",
      fit: "A short page needs no agent",
      effort: "Plain text",
      risk: "Read-only",
    };
    spots.push(spot);
  }

  return { size, groups, spots };
}
