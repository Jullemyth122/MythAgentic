// MythAgentic website: scan a site, show its spots as a board, let the owner change
// Value and pick spots, then build and check the agent pack.
// Scores and decisions are recomputed here with the same rules the server uses.

import { decidePlan, PLACEMENTS, RULES } from "/src/score.js";
import { coverSvg } from "./covers.js";
import { initTune } from "./tune.js";

const $ = (sel, root = document) => root.querySelector(sel);

/** Escapes text for HTML. */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const DECISIONS = {
  agent: { label: "Add an agent", short: "Agent" },
  plan_next: { label: "Plan next", short: "Plan next" },
  fix: { label: "Fix the page", short: "Fix" },
  fine: { label: "Fine as is", short: "Fine" },
  veto: { label: "Safety veto", short: "Veto" },
};
const PARTS = [
  { key: "friction", name: "Friction", up: true },
  { key: "value", name: "Value", up: true },
  { key: "fit", name: "Fit", up: true },
  { key: "effort", name: "Effort", up: false },
  { key: "risk", name: "Risk", up: false },
];

const state = {
  samples: [],
  scan: null, // { scanId, site, spots }
  values: {}, // spot id → owner's Value
  approved: new Set(),
  filter: "all",
  tab: "spots", // spots | pages
  plan: [],
  ai: { providers: {} }, // which providers have a key in the server's .env (never the key)
};

/* ---------- Where a spot is ---------- */
const FIND_TEXT = {
  form: "the form",
  table: "the table",
  question: "the first question",
  price: "the \"price on request\" text",
  page: "the whole page",
};

const pageOf = (p) => state.scan.site.pages.find((x) => x.path === p);

/** The scanned page as it was read, with the spot's part outlined. Scripts never run in it. */
function viewUrl(target, outline = true) {
  const q = new URLSearchParams({ path: target.path });
  const mark = outline && target.find && target.find !== "page";
  if (mark) { q.set("find", target.find); q.set("index", String(target.index)); }
  return `/api/view/${state.scan.scanId}?${q}${mark ? "#ma-target" : ""}`;
}

/** The real page: the sample's file, or the live URL. */
function realUrl(p) {
  const { site } = state.scan;
  return site.sample ? `/samples/${site.sample}${p}` : pageOf(p)?.url ?? `${site.origin}${p}`;
}

const hostLabel = () => (state.scan.site.sample ? `${state.scan.site.sample}.sample` : new URL(state.scan.site.origin).host);

/** A scaled-down live view of a page. Scaled by fitShots() to the box width. */
function shot(target, { outline = true, big = false } = {}) {
  return `<div class="shot ${big ? "shot--big" : ""}" data-shot><iframe src="${esc(viewUrl(target, outline))}" title="The page ${esc(target.path)} as it was read" ${big ? "" : 'loading="lazy" tabindex="-1" scrolling="no"'} sandbox referrerpolicy="no-referrer"></iframe></div>`;
}

/** Scales every page view to its box: a 1200px-wide page, shrunk to fit. */
function fitShots(root = document) {
  for (const box of root.querySelectorAll("[data-shot]")) {
    const frame = box.firstElementChild;
    const scale = box.clientWidth / 1200;
    if (!scale) continue;
    frame.style.transform = `scale(${scale})`;
    frame.style.height = `${Math.ceil(box.clientHeight / scale)}px`;
  }
}

/* ---------- AI key (stored where the assistant runtime reads it) ---------- */
// The agentify-website runtime keeps keys in localStorage under this name (runtime/byok.js).
// The packs are served from this same origin, so a key saved here is the key they use.
const BYOK_STORE = "nsweb-byok-profiles-v1";
const PROFILE_ID = "mythagentic";
const PROVIDERS = {
  gemini: {
    name: "Google Gemini", router: "/byok/gemini/v1", model: "gemini-3.5-flash-lite", env: "GEMINI_API_KEY",
    models: ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.1-flash-lite"],
    note: "Google AI Studio (free tier works). Goes through this server's relay, which passes the key on and never saves it. flash-lite is the fastest; the free tier has rate limits.",
  },
  meta: { name: "Meta Model API", router: "/byok/v1", model: "muse-ember-1.0", env: "META_API_KEY", models: ["muse-ember-1.0", "muse-wonder-1.0"], note: "Goes through this server's relay to api.meta.ai, so the browser has no CORS problem. The key is passed through, never saved on the server. Every model your key can use is listed below once the key is in." },
  openrouter: { name: "OpenRouter", router: "https://openrouter.ai/api/v1", model: "", note: "Your browser calls OpenRouter directly. Type the model id exactly as OpenRouter lists it." },
  custom: { name: "Other (OpenAI-compatible)", router: "", model: "", note: "Any server with the OpenAI chat/completions API. It must allow calls from this page (CORS)." },
};

function readStore() {
  try { return JSON.parse(localStorage.getItem(BYOK_STORE) || "null"); } catch { return null; }
}

/** The profile the assistant will use, if any. */
function savedProfile() {
  const store = readStore();
  return store?.profiles?.find((p) => p.id === store.selectedId) ?? null;
}

function writeProfile(profile) {
  const store = readStore() ?? { version: 1, profiles: [] };
  const now = new Date().toISOString();
  const others = (store.profiles ?? []).filter((p) => p.id !== PROFILE_ID);
  const profiles = profile ? [{ id: PROFILE_ID, runner: false, updatedAt: now, ...profile }, ...others].slice(0, 12) : others;
  const next = { version: 1, selectedId: profile ? PROFILE_ID : (others[0]?.id ?? ""), updatedAt: now, profiles };
  try { localStorage.setItem(BYOK_STORE, JSON.stringify(next)); } catch { throw new Error("This browser blocks saving (private mode?)."); }
}

function aiReady() {
  const p = savedProfile();
  return !!(p && p.key && p.key !== "demo");
}

const serverHasKey = (which) => !!state.ai.providers?.[which]?.serverKey;

/** The provider to offer first: one the server has a key for, Gemini before Meta. */
const defaultProvider = () => ["gemini", "meta"].find(serverHasKey) ?? "gemini";

/**
 * With no AI setup saved in this browser yet, use the key in the server's .env, so the
 * assistants work right away. The owner can change it any time in the AI key screen.
 */
function autoSetup() {
  if (savedProfile()) return;
  const which = ["gemini", "meta"].find(serverHasKey);
  if (!which) return;
  const v = PROVIDERS[which];
  try { writeProfile({ name: v.name, key: "server", model: v.model, router: v.router }); } catch { /* private mode */ }
}

function renderKeyButton() {
  const ready = aiReady();
  $("#key-dot").className = `key-dot ${ready ? "on" : ""}`;
  $("#key-label").textContent = ready ? `AI key · ${savedProfile().name ?? "set"}` : "Add AI key";
}

/* ---------- Theme ---------- */
function initTheme() {
  $("#theme").addEventListener("click", () => {
    const current = document.documentElement.dataset.theme
      ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* private mode */ }
  });
}

/* ---------- Server calls ---------- */
async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const label = (d) => (d.decision === "agent" || d.decision === "plan_next" ? PLACEMENTS[d.placement] : DECISIONS[d.decision].label);
const chrome = (text) => `<div class="chrome"><span class="dots"><i></i><i></i><i></i></span><span>${esc(text)}</span></div>`;

/* ---------- Home ---------- */
async function renderSamples() {
  state.samples = await api("/api/samples");
  $("#sample-grid").innerHTML = state.samples.map((s, i) => `
    <button class="sample" type="button" data-sample="${esc(s.id)}" aria-label="Scan ${esc(s.name)}">
      <div class="sample__frame">
        ${chrome(`${s.id}.sample${s.cover.replace(`/samples/${s.id}`, "")}`)}
        <div class="sample__shot"><iframe src="${esc(s.cover)}" title="${esc(s.name)} preview" loading="lazy" tabindex="-1" scrolling="no" style="height:${i === 0 ? 1120 : 460}px"></iframe></div>
      </div>
      <div class="sample__body">
        <div class="sample__top"><h3>${esc(s.name)}</h3><span class="sample__arrow">Scan →</span></div>
        <p>${esc(s.blurb)}</p>
        <div class="sample__tags">${s.tags.map((t) => `<span class="chip ${t === "No agent" ? "tone t-fine" : ""}">${esc(t)}</span>`).join("")}</div>
      </div>
    </button>`).join("");
}

function showHome() {
  $("#home").hidden = false;
  $("#results").hidden = true;
  $("#buildbar").hidden = true;
  history.replaceState(null, "", location.pathname);
}

/* ---------- Scan ---------- */
async function runScan(body) {
  $("#scan-error").hidden = true;
  $("#home").hidden = true;
  const results = $("#results");
  results.hidden = false;
  const name = body.sample ? state.samples.find((s) => s.id === body.sample)?.name : body.url;
  results.innerHTML = `
    <div class="loading">
      <div class="loader"></div>
      <p>Reading <em>${esc(name)}</em>. Measuring forms, tables, prices, hours and logins on every page.</p>
      <div class="loading__steps"><span class="chip">robots.txt</span><span class="chip">sitemap</span><span class="chip">pages</span><span class="chip">signals</span><span class="chip">score</span></div>
    </div>`;
  $("#buildbar").hidden = true;
  window.scrollTo({ top: 0 });
  try {
    state.scan = await api("/api/scan", body);
    tune.reset();
    state.values = {};
    state.filter = "all";
    state.tab = "spots";
    recompute(true);
    history.replaceState(null, "", body.sample ? `#sample=${body.sample}` : "#scan");
    renderResults();
  } catch (error) {
    showHome();
    const box = $("#scan-error");
    box.textContent = error.message;
    box.hidden = false;
    box.scrollIntoView({ block: "center" });
  }
}

/** Re-decides the plan with the owner's Values. On a new scan, picks every agent spot. */
function recompute(fresh = false) {
  const spots = state.scan.spots.map((s) => (state.values[s.id] ? { ...s, scores: { ...s.scores, value: state.values[s.id] } } : s));
  state.plan = decidePlan(spots, { size: state.scan.site.size });
  const agents = new Set(state.plan.filter((d) => d.decision === "agent").map((d) => d.spot.id));
  if (fresh) state.approved = new Set(agents);
  for (const id of [...state.approved]) if (!agents.has(id)) state.approved.delete(id);
}

function counts() {
  const c = { all: state.plan.length };
  for (const k of Object.keys(DECISIONS)) c[k] = state.plan.filter((d) => d.decision === k).length;
  return c;
}

function summary(c) {
  const pages = state.scan.site.pages.length;
  if (c.all === 0) return `No tasks to score on ${pages} ${pages === 1 ? "page" : "pages"}: no forms, long FAQs, price lists or tables. <em>Nothing here needs an agent.</em>`;
  const parts = [];
  if (c.agent) parts.push(`<em>${c.agent} ${c.agent === 1 ? "spot earns" : "spots earn"} an agent</em>`);
  if (c.plan_next) parts.push(`${c.plan_next} to plan next`);
  if (c.fix) parts.push(`${c.fix} ${c.fix === 1 ? "is a page fix" : "are page fixes"}, not AI`);
  if (c.veto) parts.push(`${c.veto} ${c.veto === 1 ? "is" : "are"} vetoed for safety`);
  if (c.fine) parts.push(`${c.fine} ${c.fine === 1 ? "is" : "are"} fine as ${c.fine === 1 ? "it is" : "they are"}`);
  if (!c.agent && !c.plan_next) return `${parts.join(", ")}. <em>No agent needed here</em>: AI would only add cost.`;
  return `${parts.join(", ")}.`;
}

function renderResults() {
  const { site } = state.scan;
  const c = counts();
  const filters = ["all", "agent", "plan_next", "fix", "veto", "fine"]
    .filter((k) => k === "all" || c[k] > 0)
    .map((k) => `<button type="button" data-filter="${k}" aria-pressed="${state.filter === k}">${k === "all" ? "All" : `<i class="lg ${k === "plan_next" ? "t-plan" : `t-${k}`}"></i>${DECISIONS[k].short}`}<span class="count">${c[k]}</span></button>`).join("");
  const notes = [];
  if (site.drawnByJs > 0 && site.drawnByJs >= site.pages.length / 2) notes.push(`${site.drawnByJs} of ${site.pages.length} pages are drawn by JavaScript, so the fast scanner sees little on them. The browser scanner is not built yet; treat this map as incomplete.`);
  const skipped = site.skipped.filter((s) => !/limit/.test(s.reason)).length;
  const metric = (labelText, value, tone = "") => `<div class="metric ${tone}"><span class="metric__label">${labelText}</span><span class="metric__value">${value}</span></div>`;
  $("#results").innerHTML = `
    <div class="results-head">
      <div>
        <div class="crumbs"><a href="#" data-go="home">← Scan another</a><span>·</span><span>${site.sample ? "Sample site, made up" : esc(site.origin)}</span><span>·</span><a href="${esc(site.preview)}" target="_blank" rel="noopener">Open site ↗</a></div>
        <h1>${esc(site.name)}</h1>
        <p class="summary">${summary(c)}</p>
      </div>
      <div class="metrics">
        ${metric("Pages read", site.pages.length)}
        ${metric("Layouts", site.groups.length)}
        ${metric("Agent spots", c.agent, "t-agent")}
        ${metric("Page fixes", c.fix, "t-fix")}
        ${metric("Vetoes", c.veto, "t-veto")}
      </div>
      ${notes.map((n) => `<p class="notice">${esc(n)}</p>`).join("")}
    </div>
    <ol class="howline" aria-label="How this result was made">
      <li><b>1 · Read</b><span>${site.pages.length} ${site.pages.length === 1 ? "page" : "pages"} over plain HTTP${site.robotsFound ? ", robots.txt respected" : ""}. No AI.</span></li>
      <li><b>2 · Measure</b><span>Code counts forms, fields, tables, questions, prices, hours and logins on each page.</span></li>
      <li><b>3 · Score</b><span>(Friction × Value × Fit) ÷ (Effort × Risk), then written rules. No AI.</span></li>
      <li><b>4 · Build</b><span>AI runs only in the assistant you build, with your <a href="#" data-key>AI key</a>. <a href="#" data-tune>Improve with AI</a> lets it write the assistant's words from this scan.</span></li>
    </ol>
    <div class="toolbar">
      <div class="seg" role="tablist" aria-label="View">
        <button type="button" data-tab="spots" aria-pressed="${state.tab === "spots"}">Spots<span class="count">${c.all}</span></button>
        <button type="button" data-tab="pages" aria-pressed="${state.tab === "pages"}">Pages read<span class="count">${site.pages.length}</span></button>
      </div>
      ${state.tab === "spots" ? `<div class="seg" role="toolbar" aria-label="Filter spots">${filters}</div>` : ""}
      <span class="toolbar__hint">${state.tab === "spots" ? "The pink outline on each card is the exact part of the page it is about" : "Every page the scanner read, and what it measured there"}${skipped ? ` · ${skipped} pages skipped` : ""}</span>
    </div>
    <div class="${state.tab === "spots" ? "board" : "pages"}" id="board"></div>`;
  if (state.tab === "spots") renderBoard(); else renderPages();
  renderBuildBar();
}

/** One row per page read, with what was measured on it. */
function renderPages() {
  const spotsOn = (p) => state.plan.filter((d) => d.spot.target?.path === p.path);
  $("#board").innerHTML = state.scan.site.pages.map((p) => {
    const facts = [
      `${p.words} words`,
      p.questions ? `${p.questions} ${p.questions === 1 ? "question" : "questions"}` : "",
      ...p.forms.map((f) => `${f.password ? "Login form" : "Form"}: ${f.fields} fields`),
      ...p.tables.map((t) => `Table ${t.rows}×${t.cols}`),
      p.priceOnRequest ? "Price on request" : "",
      p.pricesShown ? `${p.pricesShown} prices` : "",
      p.hasHours ? "Opening hours" : "",
      p.needsBrowser ? "Drawn by JavaScript" : "",
    ].filter(Boolean);
    const spots = spotsOn(p);
    return `
      <button class="pagerow" type="button" data-page="${esc(p.path)}">
        <span class="pagerow__path">${esc(p.path)}</span>
        <span class="pagerow__title">${esc(p.h1 || p.title || "(no title)")}</span>
        <span class="pagerow__facts">${facts.map((f) => `<span class="chip">${esc(f)}</span>`).join("")}</span>
        <span class="pagerow__spots">${spots.map((d) => `<span class="chip tone d-${d.decision}">${esc(DECISIONS[d.decision].short)}</span>`).join("") || '<span class="muted">No spot</span>'}</span>
      </button>`;
  }).join("");
}

/** A page as it was read, with everything measured on it. */
function openPage(p) {
  const page = pageOf(p);
  if (!page) return;
  const sheet = $("#pagesheet");
  const spots = state.plan.filter((d) => d.spot.target?.path === p);
  if ($("#sheet").open) $("#sheet").close();
  sheet.innerHTML = `
    <div class="sheet__bar"><span class="section-tag">Page read · ${esc(hostLabel())}</span><button class="sheet__close" type="button" data-close aria-label="Close">×</button></div>
    <div class="sheet__grid">
      <div class="sheet__media">
        <div class="browser">${chrome(`${hostLabel()}${p}`)}${shot({ path: p, find: "page", index: 0 }, { outline: false, big: true })}</div>
        <a class="btn btn-secondary btn-sm" href="${esc(realUrl(p))}" target="_blank" rel="noopener">Open the real page ↗</a>
      </div>
      <div class="sheet__body">
        <div><h2 id="page-title">${esc(page.h1 || page.title || p)}</h2><p class="hint">${esc(p)} · ${page.words} words${page.needsBrowser ? " · drawn by JavaScript, so the scanner saw little" : ""}</p></div>
        <div class="block"><h3>What the scanner measured</h3><ul class="checks">
          ${page.forms.map((f) => `<li>${f.password ? "A login form" : "A form"} with ${f.fields} fields${f.submit ? `, button "${esc(f.submit)}"` : ""}</li>`).join("")}
          ${page.tables.map((t) => `<li>A table, ${t.rows} rows × ${t.cols} columns</li>`).join("")}
          <li>${page.questions} headings that are questions</li>
          ${page.priceOnRequest ? `<li>"Price on request" ${page.priceOnRequest} times</li>` : ""}
          ${page.pricesShown ? `<li>${page.pricesShown} prices shown</li>` : ""}
          <li>${page.hasHours ? "Opening hours shown" : "No opening hours"}</li>
        </ul></div>
        ${page.headings.length ? `<div class="block"><h3>Headings it read</h3><ul class="headings">${page.headings.map((h) => `<li>${esc(h)}</li>`).join("")}</ul></div>` : ""}
        <div class="block"><h3>Spots on this page</h3>${spots.length ? spots.map((d) => `<button class="rule-row linkrow" type="button" data-open="${esc(d.spot.id)}"><span class="chip tone d-${d.decision}">${esc(DECISIONS[d.decision].short)}</span><span>${esc(d.spot.label)}</span></button>`).join("") : '<p class="hint">None: nothing here scored as a task.</p>'}</div>
      </div>
    </div>`;
  if (!sheet.open) sheet.showModal();
  fitShots(sheet);
}

function renderBoard() {
  const list = state.plan.filter((d) => state.filter === "all" || d.decision === state.filter);
  $("#board").innerHTML = list.map((d) => {
    const s = d.spot;
    const on = state.approved.has(s.id);
    const line = d.fixes[0] ? `Fix: <em>${esc(d.fixes[0])}</em>` : esc(s.signals[0]?.text ?? "");
    const t = s.target;
    const live = t && !pageOf(t.path)?.needsBrowser;
    return `
      <article class="spot d-${d.decision}">
        <button class="spot__cover ${live ? "spot__cover--shot" : ""}" type="button" data-open="${esc(s.id)}" aria-label="See evidence for ${esc(s.label)}">
          ${live ? shot(t) : coverSvg(s)}
          <span class="spot__peek">See evidence</span>
        </button>
        <div class="spot__body">
          ${t ? `<p class="spot__where"><span class="pin"></span>${esc(FIND_TEXT[t.find])} on <b>${esc(t.path)}</b></p>` : ""}
          <div class="spot__top"><span class="chip tone">${esc(label(d))}</span><span class="prio"><b>${Math.round(d.priority)}</b> / 125</span></div>
          <h3>${esc(s.label)}</h3>
          <p>${line}</p>
          <div class="spot__foot">
            <span class="rules">${d.rules.map((r) => `<span class="rule-id" title="${esc(RULES[r])}">${esc(r)}</span>`).join("")}</span>
            ${d.decision === "agent" ? `<button class="toggle" type="button" data-toggle="${esc(s.id)}" aria-pressed="${on}">${on ? "Building" : "Build"}</button>` : `<span class="chip">${d.confidence === "low" ? "Low confidence" : `${s.signals.length} signals`}</span>`}
          </div>
        </div>
      </article>`;
  }).join("");
  fitShots($("#board"));
}

function renderBuildBar() {
  const bar = $("#buildbar");
  const agents = state.plan.filter((d) => d.decision === "agent").length;
  const n = state.approved.size;
  bar.hidden = false;
  if (agents === 0) {
    bar.innerHTML = `<p class="buildbar__text"><em>Nothing to build.</em> This site needs no agent.</p><a class="btn btn-secondary btn-sm" href="#" data-go="home">Scan another</a>`;
    return;
  }
  bar.innerHTML = `<p class="buildbar__text"><b>${n}</b> of <b>${agents}</b> agent ${agents === 1 ? "spot" : "spots"} picked${state.tuning ? ` · <span class="chip tone t-agent">✦ your words</span>` : ""}</p><button class="btn btn-secondary" type="button" data-tune ${n === 0 ? "disabled" : ""}>✦ Improve with AI</button><button class="btn btn-primary" type="button" id="build" ${n === 0 ? "disabled" : ""}>Build agent pack</button>`;
}

/* ---------- Detail sheet ---------- */
function openSpot(id) {
  const d = state.plan.find((x) => x.spot.id === id);
  if (!d) return;
  const s = d.spot;
  const sc = s.scores;
  const value = state.values[s.id] ?? sc.value;
  const site = state.scan.site;
  const t = s.target;
  const live = t && !pageOf(t.path)?.needsBrowser;
  const parts = PARTS.map((p) => `
    <div class="part ${p.up ? "part--up" : ""}">
      <span class="part__name">${p.name}<small>${p.up ? "raises" : "lowers"}</small></span>
      <span class="part__bar">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= sc[p.key] ? "on" : ""}"></i>`).join("")}</span>
      <span class="part__val">${sc[p.key]}</span>
      <p class="part__why">${esc(s.why?.[p.key] ?? "")}</p>
    </div>`).join("");
  const sheet = $("#sheet");
  sheet.className = `sheet d-${d.decision}`;
  sheet.innerHTML = `
    <div class="sheet__bar"><span class="section-tag">Spot · ${esc(site.name)}</span><button class="sheet__close" type="button" data-close aria-label="Close">×</button></div>
    <div class="sheet__grid">
      <div class="sheet__media">
        ${t ? `<p class="spot__where spot__where--big"><span class="pin"></span>Outlined in pink: ${esc(FIND_TEXT[t.find])} on <b>${esc(t.path)}</b></p>` : ""}
        ${live ? `<div class="browser">${chrome(`${hostLabel()}${t.path}`)}${shot(t, { big: true })}</div>` : `<div class="sheet__cover">${coverSvg(s)}</div>`}
        ${s.source?.pages?.length > 1 ? `<div class="block"><h3>Pages this covers</h3><div class="tools">${s.source.pages.map((p) => `<button class="chip" type="button" data-page="${esc(p.path)}">${esc(p.path)} · ${p.questions} q</button>`).join("")}</div></div>` : ""}
        ${t ? `<a class="btn btn-secondary btn-sm" href="${esc(realUrl(t.path))}" target="_blank" rel="noopener">Open the real page ↗</a>` : ""}
      </div>
      <div class="sheet__body">
        <div>
          <span class="chip tone">${esc(label(d))}</span>
          <h2 id="sheet-title">${esc(s.label)}</h2>
          ${d.note ? `<p class="note">${esc(d.note)}</p>` : ""}
        </div>
        <div class="equation">
          <span class="equation__big">${Math.round(d.priority)}<small> / 125 priority</small></span>
          <span class="equation__math">(${sc.friction} × ${sc.value} × ${sc.fit}) ÷ (${sc.effort} × ${sc.risk}) = ${d.priority.toFixed(1)}<br><em>An agent needs 20 or more, with Fit 3 or more</em></span>
        </div>
        <div class="parts">${parts}</div>
        <div class="block"><h3>Measured evidence</h3><ul class="checks">${s.signals.map((x) => `<li>${esc(x.text)}</li>`).join("")}</ul>
          ${d.confidence === "low" ? `<p class="hint low">Low confidence: fewer than two measured signals (rule R5).</p>` : ""}</div>
        ${d.fixes.length ? `<div class="block"><h3>Fix on the page</h3><ul class="checks fixes">${d.fixes.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
        <div class="block"><h3>Rules that decided it</h3>${d.rules.map((r) => `<div class="rule-row"><span class="rule-id">${esc(r)}</span><span>${esc(RULES[r])}</span></div>`).join("")}</div>
        <div class="block"><h3>How important is this task to your business?</h3>
          <div class="seg" role="group" aria-label="Value from 1 to 5">${[1, 2, 3, 4, 5].map((v) => `<button type="button" data-value="${v}" aria-pressed="${v === value}">${v}</button>`).join("")}</div>
          <p class="hint">This is the Value score${value !== s.scores.value ? "" : ""}. Changing it re-runs the same formula and rules. Vetoes still apply.</p>
        </div>
        ${d.decision === "agent" ? `<div><button class="btn ${state.approved.has(s.id) ? "btn-secondary" : "btn-primary"}" type="button" data-toggle="${esc(s.id)}">${state.approved.has(s.id) ? "Don't build this one" : "Build this one"}</button></div>` : ""}
      </div>
    </div>`;
  sheet.dataset.spot = id;
  if ($("#pagesheet").open) $("#pagesheet").close();
  if (!sheet.open) sheet.showModal();
  fitShots(sheet);
}

/* ---------- Build ---------- */
async function build() {
  const sheet = $("#packsheet");
  sheet.innerHTML = `<div class="loading" style="padding:4rem 1.5rem"><div class="loader"></div><p>Writing the network, manifest and actions, then running the <em>official check</em>.</p></div>`;
  sheet.showModal();
  try {
    const r = await api("/api/pack", { scanId: state.scan.scanId, approved: [...state.approved], values: state.values, tuning: state.tuning });
    state.pack = { ...r, page: r.previews?.[0]?.path ?? null, side: "after" };
    sheet.classList.toggle("sheet--narrow", !r.previews?.length);
    sheet.innerHTML = `
      <div class="sheet__bar"><span class="section-tag">Agent pack</span><button class="sheet__close" type="button" data-close aria-label="Close">×</button></div>
      <div class="pack-body">
        <h2 id="pack-title">${esc(state.scan.site.name)}, <em class="accent">agentified.</em></h2>
        <p class="result ${r.ok ? "result--ok" : "result--bad"}">${r.ok ? `<span class="pulse-dot"></span>Passed the official check: build_network.mjs --check` : "The official check found problems. See the output below."}</p>
        ${r.companion ? "" : `<ol class="flow" aria-label="How the assistant works on your site">
          <li><b>1</b><span><strong>Ask ${esc(state.scan.site.name)}</strong> button on every page opens the side panel.</span></li>
          <li><b>2</b><span><strong>Ask bar</strong> right above ${esc(r.spots.map((s) => (s.kind === "form" ? "the form" : s.kind === "compare" ? "the table" : "the questions")).join(" and "))}${r.tuned ? ", in your words" : ""}. One click asks.</span></li>
          <li><b>3</b><span>It answers from your pages and <strong>highlights</strong> the part it used.${r.spots.some((s) => s.kind === "form") ? " Forms: it fills, the visitor confirms." : ""}</span></li>
        </ol>`}
        ${r.previews?.length ? `<div class="compare" id="compare"></div>` : ""}
        <div class="block"><h3>One front agent · ${r.tools.length} website tools</h3>
          <p class="hint" style="margin:0 0 .6rem">${esc(r.front)} in network ${esc(r.network)}</p>
          <div class="tools">${r.tools.map((t) => `<span class="chip">website_${esc(t)}</span>`).join("")}</div></div>
        ${r.companion
          ? `<div class="block"><h3>What you got: a companion assistant</h3><p class="hint" style="margin:0">MythAgentic cannot change ${esc(state.scan.site.origin)}, so this is the official <em>live URL mode</em>: a separate page whose assistant answers from a snapshot of your ${state.scan.site.pages.length} public pages, compares your tables, and links visitors to the real page to finish. To put the assistant <em>on</em> your site so it can fill your forms, scan your site's own files (source mode).</p></div>`
          : r.mirror
            ? `<div class="block"><h3>What you got</h3><p class="hint" style="margin:0">A <em>preview copy</em> of your ${state.scan.site.pages.length} scanned pages with the assistant added: an <b>Ask</b> button on every page opens it in a side panel, and an Ask bar sits right at each part of the page that scored (the form, the table, the questions). While it answers, it scrolls your page to the part it used and highlights it. The copy uses your own HTML and styles; your page scripts are off, so parts drawn by JavaScript stay empty, and forms send nothing. The ZIP holds the files to add to your real site.</p></div>`
            : `<div class="block"><h3>Assistant added only to these pages</h3><div class="tools">${r.mounted.map((p) => `<span class="chip tone t-agent">${esc(p)}</span>`).join("")}</div></div>`}
        <div class="block"><h3>Try it</h3><ol class="numbered">
          <li>${aiReady() ? `AI key saved: <b>${esc(savedProfile().name)}</b>. <a href="#" data-key>Change</a>` : `<a href="#" data-key><b>Add your AI key</b></a> (Gemini, Meta or OpenRouter). Use one with a <em>low spending limit</em>.`}</li>
          <li>${r.previews?.length ? "Chat right in the <b>After</b> view above, or open it in its own tab." : `Open the ${r.companion ? "companion assistant" : "agentified site"}.`} Press <b>Ask ${esc(state.scan.site.name)}</b> at the bottom right, or a button in an Ask bar on the page.</li>
          <li>Ask in one sentence, for example <em>"${esc(sampleQuery(r))}"</em>.${r.companion ? "" : " You confirm before anything is sent."}</li></ol></div>
        <div class="actions">
          <a class="btn btn-primary" href="${esc(r.openUrl)}" target="_blank" rel="noopener">Open the ${r.companion ? "companion assistant" : "agentified site"} ↗</a>
          <a class="btn btn-secondary" href="${esc(r.zipUrl)}" download>Download pack (.zip)</a>
        </div>
        <details><summary>Official check output</summary><pre class="check">${esc(r.check)}</pre></details>
      </div>`;
    renderCompare();
  } catch (error) {
    sheet.innerHTML = `<div class="sheet__bar"><span class="section-tag">Agent pack</span><button class="sheet__close" type="button" data-close aria-label="Close">×</button></div><div class="pack-body"><h2 id="pack-title">Could not build</h2><p class="result result--bad">${esc(error.message)}</p></div>`;
  }
}

/** Before and after, side by side in one frame: the page as scanned, and with its assistant. */
function renderCompare() {
  const box = $("#compare");
  const pack = state.pack;
  if (!box || !pack?.previews?.length) return;
  const preview = pack.previews.find((p) => p.path === pack.page) ?? pack.previews[0];
  const src = pack.side === "before" ? preview.before : preview.after;
  box.innerHTML = `
    <div class="compare__bar">
      <div class="seg" role="group" aria-label="Before or after">
        <button type="button" data-side="before" aria-pressed="${pack.side === "before"}">Before</button>
        <button type="button" data-side="after" aria-pressed="${pack.side === "after"}"><i class="lg t-agent"></i>After: with its agent</button>
      </div>
      ${pack.previews.length > 1 ? `<div class="seg" role="group" aria-label="Page">${pack.previews.map((p) => `<button type="button" data-preview="${esc(p.path)}" aria-pressed="${p.path === preview.path}">${esc(p.path)}</button>`).join("")}</div>` : ""}
      <a class="btn btn-secondary btn-sm" href="${esc(preview.after)}" target="_blank" rel="noopener">Open in a new tab ↗</a>
    </div>
    <div class="browser">${chrome(`${hostLabel()}${preview.path}${pack.side === "after" ? "  ·  agentified preview" : "  ·  as scanned"}`)}
      <iframe class="compare__frame" src="${esc(src)}" title="${pack.side === "after" ? "The page with its assistant" : "The page as scanned"}" ${pack.side === "before" ? "sandbox" : ""}></iframe>
    </div>
    <p class="hint" style="margin:0">${pack.side === "after"
      ? "Your page with its assistant. Use the Ask bar on the page, or the <b>Ask</b> button at the bottom right, and chat with it here."
      : "The page as MythAgentic read it, before any assistant was added."}</p>`;
}

function sampleQuery(r) {
  const form = r.spots.find((s) => s.kind === "form");
  if (r.companion) {
    if (form) return `What do I need to fill in the ${form.title} form?`;
    const answers = r.spots.find((s) => s.kind === "answers");
    return answers ? `What does the site say about ${answers.title}?` : "Which option fits me best?";
  }
  if (!form) return "What should I choose?";
  const examples = {
    "/book.html": "Book me a cleaning at the Riverside branch next Friday at 10:00, I'm Alex Morgan, (555) 010-0000, alex@example.com",
    "/reserve.html": "Reserve Tour A for 2 people on 20 December, pickup at Sample Hotel, I'm Alex Morgan",
    "/quote.html": "Quote for a Harbor 3-seater in velvet, olive, delivered to Springfield",
    "/shift-swap.html": "Swap my opening shift next Monday with Sam, it's for school",
    "/damage-report.html": "Parcel SL-1234-5678 was wet at Dock 2 receiving, I took a photo, I'm Sam, morning shift",
    "/leave.html": "Vacation leave from March 3 to March 5, 3 working days, Team Orion, my lead is Casey",
  };
  return examples[form.path] ?? `Fill in the ${form.title} form for me`;
}

/* ---------- AI key sheet ---------- */
function openKeySheet() {
  const sheet = $("#keysheet");
  const p = savedProfile();
  const current = p
    ? Object.keys(PROVIDERS).find((k) => PROVIDERS[k].router && PROVIDERS[k].router === p.router) ?? "custom"
    : defaultProvider();
  const keyNote = (which) => {
    const v = PROVIDERS[which];
    if (!v.env) return "Paste your key. It is saved in this browser only.";
    return serverHasKey(which)
      ? `This server has a key in its .env file (${v.env}). Leave the box empty to use it, or paste another key to override it in this browser.`
      : `No key on this server. Paste yours, or put ${v.env}=… in a .env file next to package.json and restart npm start.`;
  };
  const placeholder = (which) => (serverHasKey(which) ? "Empty = use the server's .env key" : "Paste your key");
  sheet.innerHTML = `
    <div class="sheet__bar"><span class="section-tag">AI key</span><button class="sheet__close" type="button" data-close aria-label="Close">×</button></div>
    <form class="pack-body keyform" id="keyform">
      <h2 id="key-title">Connect an <em class="accent">AI model.</em></h2>
      <p class="hint" style="margin:0">Scanning and scoring never use AI. The key is only for the assistants you build: they run in your browser and call the model with this key. It is saved in this browser only (the assistant runtime's own storage), never in a pack, URL or file.</p>
      <label class="field"><span>Provider</span>
        <select id="key-provider">${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}" ${k === current ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select>
      </label>
      <p class="hint" id="key-provider-note" style="margin:-.4rem 0 0">${esc(PROVIDERS[current].note)}</p>
      <label class="field" id="key-router-field" ${current === "custom" ? "" : "hidden"}><span>Router URL</span><input id="key-router" type="url" placeholder="https://…/v1" value="${esc(current === "custom" ? p?.router ?? "" : "")}"></label>
      <label class="field"><span>Model</span><input id="key-model" type="text" required list="key-models" value="${esc(p?.model || PROVIDERS[current].model)}" placeholder="model id"></label>
      <div class="modelchips" id="key-modelchips" aria-live="polite"></div>
      <datalist id="key-models">${(PROVIDERS[current].models ?? []).map((m) => `<option value="${esc(m)}">`).join("")}</datalist>
      <label class="field"><span>API key</span><input id="key-key" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder(current))}" value="${esc(p?.key && p.key !== "server" ? p.key : "")}"></label>
      <p class="hint" id="key-note" style="margin:-.4rem 0 0">${esc(keyNote(current))} Use a key with a low spending limit.</p>
      <p class="result" id="key-result" hidden></p>
      <div class="actions">
        <button class="btn btn-primary" type="submit">Save and test</button>
        <button class="btn btn-secondary" type="button" id="key-remove" ${p ? "" : "hidden"}>Remove key</button>
      </div>
    </form>`;
  if (!sheet.open) sheet.showModal();
  $("#key-provider").addEventListener("change", (e) => {
    const v = PROVIDERS[e.target.value];
    $("#key-provider-note").textContent = v.note;
    $("#key-router-field").hidden = e.target.value !== "custom";
    $("#key-model").value = v.model;
    $("#key-models").innerHTML = (v.models ?? []).map((m) => `<option value="${esc(m)}">`).join("");
    $("#key-key").placeholder = placeholder(e.target.value);
    $("#key-note").textContent = `${keyNote(e.target.value)} Use a key with a low spending limit.`;
  });
  $("#key-provider").addEventListener("change", () => listModels());
  $("#key-key").addEventListener("change", () => listModels());
  $("#key-modelchips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-model]");
    if (!b) return;
    $("#key-model").value = b.dataset.model;
    for (const c of $("#key-modelchips").querySelectorAll("[data-model]")) c.setAttribute("aria-pressed", String(c === b));
  });
  listModels();
  $("#key-remove")?.addEventListener("click", () => { writeProfile(null); renderKeyButton(); openKeySheet(); });
  $("#keyform").addEventListener("submit", saveKey);
}

/**
 * Lists the models the provider offers to this key (GET {router}/models), as buttons.
 * "-contributor" models are never offered (project rule).
 */
async function listModels() {
  const box = $("#key-modelchips");
  if (!box) return;
  const which = $("#key-provider").value;
  const router = which === "custom" ? $("#key-router").value.trim().replace(/\/$/, "") : PROVIDERS[which].router;
  const saved = savedProfile();
  const key = $("#key-key").value.trim() || (saved?.router === router ? saved.key : "") || (serverHasKey(which) ? "server" : "");
  if (!router || !key) { box.innerHTML = ""; return; }
  box.innerHTML = `<span class="hint">Asking ${esc(PROVIDERS[which].name)} which models this key can use…</span>`;
  try {
    const res = await fetch(`${router}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const ids = (body.data ?? body.models ?? []).map((m) => String(m.id ?? m.name ?? "").replace(/^models\//, ""))
      .filter((id) => id && !/-contributor/i.test(id)).sort();
    if ($("#key-provider").value !== which) return; // the owner switched provider meanwhile
    if (!ids.length) { box.innerHTML = `<span class="hint">The provider listed no models for this key.</span>`; return; }
    const current = $("#key-model").value.trim();
    // Gemini also lists speech, image and embedding models, which cannot chat.
    const shown = which === "gemini" ? ids.filter((id) => /^gemini/.test(id) && !/tts|embedding|image|audio|live|computer-use|robotics/.test(id)) : ids;
    box.innerHTML = `<span class="hint">${shown.length} models on this key. Pick one:</span>${shown.slice(0, 40).map((id) => `<button type="button" class="chip modelchip" data-model="${esc(id)}" aria-pressed="${id === current}">${esc(id)}</button>`).join("")}`;
    $("#key-models").innerHTML = shown.map((m) => `<option value="${esc(m)}">`).join("");
  } catch (error) {
    box.innerHTML = `<span class="hint">Could not list models (${esc(error.message)}). You can still type a model id.</span>`;
  }
}

async function saveKey(event) {
  event.preventDefault();
  const which = $("#key-provider").value;
  const provider = PROVIDERS[which];
  const router = which === "custom" ? $("#key-router").value.trim().replace(/\/$/, "") : provider.router;
  const model = $("#key-model").value.trim();
  let key = $("#key-key").value.trim();
  const out = $("#key-result");
  const show = (ok, text) => { out.hidden = false; out.className = `result ${ok ? "result--ok" : "result--bad"}`; out.textContent = text; };
  if (!key && serverHasKey(which)) key = "server";
  if (!key) return show(false, "Paste a key first.");
  if (!router) return show(false, "Type the router URL.");
  try {
    writeProfile({ name: provider.name, key, model, router });
  } catch (error) {
    return show(false, error.message);
  }
  renderKeyButton();
  $("#key-remove").hidden = false;
  show(true, "Saved. Testing it with a one-word request…");
  try {
    const res = await fetch(`${router}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with the single word OK." }], max_tokens: 20 }),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    if (res.ok) return show(true, `Saved and working: ${provider.name}, ${model}. Open any pack and its assistant uses it.`);
    let message = text;
    try {
      const parsed = JSON.parse(text);
      const j = Array.isArray(parsed) ? parsed[0] : parsed; // Gemini wraps errors in a list
      message = j.error?.message ?? j.error ?? j.message ?? text;
    } catch { /* plain text */ }
    show(false, `Saved, but the test failed (HTTP ${res.status}): ${String(message).slice(0, 220)}`);
  } catch (error) {
    show(false, `Saved, but the test could not reach ${router}: ${error.message}`);
  }
}

/* ---------- Events ---------- */
function bind() {
  $("#scan-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const url = $("#url").value.trim();
    if (!$("#permission").checked) {
      const box = $("#scan-error");
      box.textContent = "Tick the box to confirm you own this site or may scan it.";
      box.hidden = false;
      return;
    }
    runScan({ url, permission: true });
  });

  document.addEventListener("click", (event) => {
    const t = event.target.closest("[data-sample],[data-go],[data-filter],[data-tab],[data-page],[data-key],[data-side],[data-preview],[data-open],[data-toggle],[data-value],[data-close],#build");
    if (!t) return;
    if (t.hasAttribute("data-key")) { event.preventDefault(); openKeySheet(); }
    else if (t.dataset.side) { state.pack.side = t.dataset.side; renderCompare(); }
    else if (t.dataset.preview) { state.pack.page = t.dataset.preview; renderCompare(); }
    else if (t.dataset.tab) { state.tab = t.dataset.tab; renderResults(); }
    else if (t.dataset.page) openPage(t.dataset.page);
    else if (t.dataset.sample) runScan({ sample: t.dataset.sample });
    else if (t.dataset.go === "home") { event.preventDefault(); showHome(); window.scrollTo({ top: 0 }); }
    else if (t.dataset.filter) { state.filter = t.dataset.filter; renderResults(); }
    else if (t.dataset.open) openSpot(t.dataset.open);
    else if (t.dataset.toggle) {
      const id = t.dataset.toggle;
      if (state.approved.has(id)) state.approved.delete(id); else state.approved.add(id);
      renderBoard();
      renderBuildBar();
      if ($("#sheet").open) openSpot(id);
    } else if (t.dataset.value) {
      const id = $("#sheet").dataset.spot;
      const original = state.scan.spots.find((s) => s.id === id).scores.value;
      const v = Number(t.dataset.value);
      if (v === original) delete state.values[id]; else state.values[id] = v;
      const wasAgent = state.plan.find((d) => d.spot.id === id)?.decision === "agent";
      recompute();
      const isAgent = state.plan.find((d) => d.spot.id === id)?.decision === "agent";
      if (isAgent && !wasAgent) state.approved.add(id);
      renderResults();
      openSpot(id);
    } else if (t.hasAttribute("data-close")) t.closest("dialog").close();
    else if (t.id === "build") build();
  });

  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  }
}

/* ---------- Start ---------- */
const tune = initTune({ $, esc, state, savedProfile, aiReady, openKeySheet, renderBuildBar, build });
initTheme();
bind();
renderKeyButton();
api("/api/ai-status").then((ai) => { state.ai = ai; autoSetup(); renderKeyButton(); }).catch(() => {});
let resizeTimer;
addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => fitShots(), 120); });
addEventListener("storage", renderKeyButton);
await renderSamples();
const deep = location.hash.match(/^#sample=([a-z]+)$/);
if (deep) runScan({ sample: deep[1] });
