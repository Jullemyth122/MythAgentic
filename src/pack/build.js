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
        formIndex: src.formIndex, formId: src.formId, submitText: src.submitText,
        fields: src.fields.map(({ name, type, label, required, choices, placeholder }) => ({ name, type, label, required, choices: choices ?? [], placeholder: placeholder ?? "" })),
        fillName: unique(`fill_${base}_form`), submitName: unique(`send_${base}_form`),
      });
    } else if (d.spot.kind === "answers") {
      spots.push({
        id: d.spot.id, kind: "answers", placement: d.placement, path: src.path, title: src.title,
        topics: `what the "${src.title}" page covers`, publicFactsOnly: d.spot.publicFactsOnly === true,
        readName: unique(`read_${base}`),
      });
    } else if (d.spot.kind === "compare") {
      spots.push({
        id: d.spot.id, kind: "compare", placement: d.placement, path: src.path, title: src.title,
        tableIndex: src.tableIndex, listName: unique(`list_${base}_options`),
      });
    }
  }
  const contactSpot = plan.find((d) => d.spot.purpose === "contact");
  const contact = contactSpot ? { path: contactSpot.spot.source.path, title: contactSpot.spot.source.title } : null;
  return { spots, contact };
}

/** Every website_* tool name a placement registers, without the prefix. */
export function toolNames(placement) {
  const names = [];
  for (const s of placement.spots) {
    if (s.kind === "form") names.push(s.fillName, s.submitName);
    if (s.kind === "answers") names.push(s.readName);
    if (s.kind === "compare") names.push(s.listName);
  }
  if (placement.contact) names.push("read_contact");
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

/**
 * The network as JSON, which is valid HOCON.
 */
function networkFor({ siteName, network, front, placement, plan, grounding, cruse }) {
  const how = [];
  const queries = [];
  for (const s of placement.spots) {
    if (s.kind === "form") {
      how.push(`- "${s.title}" form (on ${s.path}): ask only for what is missing, call website_${s.fillName} with what the visitor gave, then website_${s.submitName}. If the visitor is on another page, give them the link to ${s.path}.`);
      queries.push(`Help me fill in the "${s.title}" form.`);
    } else if (s.kind === "answers") {
      how.push(`- Questions about ${s.topics}: call website_${s.readName} and answer from it, citing the page.`);
      queries.push(`I have a question about "${s.title}". What does the site say?`);
    } else if (s.kind === "compare") {
      how.push(`- Choosing between options on "${s.title}": ask what matters to the visitor, call website_${s.listName}, and compare only the rows it returns.`);
      queries.push("Which option suits two people best, and why?");
    }
  }
  if (placement.contact) how.push("- How to reach the business, or anything you cannot do: call website_read_contact.");
  queries.push("Can I pay by card online here?");
  if (placement.spots.some((s) => s.publicFactsOnly)) {
    how.push("- Health, legal or money questions about the visitor's own case: give only the public facts the site states, then say a person at the business must answer the rest. Never give medical advice.");
  }

  const cannot = limitsFor(plan).map((l) => `- ${l}`).join("\n");
  const groundingFilled = grounding.replace(
    /TODO: list what this site cannot do[^\n]*\n/,
    `This assistant cannot:\n${cannot}\n`,
  ).replace(/website_<read_action>/g, placement.contact ? "website_read_contact" : "the site's own pages");

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
        instructions: `You are the assistant on the {site_name} website. You help visitors only where this site placed you: ${placement.spots.map((s) => s.title).join("; ")}.\n{grounding_rules}\nHow to work:\n${how.join("\n")}\n{cruse_rules}\n`,
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
function siteJsFor(template, placement, siteName) {
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
  out = out.replace(/static GREETING = ".*";/, `static GREETING = ${JSON.stringify(`Hi! I can ${list}. Tell me what you need in one sentence.`)};`);
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

/**
 * Adds the assistant section, its stylesheet and site.js to one page.
 */
function mountInto(html, sectionHtml, prefix) {
  const head = `<link rel="stylesheet" href="${prefix}assistant.css">\n<script type="module" src="${prefix}site.js"></script>\n</head>`;
  let out = html.replace("</head>", head);
  out = out.includes("</main>") ? out.replace("</main>", `${sectionHtml}\n</main>`) : out.replace("</body>", `${sectionHtml}\n</body>`);
  return out;
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
export async function buildPack({ siteName, plan, approved = null, siteDir = null, outDir }) {
  const placement = placementFor(plan, approved);
  if (placement.spots.length === 0) {
    throw Object.assign(new Error("Nothing to build: no approved agent spots."), { code: "NOTHING_TO_BUILD" });
  }
  const slug = slugify(siteName);
  const network = `${slug}_assistant`;
  const front = `${slug}_helper`;
  const tools = toolNames(placement);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  if (siteDir) await cp(siteDir, outDir, { recursive: true });
  await cp(path.join(SKILL, "runtime"), path.join(outDir, "runtime"), { recursive: true });
  await cp(path.join(TEMPLATES, "assistant.css"), path.join(outDir, "assistant.css"));
  await cp(path.join(here, "site-actions.js"), path.join(outDir, "site-actions.js"));
  await writeFile(path.join(outDir, "placement.json"), `${JSON.stringify({ generator: "MythAgentic", siteName, ...placement }, null, 2)}\n`);

  const hoconTemplate = await readText(path.join(TEMPLATES, "network.hocon"));
  const net = networkFor({
    siteName, network, front, placement, plan,
    grounding: templateString(hoconTemplate, "grounding_rules"),
    cruse: templateString(hoconTemplate, "cruse_rules"),
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
  manifest.actions = { ...manifest.actions, agentTools: tools };
  await writeFile(path.join(outDir, "agent-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(outDir, "links.json"), `${JSON.stringify({ version: 1, networks: { [network]: {} } }, null, 2)}\n`);

  const siteJs = siteJsFor(await readText(path.join(TEMPLATES, "site.js")), placement, siteName);
  await writeFile(path.join(outDir, "site.js"), siteJs);

  const section = (await readText(path.join(TEMPLATES, "assistant-section.html")))
    .replace(/<!--[\s\S]*?-->\n?/, "")
    .replace("<Site name>", siteName)
    .replace("TODO: one sentence on what the assistant can do here.", "Tell me what you need in one sentence. I fill the form for you, and you check it before anything is sent.");
  await writeFile(path.join(outDir, "assistant-section.html"), section);

  const mounted = [];
  if (siteDir) {
    for (const p of [...new Set(placement.spots.map((s) => s.path))]) {
      const rel = p.replace(/^\//, "") || "index.html";
      const file = path.join(outDir, rel.endsWith("/") ? `${rel}index.html` : rel);
      const prefix = "../".repeat(rel.split("/").length - 1);
      await writeFile(file, mountInto(await readFile(file, "utf8"), section, prefix));
      mounted.push(p);
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
  return { ok, network, front, tools, spots: placement.spots, mounted, check: relCheck.trim(), files: await listFiles(outDir) };
}
