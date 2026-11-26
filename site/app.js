// MythAgentic website: scan a site, show its spots as a board, let the owner change
// Value and pick spots, then build and check the agent pack.
// Scores and decisions are recomputed here with the same rules the server uses.

import { decidePlan, PLACEMENTS, RULES } from "/src/score.js";
import { coverSvg } from "./covers.js";

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
  plan: [],
};

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
    state.values = {};
    state.filter = "all";
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
    <div class="toolbar">
      <div class="seg" role="toolbar" aria-label="Filter spots">${filters}</div>
      <span class="toolbar__hint">robots.txt ${site.robotsFound ? "respected" : "not found"} · ${site.size} site${skipped ? ` · ${skipped} pages skipped` : ""} · click a card for its evidence</span>
    </div>
    <div class="board" id="board"></div>`;
  renderBoard();
  renderBuildBar();
}

function renderBoard() {
  const list = state.plan.filter((d) => state.filter === "all" || d.decision === state.filter);
  $("#board").innerHTML = list.map((d) => {
    const s = d.spot;
    const on = state.approved.has(s.id);
    const line = d.fixes[0] ? `Fix: <em>${esc(d.fixes[0])}</em>` : esc(s.signals[0]?.text ?? "");
    return `
      <article class="spot d-${d.decision}">
        <button class="spot__cover" type="button" data-open="${esc(s.id)}" aria-label="See evidence for ${esc(s.label)}">
          ${coverSvg(s)}
          <span class="spot__peek">See evidence</span>
        </button>
        <div class="spot__body">
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
  bar.innerHTML = `<p class="buildbar__text"><b>${n}</b> of <b>${agents}</b> agent ${agents === 1 ? "spot" : "spots"} picked</p><button class="btn btn-primary" type="button" id="build" ${n === 0 ? "disabled" : ""}>Build agent pack</button>`;
}

/* ---------- Detail sheet ---------- */
function openSpot(id) {
  const d = state.plan.find((x) => x.spot.id === id);
  if (!d) return;
  const s = d.spot;
  const sc = s.scores;
  const value = state.values[s.id] ?? sc.value;
  const site = state.scan.site;
  const path = s.source?.path;
  const pageUrl = path && site.sample ? `/samples/${site.sample}${path}` : s.pages?.[0];
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
        <div class="sheet__cover">${coverSvg(s)}</div>
        ${site.sample && pageUrl ? `<div class="browser">${chrome(`${site.sample}.sample${path}`)}<iframe src="${esc(pageUrl)}" title="The page this spot is on" loading="lazy"></iframe></div>` : ""}
        ${pageUrl ? `<a class="btn btn-secondary btn-sm" href="${esc(pageUrl)}" target="_blank" rel="noopener">Open the page ↗</a>` : ""}
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
  if (!sheet.open) sheet.showModal();
}

/* ---------- Build ---------- */
async function build() {
  const sheet = $("#packsheet");
  sheet.innerHTML = `<div class="loading" style="padding:4rem 1.5rem"><div class="loader"></div><p>Writing the network, manifest and actions, then running the <em>official check</em>.</p></div>`;
  sheet.showModal();
  try {
    const r = await api("/api/pack", { scanId: state.scan.scanId, approved: [...state.approved], values: state.values });
    sheet.innerHTML = `
      <div class="sheet__bar"><span class="section-tag">Agent pack</span><button class="sheet__close" type="button" data-close aria-label="Close">×</button></div>
      <div class="pack-body">
        <h2 id="pack-title">${esc(state.scan.site.name)}, <em class="accent">agentified.</em></h2>
        <p class="result ${r.ok ? "result--ok" : "result--bad"}">${r.ok ? `<span class="pulse-dot"></span>Passed the official check: build_network.mjs --check` : "The official check found problems. See the output below."}</p>
        <div class="block"><h3>One front agent · ${r.tools.length} website tools</h3>
          <p class="hint" style="margin:0 0 .6rem">${esc(r.front)} in network ${esc(r.network)}</p>
          <div class="tools">${r.tools.map((t) => `<span class="chip">website_${esc(t)}</span>`).join("")}</div></div>
        ${r.mounted.length
          ? `<div class="block"><h3>Assistant added only to these pages</h3><div class="tools">${r.mounted.map((p) => `<span class="chip tone t-agent">${esc(p)}</span>`).join("")}</div></div>`
          : `<div class="block"><h3>How to add it to your site</h3><p class="hint" style="margin:0">Copy the files in the ZIP to your site's root folder. Add the section in assistant-section.html and the site.js script to the pages listed in placement.json.</p></div>`}
        ${r.openUrl ? `<div class="block"><h3>Try it</h3><ol class="numbered">
          <li>Open the agentified site.</li>
          <li>In the assistant, open <b>⚙ AI model settings</b> and add your own key. Use one with a <em>low spending limit</em>.</li>
          <li>Ask in one sentence, for example <em>"${esc(sampleQuery(r))}"</em>. You confirm before anything is sent.</li></ol></div>` : ""}
        <div class="actions">
          ${r.openUrl ? `<a class="btn btn-primary" href="${esc(r.openUrl)}" target="_blank" rel="noopener">Open the agentified site ↗</a>` : ""}
          <a class="btn btn-secondary" href="${esc(r.zipUrl)}" download>Download pack (.zip)</a>
        </div>
        <details><summary>Official check output</summary><pre class="check">${esc(r.check)}</pre></details>
      </div>`;
  } catch (error) {
    sheet.innerHTML = `<div class="sheet__bar"><span class="section-tag">Agent pack</span><button class="sheet__close" type="button" data-close aria-label="Close">×</button></div><div class="pack-body"><h2 id="pack-title">Could not build</h2><p class="result result--bad">${esc(error.message)}</p></div>`;
  }
}

function sampleQuery(r) {
  const form = r.spots.find((s) => s.kind === "form");
  if (!form) return "What should I choose?";
  const examples = {
    "/book.html": "Book me a cleaning in Makati next Friday at 10:00, I'm Ana Cruz, 0917 000 0000, ana@example.com",
    "/reserve.html": "Reserve Tour A for 2 people on 20 December, pickup at Sample Hotel, I'm Ana Cruz",
    "/quote.html": "Quote for a Bayani 3-seater in velvet, olive, delivered to Pampanga",
  };
  return examples[form.path] ?? `Fill in the ${form.title} form for me`;
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
    const t = event.target.closest("[data-sample],[data-go],[data-filter],[data-open],[data-toggle],[data-value],[data-close],#build");
    if (!t) return;
    if (t.dataset.sample) runScan({ sample: t.dataset.sample });
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
initTheme();
bind();
await renderSamples();
const deep = location.hash.match(/^#sample=([a-z]+)$/);
if (deep) runScan({ sample: deep[1] });
