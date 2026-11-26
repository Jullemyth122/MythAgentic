# Decisions

Newest first.

## 2026-11-27 (UI redesign)

- **UI follows the developer's own portfolio design system** (C:\Full Stack Production\portfolio_automation): zinc neutrals, hairline borders, glass cards with inset shadows, 8px buttons, uppercase section tags, a split hero with a workflow canvas on a dot grid, metric strips. The developer said the first UI was not good enough.
- **Inter only**, upright for text and italic for the accent words (developer's request), loaded from Google Fonts with both axes. No serif, no mono.
- Card covers draw with CSS classes, so they follow the decision colour and light or dark theme.

## 2026-11-27 (later)

- **Pack actions are generic and data-driven**: one `site-actions.js` reads `placement.json` and registers actions per approved spot (fill and send a form, read Q&A, list table rows, read contact). Why: the same module works on any site with plain HTML forms; no site data is copied into instructions.
- **"Send" is irreversible and uses the template's own confirmation dialog** with the filled values; "fill" is a write the visitor can still change on the page.
- **The assistant is mounted only on pages with an approved spot**, not every page. Why: the whole pitch is "not a chatbot everywhere".
- **Action schemas use only the runtime's subset** (no `pattern`; formats `date` and `email` only). A test registers every sample's actions through the runtime's own `checkSchema`.
- **Local server instead of Vercel for now**, so the developer can try everything on their machine. Public URL scans refuse private and local addresses and need the permission box.
- **Fourth sample, Isla Verde Tours**, so three samples get agent packs and the bakery shows "no agent".
- **UI**: a Pinterest-style gallery (masonry cards with drawn covers sized from the scan) and a Behance-style detail view, light and dark.

## 2026-11-27

- **MythAgentic replaces Dialect** as our entry for the Open Agentic Web Challenge (developer's decision).
- **Product name: MythAgentic** (not "AgentFit"). Repo: github.com/Jullemyth122/MythAgentic, public, MIT.
- **Stack** (PLAN.md section 4): plain HTML/CSS/JS, the official agentify-website runtime vendored unchanged, Vercel for hosting, the scanner and the LLM proxy; Meta Model API `muse-ember-1.0` as the default model, OpenRouter or Otari for visitors' own keys. Why: same as Dialect, which already deploys this way; free Otari credits were limited to the first 100 registrants.
- **Scanner in two tiers**: fetch + linkedom first, Chromium only for pages drawn by JavaScript. Why: Chromium is slow, costly and heavy on the 7.6 GB dev machine; most small-business sites are plain HTML.
- **linkedom (ISC) instead of cheerio** for the DOM: Readability (Apache-2.0) needs a real DOM.
- **Rule-based baseline scores**: every 1–5 score comes from measured signals by a fixed rule in `src/spots.js`, with a "why" text. The LLM (later) only classifies purpose and may suggest Fit changes by quoting signals. Why: repeatable scores, and the tool works without a key.
- **Rule R6 (new)**: a task whose data lives in the business's back-end system (such as free booking slots) is "plan next", not "agent". The .docx example had this decision ("schedule lives in clinic software") but no rule for it; we use a `needsConnector` signal rather than Effort ≥ 3, because JavaScript-only forms also have Effort 3.
- **"Fine" decision (new)**: below the threshold with nothing to fix is "fine", not "fix", so a well-built site shows no to-do items.
- **All applicable vetoes are cited**, strictest first (a login page with health data cites V2 and V3).
- **Template groups** need 3+ pages in the same folder with simhash distance ≤ 3. Why: on small sites, two short pages (home and contact) can look alike without being one template.
- **Clinic test site robots.txt** disallows `/admin/` (not the portal), so the scanner can read the public portal login page and show the health veto, as in the .docx example.
