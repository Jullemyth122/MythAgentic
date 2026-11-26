# MythAgentic: plan and tech stack

Product name: **MythAgentic** (the Agent Placement Advisor). Repo: github.com/Jullemyth122/MythAgentic. MythAgentic replaces Dialect as our challenge entry (27 Nov 2026).

Source: "Agent Placement Advisor Build Plan.docx" (26 Nov 2026). Challenge: Cognizant Open Agentic Web Challenge. Submissions close **11 Jan 2027, 8:00 AM PST** (12 Jan, 12:00 AM Manila). Our target is 10 Jan.

## 1. What we are building (one paragraph)

You paste a website URL. The tool scans the site page by page, finds the tasks on each page (forms, price tables, FAQs, "call us" dead ends), measures them with code, and decides for each spot:

- **add an agent here**, and which kind (form helper, answer desk, compare helper, and so on)
- **expose an action here** that other agents can call
- **fix the page instead**, because no agent is needed

Each decision shows its evidence and the rule that produced it. The owner agrees or overrides, then the tool generates the agent files (network, manifest, actions) for the approved spots only, in the challenge's official format. The tool is itself an open agentic website, so other agent sites can call its `score_page` action.

## 2. The main design rule

**Code measures. The LLM only classifies and explains. A fixed formula ranks.**

```
Priority = (Friction × Value × Fit) ÷ (Effort × Risk)      max 125
```

- Agent only if Priority ≥ 20 and Fit ≥ 3. Otherwise: fix the page.
- Risk 5 (payments, health, ID numbers, minors) always goes through the veto rules.
- Max 3 agent spots for a small site, 5 for a medium one.

This keeps scores repeatable and checkable, which is what the judges and the human-agreement test need.

## 3. How the pieces fit

```
 Owner's browser (static site on Vercel)                   Vercel Function (Node)
 ┌────────────────────────────────────────────┐            ┌──────────────────────────┐
 │ index.html: paste URL, map, evidence,      │  scan URL  │ /api/scan                │
 │   override, download pack                  │ ─────────► │  robots.txt + sitemap    │
 │                                            │            │  fetch pages (tier 1)    │
 │ Official agentify-website runtime          │  signals   │  Chromium only if needed │
 │   (vendored unchanged)                     │ ◄───────── │   (tier 2, axe-core)     │
 │   Neuro SAN network: placement_advisor     │   (JSON)   │  measure signals         │
 │     friction_analyst, value_analyst,       │            │  group by template       │
 │     risk_officer, pack_builder             │            │  NO LLM, NO keys         │
 │                                            │            └──────────────────────────┘
 │ Site actions (plain JS, deterministic):    │
 │   score_spot, apply_rules, build_pack      │──► LLM router (default model or the
 │ IndexedDB: scans stay on this device       │    visitor's own key, BYOK)
 └────────────────────────────────────────────┘
          ▲
          │ score_page (consent card, cross-origin)
   Other agentic sites
```

- The **server measures only**. It never calls an LLM and never sees a key.
- The **browser** runs the agent network: it classifies each task, explains it, and calls the deterministic `score_spot` and `apply_rules` actions so the numbers never come from the LLM.

## 4. Tech stack

| Layer | Pick | Why |
|---|---|---|
| Front end | Plain HTML, CSS, JavaScript ES modules. No framework, no bundler. | Same as Dialect and the official examples. Static hosting, fast, nothing to break. |
| Agent runtime | Official `skills/agentify-website/runtime/`, vendored unchanged (copied from `C:\Hackathon\agentic-web`) | Agent loop, consent cards, BYOK, partner calls, sandbox. Required by the spec. |
| Advisor's own network | Neuro SAN HOCON → `.network.json` via `build_network.mjs` | Required by the spec. Agents: placement_advisor (front), friction_analyst, value_analyst, risk_officer, pack_builder. |
| Scoring and rules | Plain JS module, shared by browser and tests | One formula, one rule table, unit-tested. The LLM never produces a number. |
| Scanner, tier 1 | Vercel Function (Node 22): `fetch` + **linkedom** (DOM) + **@mozilla/readability** (main text) + our own robots.txt and sitemap parser | Cheap and fast. Works for most small-business sites, which are plain HTML. |
| Scanner, tier 2 | **playwright-core** + **@sparticuz/chromium** in the same function, plus **axe-core** injected into the page | Only for pages that need JavaScript to show their forms. Accessibility signals. |
| Template grouping | Our own small simhash of each page's tag structure | Turns 10,000 product pages into a few groups. About 50 lines; no library needed. |
| Placement map and report | Hand-drawn SVG in the browser; a print stylesheet for PDF | Plain look, no chart library. Print to PDF gives the shareable report. |
| Analytics import (optional) | **Papa Parse** (vendored file) | Owner uploads a CSV export; parsed in the browser. First thing we cut if late. |
| Agent pack download | **JSZip** (vendored file) + the agentify-website templates | The owner gets a ZIP ready for the official runtime. |
| Pack validation | Runtime's own `hocon.js` + `kernel.js` (`validateNetwork`) in the browser; full `build_network.mjs --check` in tests and CI | The same parser the browser runtime uses, so a pack that passes really loads. |
| Storage | IndexedDB in the browser | Scans stay on the owner's device. Nothing stored on the server. |
| LLM (default) | Meta Model API (`https://api.meta.ai/v1`, OpenAI-compatible), model `muse-ember-1.0`, behind a small capped no-key proxy | Your Meta credits, already used in Dialect. Never a `-contributor` model. Key only in a Vercel env var. |
| LLM (visitor's own key) | OpenRouter or hosted Otari through the runtime's built-in connectors | BYOK, as the spec expects. |
| Consistency | LLM parts run 3 times at temperature 0, majority wins | Same ranking on every run; we test this. |
| Hosting | **Vercel**: one project for the advisor (static + `/api/scan` + LLM proxy), one per test site. CORS headers in `vercel.json`. | You already deploy CommuteAI and Dialect there. The spec requires CORS on public agent files. |
| Tests | `node --test` (built into Node), fixture HTML pages, golden tests | No test framework to install. |
| Discovery | Pull request to `docs/agentic_websites.md` in the challenge repo; NANDA Index | Other agents can find and call `score_page`. |
| Repo | Public GitHub repo, MIT licence | The challenge requires open source. |

Changes from the .docx, and why:

- **Vercel instead of AWS Lambda or Cloudflare.** Vercel Functions run on AWS Lambda anyway, and you already use Vercel. One project holds the site, the scanner and the proxy.
- **Two scanner tiers instead of Playwright for every page.** Chromium is slow, costly and heavy. Most small sites don't need it.
- **linkedom instead of cheerio.** Readability needs a real DOM; linkedom gives one and is light.
- **Meta Model API as the default model instead of Otari.** Free Otari credits went to the first 100 registrants, so we probably won't get them. Otari and OpenRouter stay as BYOK options.

## 5. The three test sites (synthetic, clearly labelled)

All three are made-up businesses we own, so scanning them is allowed. Each page says it is a demo site.

1. **Clinic** (dental): 12-field, 3-step booking form; HMO questions in a long FAQ; "price on request"; contact page with no opening hours; patient portal behind a login. Expected: form helper, answer desk, fix prices, fix contact, health veto.
2. **Shop**: "price on request" everywhere, many similar products to compare. Expected: compare helper, publish prices.
3. **Clear site**: simple, well-built pages. Expected: **no agent anywhere**. This proves the tool says no.

The expected decisions become golden tests: if a code change moves a decision, a test fails.

## 6. Folder layout (planned)

```
MythAgentic/
  PLAN.md                 this file
  DECISIONS.md            dated decisions
  package.json            scripts only; server deps for /api
  vercel.json             CORS headers, function settings
  vendor/agentify-website/  official runtime + scripts, unchanged
  site/                   the advisor website (static)
    index.html  report.html  style.css
    js/  scan-client.js  score.js  rules.js  map-svg.js  pack.js  store.js
    agents/  advisor.hocon  agent-manifest.json  site-actions.js
  api/
    scan.js               the scanner function
    llm.js                capped no-key proxy to the Meta Model API
  scanner/                signal measurement, shared by api/ and tests
    fetch-tier.js  chromium-tier.js  signals.js  forms.js  robots.js  sitemap.js  simhash.js
  test-sites/  clinic/  shop/  clear/
  tests/                  node --test files + fixture HTML
```

## 7. Schedule (from the .docx, with gates)

| Dates | Phase | Done when |
|---|---|---|
| Nov 27 – Dec 3 | Foundations | Repo, vendored runtime, Marrow Point example runs, 3 test sites built and deployed, Vercel function limits checked (time, memory, Chromium size) |
| Dec 4 – 10 | Scanner | `/api/scan` returns signals and template groups for all 3 test sites |
| Dec 11 – 17 | Decisions | Formula, rules, vetoes, LLM classification with quoted evidence, placement map with overrides. Golden tests pass. |
| Dec 18 – 24 | Agent packs | Approved spots → network, manifest, actions; `build_network.mjs --check` passes; ZIP download |
| Dec 25 – 31 | Proof (holiday buffer) | Consistency test (5 sites × 5 runs); 3 human raters, 20 page-tasks, Spearman ≥ 0.6 target; before/after task test on the clinic |
| Jan 1 – 7 | Advisor as an agentic site | Own manifest, `score_page` callable cross-origin, `check_partner.mjs` passes from a second origin, printable report |
| Jan 8 – 10 | Submit | Video in **your own voice** (the rules say not AI-generated), screenshots, description with the agreement number, PR to the agentic websites list |

If late, cut in this order: analytics import → logged-in bookmarklet → background-agent type. Always keep **scan → map → override → validated pack** working end to end.

## 8. Risks to check first (Phase 0)

- **Vercel limits.** Function duration, memory and bundle size on your plan must fit Chromium. If not, tier 2 moves to Cloudflare Browser Rendering or is dropped (tier 1 still covers the demo sites).
- **Tool calls with the Meta Model API through the runtime.** Still unconfirmed in Dialect too. Fallback: OpenRouter with a model that makes tool calls.
- **Your local RAM (about 7.6 GB).** Run headless Chromium only when no dev server is running; most tests use fixture HTML and need no browser.
- **Scanning manners.** Scan only sites the owner owns or has permission for, respect robots.txt, skip login, account and checkout pages, store no visitor data.

## 9. Answered questions (27 Nov 2026)

1. MythAgentic **replaces Dialect**. All challenge time goes here.
2. Product name: **MythAgentic**.
3. Vercel and the Meta credits as the default model: **yes**.
4. Repo: **github.com/Jullemyth122/MythAgentic** (public, MIT). Adding teammate znex07: not decided yet.

## 10. Progress

- **27 Nov:** project set up; official skill vendored (commit `0c0ca45`); scoring rules and vetoes (`src/score.js`); three test sites; tier-1 scanner (robots, sitemap, crawl, page signals, template grouping); rule-based spot scores (`src/spots.js`); 18 tests pass. The clinic test site reproduces the .docx placement map.
- **Next:** the advisor website (paste URL → map → evidence → override), `/api/scan` on Vercel, the advisor's own network and manifest, then the LLM classification step.
