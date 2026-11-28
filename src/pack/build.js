// Builds an agent pack for the spots the owner approved, in the agentify-website format,
// and checks it with the challenge's own build_network.mjs --check.
//
// For a site we have the files of (the samples), the pack is an agentified copy of the site
// that runs as is. For any other site, the pack holds only the files to add to it.

import { execFile } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { fileFor } from "./mirror.js";
import { parse } from "../scanner/node.js";
import { findTarget } from "../view.js";

const run = promisify(execFile);

/**
 * Reads a text file with Unix line endings, whatever the checkout uses.
 * @param {string} file
 */
async function readText(file) {
  return (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
}
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..");
const SKILL = path.join(ROOT, "vendor", "agentify-website");
const TEMPLATES = path.join(SKILL, "templates");

/** The protocol name in runtime/README.md. */
const PROTOCOL = "nsdeploy";

/** Default router and model: the Meta Model API (OpenAI-compatible). */
const ROUTER = "https://api.meta.ai/v1";
const MODEL = "muse-ember-1.0";

/**
 * A safe identifier: lower case, digits and underscores.
 * @param {string} s
 */
export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "site";
}

/**
 * The approved spots, with the action names each one gets.
 *
 * @param {Array<object>} plan  decidePlan() output
 * @param {string[]|null} approved  spot ids to build; null builds every "agent" spot
 */
export function placementFor(plan, approved = null) {
  const used = new Set();
  const unique = (name) => {
    let n = name;
    for (let i = 2; used.has(n); i += 1) n = `${name}_${i}`;
    used.add(n);
    return n;
  };
  const spots = [];
  for (const d of plan) {
    if (d.decision !== "agent") continue;
    if (approved && !approved.includes(d.spot.id)) continue;
    const src = d.spot.source ?? {};
    const base = slugify(path.posix.basename(src.path || "/home", ".html") || "home");
    if (d.spot.kind === "form" && src.fields) {
      spots.push({
        id: d.spot.id, kind: "form", placement: d.placement, path: src.path, title: src.title,
        target: d.spot.target ?? null, formIndex: src.formIndex, formId: src.formId, submitText: src.submitText,
        fields: src.fields.map(({ name, type, label, required, choices, placeholder }) => ({ name, type, label, required, choices: choices ?? [], placeholder: placeholder ?? "" })),
        fillName: unique(`fill_${base}_form`), submitName: unique(`send_${base}_form`),
      });
    } else if (d.spot.kind === "answers") {
      spots.push({
        id: d.spot.id, kind: "answers", placement: d.placement, path: src.path, title: src.title, target: { find: "question", index: 0 },
        // Every page the answer desk covers (one site-wide desk), most questions first.
        paths: (src.pages?.map((p) => p.path) ?? [src.path]).slice(0, 10),
        topics: `what the "${src.title}" page covers`, publicFactsOnly: d.spot.publicFactsOnly === true,
        readName: unique(`read_${base}`),
      });
    } else if (d.spot.kind === "compare") {
      spots.push({
        id: d.spot.id, kind: "compare", placement: d.placement, path: src.path, title: src.title,
        target: d.spot.target ?? { find: "table", index: src.tableIndex }, tableIndex: src.tableIndex, listName: unique(`list_${base}_options`),
      });
    }
  }
  const contactSpot = plan.find((d) => d.spot.purpose === "contact");
  const contact = contactSpot ? { path: contactSpot.spot.source.path, title: contactSpot.spot.source.title } : null;
  return { spots, contact };
}

/** The records collection a compare spot gets in a companion snapshot. */
export const collectionFor = (s) => s.listName.replace(/^list_/, "");

/**
 * Every website_* tool name a placement registers, without the prefix.
 * @param {object} placement
 * @param {boolean} [companion]  a companion assistant reads a snapshot instead of the page
 */
export function toolNames(placement, companion = false) {
  if (companion) {
    return placement.spots.some((s) => s.kind === "compare") ? ["search_site_content", "get_site_records"] : ["search_site_content"];
  }
  const names = [];
  for (const s of placement.spots) {
    if (s.kind === "form") names.push(s.fillName, s.submitName);
    if (s.kind === "answers") names.push(s.readName);
    if (s.kind === "compare") names.push(s.listName);
  }
  if (placement.contact) names.push("read_contact");
  if (placement.sitePages?.length) names.push("search_site", "site_map", "go_to_page");
  names.push("show_on_page", "guide_on_page", "highlight_table");
  return names;
}

/**
 * What the assistant must say it cannot do, from the spots it did not get.
 * @param {Array<object>} plan
 */
function limitsFor(plan) {
  const lines = ["take payments or card details", "change or cancel a request after it is sent"];
  for (const d of plan) {
    if (d.spot.purpose === "price" && d.decision !== "agent") lines.push("give prices the site does not publish");
    if (d.spot.kind === "action" && d.decision !== "agent") lines.push("check live availability or free time slots");
    if (d.decision === "veto") lines.push(`help with "${d.spot.label}": a person at the business handles that`);
  }
  return [...new Set(lines)];
}

/** Squeezed plain text, at most max characters, with no control characters. */
const plain = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The owner's own words for the assistant, written with the AI helper in MythAgentic and
 * approved by the owner: greeting, rules, and the Ask bar text per spot. Only text, with
 * length limits. None of it changes a score or a decision.
 *
 * @param {unknown} raw
 * @param {Array<{id:string}>} spots  the placement spots it may name
 * @returns {{greeting:string, rules:string[], askBars:Record<string,{title:string, sub:string, questions:string[]}>}|null}
 */
export function cleanTuning(raw, spots) {
  if (!raw || typeof raw !== "object") return null;
  const greeting = plain(raw.greeting, 300);
  const rules = (Array.isArray(raw.rules) ? raw.rules : []).map((r) => plain(r, 200)).filter(Boolean).slice(0, 8);
  const askBars = {};
  const ids = new Set(spots.map((s) => s.id));
  for (const [id, bar] of Object.entries(raw.askBars && typeof raw.askBars === "object" ? raw.askBars : {})) {
    if (!ids.has(id) || !bar || typeof bar !== "object") continue;
    const questions = (Array.isArray(bar.questions) ? bar.questions : []).map((q) => plain(q, 120)).filter(Boolean).slice(0, 4);
    const out = { title: plain(bar.title, 80), sub: plain(bar.sub, 160), questions };
    if (out.title || out.sub || questions.length) askBars[id] = out;
  }
  if (!greeting && rules.length === 0 && Object.keys(askBars).length === 0) return null;
  return { greeting, rules, askBars };
}

/** The owner's rules as an instruction block, or "" without any. */
function ownerNotes(tuning) {
  if (!tuning?.rules?.length) return "";
  return `The site owner's own notes (follow them, unless they conflict with the rules above):\n${tuning.rules.map((r) => `- ${r}`).join("\n")}\n`;
}

/**
 * The network as JSON, which is valid HOCON.
 */
/**
 * How the assistant shows things in the chat. The challenge template allows a form widget
 * in the chat; on a site with its own form that draws a second copy of it, so a MythAgentic
 * pack never draws forms: the page is the interface, and the agent fills the page's form.
 */
const CRUSE_RULES = `
PRESENTATION: Reply in short Markdown; a Markdown table needs no tool call. The page is the interface: never draw a form in the chat and never collect details with a widget. To fill a form, call the site's fill action, which fills the page's own form; ask for missing details in one short sentence. Use render_cruse with {"version":1,"components":[...]} only for a quick choice between a few options, a small table, a summary card or a chart. Give each component a stable id.
Component kinds and their fields:
- choice: options, each with title, value and optional subtitle and meta.
- table: columns (list of strings) and rows (lists of scalars, one value per column).
- info: fields, an object of label to value.
- chart: chartType "bar" or "line", labels, series (each with name and values), summary, optional unit. Use only numbers from tool results.
Do not ask the visitor to confirm an irreversible action, in chat or with a confirm component: the browser asks them when you call the tool. Ask only when a price or fee they agreed to has changed.
`;

function networkFor({ siteName, network, front, placement, plan, grounding, cruse, companion = null, tuning = null }) {
  const how = [];
  const queries = [];
  if (companion) {
    how.push(`- Answers come from a snapshot of ${companion.source} taken on ${companion.fetchedAt}. Prices and availability may have changed; always give the source link.`);
    how.push("- For any question about the site: call website_search_site_content with the visitor's words and answer only from the excerpts it returns, citing the page URL.");
  }
  for (const s of placement.spots) {
    if (companion) {
      if (s.kind === "form") {
        const fields = s.fields.filter((f) => f.label || f.name).map((f) => f.label || f.name).slice(0, 14).join(", ");
        how.push(`- "${s.title}" form: you cannot fill or send it from here. Tell the visitor what it asks for (${fields}), help them get those details ready, and give them the link ${new URL(s.path, companion.source).href} to finish it on the real site.`);
        queries.push(`What do I need for the "${s.title}" form?`);
      } else if (s.kind === "compare") {
        how.push(`- Choosing between options on "${s.title}": ask what matters to the visitor, call website_get_site_records with collection "${collectionFor(s)}", and compare only the records it returns, with their links.`);
        queries.push(`Help me choose on "${s.title}". What fits me best?`);
      } else if (s.kind === "answers") {
        queries.push(`I have a question about "${s.title}". What does the site say?`);
      }
      continue;
    }
    if (s.kind === "form") {
      how.push(`- "${s.title}" form (on ${s.path}): call website_${s.fillName}, then website_${s.submitName}. Work out yourself what the site can tell you: asked to review, decide or choose a value, read the site (website_search_site and the actions here), fill your best suggestion and say which page and rule it rests on. Ask only for what only the visitor knows (name, contact, dates). If the fill action says the form is on another page, give the link to ${s.path}.`);
      queries.push(`Help me fill in the "${s.title}" form.`);
    } else if (s.kind === "answers") {
      how.push(`- Questions about ${s.topics}: call website_${s.readName} and answer from it, citing the page.`);
      queries.push(`I have a question about "${s.title}". What does the site say?`);
    } else if (s.kind === "compare") {
      how.push(`- Choosing between options on "${s.title}": ask what matters to the visitor, call website_${s.listName}, and compare only the rows it returns.`);
      queries.push("Which option suits two people best, and why?");
    }
  }
  if (placement.contact && !companion) how.push("- How to reach the business, or anything you cannot do: call website_read_contact.");
  if (!companion && placement.sitePages?.length) how.push("- Any other question about the site: call website_search_site with the visitor's words, answer only from what it returns, and give the page link.");
  if (!companion) {
    how.push("- You can act on the page. Asked how to do something or where something is on the open page, call website_guide_on_page with up to 6 steps (the exact words of a button, field or heading, plus a short note).");
    how.push("- Comparing options in a table: call website_highlight_table with the rows or columns that answer it and a one-line note.");
    if (placement.sitePages?.length) how.push("- When the answer is on another page, find it (website_site_map, website_search_site), say where you are going, then call website_go_to_page with the path, the heading to outline and the reason.");
  }
  if (!companion) how.push("- Be specific: name each item as the site names it (product, plan, tour, question), so the page can highlight it. Never stay general.");
  if (!companion) how.push("- After answering from a heading, table row or form on the open page, call website_show_on_page with its exact words. If it is on another page, give the link.");
  if (companion) how.push("- Anything you cannot do from here (log in, pay, send a form, change an account): say so, and give the link to the page on the real site.");
  queries.push("Can I pay by card online here?");
  if (placement.spots.some((s) => s.publicFactsOnly)) {
    how.push("- Health, legal or money questions about the visitor's own case: give only the public facts the site states, then say a person at the business must answer the rest. Never give medical advice.");
  }

  const cannot = limitsFor(plan).map((l) => `- ${l}`).join("\n");
  const groundingFilled = grounding.replace(
    /TODO: list what this site cannot do[^\n]*\n/,
    `This assistant cannot:\n${cannot}\n`,
  ).replace(/website_<read_action>/g, companion ? "website_search_site_content" : placement.contact ? "website_read_contact" : "the site's own pages");

  return {
    metadata: {
      description: `Helps visitors of ${siteName} where the page is hard: ${placement.spots.map((s) => s.title).join(", ")}.`,
      sample_queries: queries.slice(0, 4),
    },
    llm_config: { model_name: MODEL },
    max_steps: 12,
    cruse: { version: 1 },
    commondefs: {
      replacement_strings: { site_name: siteName, grounding_rules: groundingFilled, cruse_rules: cruse },
    },
    tools: [
      {
        name: front,
        function: {
          description: `Helps a visitor of ${siteName} with the tasks this site's assistant was placed for.`,
          parameters: { type: "object", properties: { request: { type: "string", description: "The request in plain language." } }, required: ["request"] },
        },
        instructions: `You are the assistant on the {site_name} website. You help visitors only where this site placed you: ${placement.spots.map((s) => s.title).join("; ")}.\n{grounding_rules}\nHow to work:\n${how.join("\n")}\n${ownerNotes(tuning)}{cruse_rules}\n`,
        tools: [],
      },
    ],
  };
}

/**
 * Pulls a triple-quoted replacement string out of the network template.
 * @param {string} hocon
 * @param {string} key
 */
function templateString(hocon, key) {
  const match = hocon.match(new RegExp(`"${key}": """\\n([\\s\\S]*?)"""`));
  if (!match) throw new Error(`template string ${key} not found`);
  return match[1];
}

/**
 * Fills the official site.js template.
 */
function siteJsFor(template, placement, siteName, companion = false, greeting = "") {
  if (companion) {
    // Live URL mode: no page object and no irreversible actions, so the import goes and
    // reviewDetails() returns nothing, as the template's own comment says.
    const tasks = placement.spots.map((s) => (s.kind === "form" ? `get ready for the "${s.title}" form` : s.kind === "compare" ? "compare the options" : "answer questions from the site"));
    const list = tasks.length > 1 ? `${tasks.slice(0, -1).join(", ")} and ${tasks.at(-1)}` : tasks[0];
    let out = template;
    out = out.replace(/\/\/ TODO: import the class[\s\S]*?import \{ App \} from "\.\/script\.js";/, "// Generated by MythAgentic from the agentify-website template (companion assistant).");
    out = out.replace(/static GREETING = ".*";/, `static GREETING = ${JSON.stringify(greeting || `Hi! I answer from ${siteName}'s public pages. I can ${list}, with links to the real site.`)};`);
    out = out.replace(/static DIALOGS = \{[\s\S]*?\n {2}\};/, "static DIALOGS = {};");
    out = out.replace(/ {4}\/\/ TODO: return details for each irreversible action[\s\S]*?return \{\};\n {2}\}/, "    return {};\n  }");
    if (/TODO|App\.page|script\.js/.test(out)) throw new Error("site.js template changed: a TODO was not filled");
    return out;
  }
  const dialogs = {};
  for (const s of placement.spots) {
    if (s.kind !== "form") continue;
    dialogs[s.submitName] = {
      title: `Send the "${s.title}" form?`,
      sentence: `We will send the form below through ${siteName}'s own "${s.submitText || "Submit"}" button.`,
      confirm: s.submitText || "Send the form",
      decline: "Don't send",
    };
  }
  const tasks = placement.spots.map((s) => (s.kind === "form" ? `fill in the "${s.title}" form` : s.kind === "compare" ? "compare the options" : `answer questions from "${s.title}"`));
  const list = tasks.length > 1 ? `${tasks.slice(0, -1).join(", ")} and ${tasks.at(-1)}` : tasks[0];
  let out = template;
  out = out.replace(/\/\/ TODO: import the class[\s\S]*?import \{ App \} from "\.\/script\.js";/, '// Generated by MythAgentic from the agentify-website template.\nimport { PackActions } from "./site-actions.js";');
  out = out.replace(/static GREETING = ".*";/, `static GREETING = ${JSON.stringify(greeting || `Hi! I can ${list}. Tell me what you need in one sentence.`)};`);
  out = out.replace(/static DIALOGS = \{[\s\S]*?\n {2}\};/, `static DIALOGS = ${JSON.stringify(dialogs, null, 2).replace(/\n/g, "\n  ")};`);
  out = out.replace(/ {4}\/\/ TODO: return details for each irreversible action[\s\S]*?return \{\};\n {2}\}/, `    const spot = (PackActions.placement?.spots ?? []).find((s) => s.submitName === action);
    if (!spot) {
      return {};
    }
    const check = PackActions.check(spot);
    if (!check.ok) {
      return { refusal: check.reason };
    }
    return PackActions.values(spot);
  }`);
  if (/TODO|App\.page|script\.js/.test(out)) throw new Error("site.js template changed: a TODO was not filled");
  return out;
}

/** Text made safe for HTML. */
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** "/tours/index.html", "/tours/" and "/tours" are one page. */
const samePage = (a, b) => {
  const strip = (p) => String(p).replace(/index\.html$/, "").replace(/\/$/, "");
  return strip(a) === strip(b);
};

/**
 * Marks the parts of one page that the approved spots are about, for the Ask bars.
 *
 * @param {Document} doc
 * @param {Array<object>} spots  placement spots
 * @param {string} pagePath
 * @returns {number} how many parts were marked
 */
export function markSpots(doc, spots, pagePath) {
  let count = 0;
  for (const spot of spots) {
    const pages = spot.kind === "answers" ? (spot.paths ?? [spot.path]) : [spot.path];
    if (!pages.some((p) => samePage(p, pagePath))) continue;
    let el = findTarget(doc, spot.target);
    if (!el) continue;
    if (el.tagName === "SUMMARY") el = el.parentElement;
    // A question heading that opens its own card: the bar goes before the card.
    const parent = el.parentElement;
    const questions = (node) => [...node.querySelectorAll("h1, h2, h3, h4, summary")].filter((h) => h.textContent.trim().endsWith("?")).length;
    if (spot.kind === "answers" && /^H[1-4]$/.test(el.tagName) && parent && !/^(MAIN|BODY)$/.test(parent.tagName)
      && parent.querySelector("h1, h2, h3, h4, summary") === el && questions(parent) === 1 && parent.textContent.length < 2500) el = parent;
    el.setAttribute("data-agent-spot", spot.id);
    el.setAttribute("data-agent-kind", spot.kind);
    count += 1;
  }
  return count;
}

/**
 * Lists the files under a folder, relative to it, with forward slashes.
 * @param {string} dir
 */
export async function listFiles(dir) {
  const out = [];
  const walk = async (d, rel) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(d, entry.name), r);
      else out.push(r);
    }
  };
  await walk(dir, "");
  return out.sort();
}

/**
 * Builds and checks an agent pack.
 *
 * @param {object} options
 * @param {string} options.siteName  the business's name
 * @param {Array<object>} options.plan  decidePlan() output
 * @param {string[]|null} [options.approved]  spot ids the owner approved; null = all agent spots
 * @param {string|null} [options.siteDir]  the site's own files, when we have them
 * @param {string} options.outDir  where to write the pack (replaced)
 * @returns {Promise<{ok:boolean, network:string, tools:string[], spots:object[], mounted:string[], check:string, files:string[]}>}
 */
export async function buildPack({ siteName, plan, approved = null, siteDir = null, snapshot = null, mirror = null, tuning: rawTuning = null, outDir }) {
  const placement = placementFor(plan, approved);
  const tuning = cleanTuning(rawTuning, placement.spots);
  // Every public page the assistant may search (not for a companion, which has its snapshot).
  if (mirror) placement.sitePages = mirror.pages.map((p) => p.path).slice(0, 40);
  else if (siteDir) placement.sitePages = (await listFiles(siteDir)).filter((r) => r.endsWith(".html")).map((r) => `/${r.replace(/(^|\/)index\.html$/, "$1")}`).slice(0, 40);
  for (const s of placement.spots) if (tuning?.askBars[s.id]) s.ask = tuning.askBars[s.id];
  if (placement.spots.length === 0) {
    throw Object.assign(new Error("Nothing to build: no approved agent spots."), { code: "NOTHING_TO_BUILD" });
  }
  // Without the site's files, a snapshot of its public pages makes a companion assistant
  // (the skill's live URL mode): a separate page that answers and links to the real site.
  // A mirror (a preview copy of the scanned pages) is built like a site we have the files of.
  const companion = !siteDir && !mirror && snapshot ? { source: snapshot.source, fetchedAt: snapshot.fetchedAt } : null;
  const slug = slugify(siteName);
  const network = `${slug}_assistant`;
  const front = `${slug}_helper`;
  const tools = toolNames(placement, !!companion);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  if (siteDir) await cp(siteDir, outDir, { recursive: true });
  if (mirror) {
    for (const page of mirror.pages) {
      const file = path.join(outDir, fileFor(page.path));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, page.html);
    }
    await cp(path.join(here, "mirror-page.js"), path.join(outDir, "mirror-page.js"));
    await cp(path.join(here, "mirror-page.css"), path.join(outDir, "mirror-page.css"));
  }
  await cp(path.join(SKILL, "runtime"), path.join(outDir, "runtime"), { recursive: true });
  await cp(path.join(TEMPLATES, "assistant.css"), path.join(outDir, "assistant.css"));
  if (companion) {
    await cp(path.join(TEMPLATES, "content-actions.js"), path.join(outDir, "content-actions.js"));
    await writeFile(path.join(outDir, "site-content.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  } else {
    await cp(path.join(here, "site-actions.js"), path.join(outDir, "site-actions.js"));
    await cp(path.join(here, "assistant-dock.js"), path.join(outDir, "assistant-dock.js"));
    await cp(path.join(here, "assistant-dock.css"), path.join(outDir, "assistant-dock.css"));
  }
  await writeFile(path.join(outDir, "placement.json"), `${JSON.stringify({ generator: "MythAgentic", siteName, mode: companion ? "companion" : "source", ...placement }, null, 2)}\n`);

  const hoconTemplate = await readText(path.join(TEMPLATES, "network.hocon"));
  const net = networkFor({
    tuning,
    siteName, network, front, placement, plan, companion,
    grounding: templateString(hoconTemplate, "grounding_rules"),
    cruse: CRUSE_RULES,
  });
  await writeFile(path.join(outDir, `${network}.hocon`), `# ${siteName} assistant, generated by MythAgentic. Source of truth for ${network}.network.json.\n${JSON.stringify(net, null, 2)}\n`);

  const manifest = JSON.parse(await readText(path.join(TEMPLATES, "agent-manifest.json")));
  manifest.brand = `${siteName} Assistant`;
  manifest.networks = [{
    name: network, front_man: front, hocon: `./${network}.network.json`,
    description: net.metadata.description,
    tags: ["agentified-website", "mythagentic-pack"],
    sample_queries: net.metadata.sample_queries,
  }];
  manifest.llm_router = { base_url: ROUTER, mock: false, byok_router: ROUTER };
  manifest.agent_mcp = { ...manifest.agent_mcp, protocol: `${PROTOCOL}-agent-mcp/v1`, network, front_man: front };
  manifest.linking = {
    ...manifest.linking,
    protocol: `${PROTOCOL}-link/v1`,
    exports: [{ network, front_man: front, aliases: [network, front], url: network }],
  };
  manifest.actions = { ...manifest.actions, agentTools: tools, ...(companion ? { module: "./content-actions.js" } : {}) };
  await writeFile(path.join(outDir, "agent-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(outDir, "links.json"), `${JSON.stringify({ version: 1, networks: { [network]: {} } }, null, 2)}\n`);

  const siteJs = siteJsFor(await readText(path.join(TEMPLATES, "site.js")), placement, siteName, !!companion, tuning?.greeting);
  await writeFile(path.join(outDir, "site.js"), siteJs);

  const section = (await readText(path.join(TEMPLATES, "assistant-section.html")))
    .replace(/<!--[\s\S]*?-->\n?/, "")
    .replace("<Site name>", escHtml(siteName))
    .replace('<section id="assistant"', `<section id="assistant" data-site-name="${escHtml(siteName)}"`)
    .replace("TODO: one sentence on what the assistant can do here.", companion
      ? "Ask in one sentence. I answer from the site's public pages and give you the link to finish on the real site."
      : placement.spots.some((s) => s.kind === "form")
        ? "Tell me what you need in one sentence. I fill the form on the page for you, and you check it before anything is sent."
        : "Ask in one sentence. I answer from this site's own pages and show you where it says so.");
  await writeFile(path.join(outDir, "assistant-section.html"), section);

  const mounted = [];
  if (companion) {
    const esc = escHtml;
    const host = new URL(companion.source).hostname;
    const page = (await readText(path.join(TEMPLATES, "standalone-index.html")))
      .replace(/<Site name>/g, esc(siteName))
      .replace('<a href="https://example.com/">example.com</a>', `<a href="${esc(companion.source)}">${esc(host)}</a>`)
      .replace("TODO: date", esc(companion.fetchedAt))
      .replace("<!-- Paste templates/assistant-section.html here. -->", section);
    if (/TODO|<Site name>|example\.com/.test(page)) throw new Error("standalone-index.html template changed: a TODO was not filled");
    await writeFile(path.join(outDir, "index.html"), page);
    mounted.push("/");
  } else {
    // The assistant is one side panel for the whole site (rule R4: one front agent), opened
    // from a launcher on every page. The parts of the page it was placed for get an Ask bar
    // (data-agent-spot), and only those spots get actions.
    const pages = mirror
      ? mirror.pages.map((p) => ({ path: p.path, rel: fileFor(p.path) }))
      : (await listFiles(siteDir)).filter((r) => r.endsWith(".html")).map((rel) => ({ rel, path: `/${rel.replace(/(^|\/)index\.html$/, "$1")}` }));
    const siteMap = [];
    const squeeze = (t) => (t ?? "").replace(/\s+/g, " ").trim();
    for (const page of pages) {
      const prefix = "../".repeat(page.rel.split("/").length - 1);
      const doc = parse(await readFile(path.join(outDir, page.rel), "utf8"));
      const marked = markSpots(doc, placement.spots, page.path);
      siteMap.push({
        path: page.path,
        title: squeeze(doc.querySelector("title")?.textContent).slice(0, 120),
        headings: [...(doc.querySelector("main") ?? doc.body ?? doc.documentElement).querySelectorAll("h1, h2, h3")].map((h) => squeeze(h.textContent)).filter(Boolean).slice(0, 12),
      });
      const head = doc.head ?? doc.documentElement;
      const link = (href) => { const el = doc.createElement("link"); el.setAttribute("rel", "stylesheet"); el.setAttribute("href", href); head.append(el); };
      const script = (src) => { const el = doc.createElement("script"); el.setAttribute("type", "module"); el.setAttribute("src", src); head.append(el); };
      if (mirror) { link(`${prefix}mirror-page.css`); script(`${prefix}mirror-page.js`); }
      link(`${prefix}assistant.css`);
      link(`${prefix}assistant-dock.css`);
      script(`${prefix}site.js`);
      script(`${prefix}assistant-dock.js`);
      (doc.body ?? doc.documentElement).insertAdjacentHTML("beforeend", section);
      if (marked) mounted.push(page.path);
      await writeFile(path.join(outDir, page.rel), `<!doctype html>\n${doc.documentElement.outerHTML}\n`);
    }
    // The site map goes with the placement, for the site_map action.
    if (placement.sitePages?.length) {
      placement.siteMap = siteMap.filter((p) => placement.sitePages.includes(p.path)).slice(0, 40);
      await writeFile(path.join(outDir, "placement.json"), `${JSON.stringify({ generator: "MythAgentic", siteName, mode: "source", ...placement }, null, 2)}\n`);
    }
  }

  // Build first (writes the network JSON, discovery files and bridge), then check.
  const script = path.join(SKILL, "scripts", "build_network.mjs");
  const args = [script, path.join(outDir, `${network}.hocon`), "--manifest", path.join(outDir, "agent-manifest.json")];
  let check = "";
  let ok = false;
  try {
    await run(process.execPath, args, { cwd: outDir, timeout: 60_000 });
    const result = await run(process.execPath, [...args, "--check"], { cwd: outDir, timeout: 60_000 });
    check = `${result.stdout}${result.stderr}`;
    ok = true;
  } catch (error) {
    check = `${error.stdout ?? ""}${error.stderr ?? error.message}`;
  }
  const relCheck = check.split(path.resolve(outDir)).join(".").split(outDir).join(".");
  return { ok, network, front, tools, spots: placement.spots, mounted, companion: !!companion, tuned: !!tuning, check: relCheck.trim(), files: await listFiles(outDir) };
}
