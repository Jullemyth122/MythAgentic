// MythAgentic website: scan a site, show its spots as a gallery, let the owner change
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
const PART_NAMES = { friction: "Friction", value: "Value", fit: "Fit", effort: "Effort", risk: "Risk" };

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
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch { /* private mode */ }
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
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

/* ---------- Home ---------- */
async function renderSamples() {
  state.samples = await api("/api/samples");
  const heights = { clinic: 520, tours: 420, shop: 470, clear: 380 };
  $("#sample-grid").innerHTML = state.samples.map((s) => `
    <button class="tile" type="button" data-sample="${esc(s.id)}" aria-label="Scan ${esc(s.name)}">
      <div class="tile-media" style="height:${heights[s.id] ?? 420}px">
        <iframe src="${esc(s.cover)}" title="${esc(s.name)} preview" loading="lazy" tabindex="-1" style="height:${(heights[s.id] ?? 420) * 2}px"></iframe>
        <div class="tile-overlay"><span>${esc(s.tags[0])}</span><span>Scan this site →</span></div>
      </div>
      <h3>${esc(s.name)}</h3>
      <p>${esc(s.blurb)}</p>
      <div class="tags">${s.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
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
  results.innerHTML = `<div class="loading"><div class="spinner"></div>Reading ${esc(body.sample ? state.samples.find((s) => s.id === body.sample)?.name : body.url)}… measuring forms, tables and pages.</div>`;
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
  const parts = [];
  if (c.agent) parts.push(`${c.agent} ${c.agent === 1 ? "spot gets" : "spots get"} an agent`);
  if (c.plan_next) parts.push(`${c.plan_next} to plan next`);
  if (c.fix) parts.push(`${c.fix} ${c.fix === 1 ? "page fix" : "page fixes"} instead of AI`);
  if (c.veto) parts.push(`${c.veto} safety ${c.veto === 1 ? "veto" : "vetoes"}`);
  if (c.fine) parts.push(`${c.fine} fine as ${c.fine === 1 ? "it is" : "they are"}`);
  if (c.all === 0) return `No tasks found to score on ${state.scan.site.pages.length} ${state.scan.site.pages.length === 1 ? "page" : "pages"}: no forms, long FAQs, price lists or tables. Nothing here needs an agent.`;
  if (!c.agent && !c.plan_next) return `No agent needed here. ${parts.join(", ")}. That is a good result: AI would only add cost.`;
  return `${parts.join(", ")}.`;
}

function renderResults() {
  const { site } = state.scan;
  const c = counts();
  const chips = ["all", "agent", "plan_next", "fix", "veto", "fine"]
    .filter((k) => k === "all" || c[k] > 0)
    .map((k) => `<button class="chip" type="button" data-filter="${k}" aria-pressed="${state.filter === k}">${k === "all" ? "All" : DECISIONS[k].short}<span class="count">${c[k]}</span></button>`).join("");
  const notes = [];
  if (site.drawnByJs > 0 && site.drawnByJs >= site.pages.length / 2) notes.push(`${site.drawnByJs} of ${site.pages.length} pages are drawn by JavaScript, so the fast scanner sees little on them. The browser scanner is not built yet; treat this map as incomplete.`);
  const skipped = site.skipped.filter((s) => !/limit/.test(s.reason)).length;
  $("#results").innerHTML = `
    <div class="results-head">
      <div>
        <h1>${esc(site.name)}</h1>
        <p class="where">${site.sample ? "Sample site (made up)" : esc(site.origin)} · <a href="${esc(site.preview)}" target="_blank" rel="noopener">Open site ↗</a> · <a href="#" data-go="home">Scan another</a></p>
        <p class="summary">${esc(summary(c))}</p>
        <div class="stats">
          <span class="stat">${site.pages.length} pages read</span>
          <span class="stat">${site.groups.length} page ${site.groups.length === 1 ? "layout" : "layouts"}</span>
          <span class="stat">${site.size} site</span>
          <span class="stat">robots.txt ${site.robotsFound ? "respected" : "not found"}</span>
          ${skipped ? `<span class="stat">${skipped} skipped</span>` : ""}
        </div>
        ${notes.map((n) => `<p class="notice">${esc(n)}</p>`).join("")}
      </div>
    </div>
    <div class="filters" role="toolbar" aria-label="Filter spots">${chips}</div>
    <div class="masonry" id="spot-grid"></div>`;
  renderGrid();
  renderBuildBar();
}

function renderGrid() {
  const list = state.plan.filter((d) => state.filter === "all" || d.decision === state.filter);
  $("#spot-grid").innerHTML = list.map((d) => {
    const s = d.spot;
    const buildable = d.decision === "agent";
    const on = state.approved.has(s.id);
    const label = d.decision === "agent" || d.decision === "plan_next" ? PLACEMENTS[d.placement] : DECISIONS[d.decision].label;
    return `
      <article class="card">
        ${buildable ? `<button class="save" type="button" data-toggle="${esc(s.id)}" aria-pressed="${on}" aria-label="${on ? "Don't build" : "Build"} ${esc(s.label)}">${on ? "✓ Build" : "Build"}</button>` : ""}
        <button class="card-cover" type="button" data-open="${esc(s.id)}" aria-label="See evidence for ${esc(s.label)}">
          ${coverSvg(s, d.decision)}
          <div class="card-overlay"><span>${esc(DECISIONS[d.decision].label)}</span><span>See evidence</span></div>
        </button>
        <div class="card-meta"><span class="badge d-${d.decision}">${esc(label)}</span><span class="prio">${Math.round(d.priority)}<small> /125</small></span></div>
        <h3>${esc(s.label)}</h3>
        <p class="line">${esc(d.fixes[0] ? `Fix: ${d.fixes[0]}` : s.signals[0]?.text ?? "")}</p>
      </article>`;
  }).join("");
}

function renderBuildBar() {
  const bar = $("#buildbar");
  const agents = state.plan.filter((d) => d.decision === "agent").length;
  const n = state.approved.size;
  bar.hidden = false;
  if (agents === 0) {
    bar.innerHTML = `<p>Nothing to build: this site needs no agent.</p>`;
    return;
  }
  bar.innerHTML = `<p>${n} of ${agents} agent ${agents === 1 ? "spot" : "spots"} picked</p><button class="btn primary" type="button" id="build" ${n === 0 ? "disabled" : ""}>Build agent pack</button>`;
}

/* ---------- Detail sheet ---------- */
function openSpot(id) {
  const d = state.plan.find((x) => x.spot.id === id);
  if (!d) return;
  const s = d.spot;
  const sc = s.scores;
  const value = state.values[s.id] ?? sc.value;
  const site = state.scan.site;
  const pageUrl = s.source?.path && site.sample ? `/samples/${site.sample}${s.source.path}` : s.pages?.[0];
  const label = d.decision === "agent" || d.decision === "plan_next" ? PLACEMENTS[d.placement] : DECISIONS[d.decision].label;
  const rules = d.rules.map((r) => `<div class="rule"><b>${esc(r)}</b><span>${esc(RULES[r])}</span></div>`).join("");
  const parts = Object.keys(PART_NAMES).map((k) => `
    <div class="part">
      <span class="part-name">${PART_NAMES[k]}</span>
      <span class="part-bar"><i style="width:${(sc[k] / 5) * 100}%"></i></span>
      <span class="part-val">${sc[k]}</span>
      <p class="part-why">${esc(s.why?.[k] ?? "")}</p>
    </div>`).join("");
  const sheet = $("#sheet");
  sheet.innerHTML = `
    <button class="sheet-close" type="button" data-close aria-label="Close">×</button>
    <div class="sheet-grid">
      <div class="sheet-media">
        <div class="cover-big">${coverSvg(s, d.decision)}</div>
        ${site.sample && pageUrl ? `<div class="page-frame"><iframe src="${esc(pageUrl)}" title="The page this spot is on" loading="lazy"></iframe></div>` : ""}
        ${pageUrl ? `<a class="btn small" href="${esc(pageUrl)}" target="_blank" rel="noopener">Open the page ↗</a>` : ""}
      </div>
      <div class="sheet-body">
        <span class="badge d-${d.decision}">${esc(label)}</span>
        <h2 id="sheet-title">${esc(s.label)}</h2>
        ${d.note ? `<p class="note">${esc(d.note)}</p>` : ""}
        <div class="calc">
          <strong>Priority ${Math.round(d.priority)}</strong>
          <p>(${sc.friction} × ${sc.value} × ${sc.fit}) ÷ (${sc.effort} × ${sc.risk}) = ${d.priority.toFixed(1)} · an agent needs 20 or more, with Fit 3 or more</p>
        </div>
        <div class="parts">${parts}</div>
        <div class="block"><h3>Measured evidence</h3><ul>${s.signals.map((x) => `<li>${esc(x.text)}</li>`).join("")}</ul>
          ${d.confidence === "low" ? `<p class="hint">Low confidence: fewer than two measured signals.</p>` : ""}</div>
        ${d.fixes.length ? `<div class="block"><h3>Fix on the page</h3><ul>${d.fixes.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
        <div class="block"><h3>Rules that decided it</h3>${rules}</div>
        <div class="block"><h3>How important is this task to your business?</h3>
          <div class="seg" role="group" aria-label="Value from 1 to 5">${[1, 2, 3, 4, 5].map((v) => `<button type="button" data-value="${v}" aria-pressed="${v === value}">${v}</button>`).join("")}</div>
          <p class="hint">This is the Value score. Changing it re-runs the same formula and rules. Vetoes still apply.</p>
        </div>
        ${d.decision === "agent" ? `<div class="block"><button class="btn ${state.approved.has(s.id) ? "" : "primary"}" type="button" data-toggle="${esc(s.id)}">${state.approved.has(s.id) ? "Don't build this one" : "Build this one"}</button></div>` : ""}
      </div>
    </div>`;
  sheet.dataset.spot = id;
  if (!sheet.open) sheet.showModal();
}

/* ---------- Build ---------- */
async function build() {
  const sheet = $("#packsheet");
  sheet.innerHTML = `<div class="pack-body"><h2 id="pack-title">Building the agent pack…</h2><div class="loading" style="padding:40px 0"><div class="spinner"></div>Writing the network, manifest and actions, then running the official check.</div></div>`;
  sheet.showModal();
  try {
    const r = await api("/api/pack", { scanId: state.scan.scanId, approved: [...state.approved], values: state.values });
    sheet.innerHTML = `
      <button class="sheet-close" type="button" data-close aria-label="Close">×</button>
      <div class="pack-body">
        <h2 id="pack-title">Agent pack for ${esc(state.scan.site.name)}</h2>
        <p class="${r.ok ? "result-ok" : "result-bad"}">${r.ok ? "✓ Passed the official check (build_network.mjs --check)" : "✗ The official check found problems. See the details below."}</p>
        <div class="block"><h3>One front agent, ${r.tools.length} website tools</h3>
          <p><b>${esc(r.front)}</b> in network <b>${esc(r.network)}</b></p>
          <ul class="tool-list">${r.tools.map((t) => `<li>website_${esc(t)}</li>`).join("")}</ul></div>
        ${r.mounted.length ? `<div class="block"><h3>Assistant added only to these pages</h3><ul>${r.mounted.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>` : `<div class="block"><h3>How to add it to your site</h3><p>Copy the files in the ZIP to your site's root folder, then add the section in <code>assistant-section.html</code> and <code>&lt;script type="module" src="site.js"&gt;</code> to the pages listed in <code>placement.json</code>.</p></div>`}
        ${r.openUrl ? `<div class="block"><h3>Try it</h3><ol class="steps-list">
          <li>Open the agentified site below.</li>
          <li>In the assistant, open <b>⚙ AI model settings</b> and add your own key (Meta, OpenRouter or Otari). Use a key with a low spending limit.</li>
          <li>Ask in one sentence, for example "${esc(sampleQuery(r))}". You confirm before anything is sent.</li></ol></div>` : ""}
        <div class="actions">
          ${r.openUrl ? `<a class="btn primary" href="${esc(r.openUrl)}" target="_blank" rel="noopener">Open the agentified site ↗</a>` : ""}
          <a class="btn" href="${esc(r.zipUrl)}" download>Download pack (.zip)</a>
        </div>
        <details class="block"><summary>Official check output</summary><pre class="check">${esc(r.check)}</pre></details>
      </div>`;
  } catch (error) {
    sheet.innerHTML = `<button class="sheet-close" type="button" data-close aria-label="Close">×</button><div class="pack-body"><h2 id="pack-title">Could not build</h2><p class="result-bad">${esc(error.message)}</p></div>`;
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
      renderGrid();
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
