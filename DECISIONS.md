# Decisions

Newest first.

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
