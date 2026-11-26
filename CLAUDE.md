# MythAgentic: rules for the coding agent

Entry for the Open Agentic Web Challenge (Cognizant). It scans a website and decides, per
task, where an AI agent pays off, what kind, and where none should go, then generates
agent packs for the approved spots only. The plan is in PLAN.md; decisions in DECISIONS.md.

## Core rules
- **Code measures, the LLM only classifies and explains, a fixed formula ranks.** No score
  part, Priority or decision may come from an LLM. The LLM may classify a task's purpose
  and suggest a Fit change only by quoting measured signals.
- Every recommendation shows its signals and rule ids (R1–R6, V1–V4 in `src/score.js`).
  Fewer than two signals means "low confidence".
- Vetoes are never skipped: payments (prepare only), health/legal/financial (public facts
  or human handoff), ID/card numbers/passwords (never through an agent), minors (no agent).
- Saying "no agent" is a feature. Never tune rules to recommend more agents.

## Scanning manners
- Scan only sites the owner owns or may scan. Respect robots.txt. Never submit a form,
  never log in, skip account, cart and checkout pages. Never store visitors' personal data.
- The test sites in `test-sites/` are made-up businesses; every page says so. Keep
  addresses and phone numbers obviously fake.

## Challenge rules
- `vendor/agentify-website/` is copied unchanged from the challenge repo. Never edit it.
- Generated packs and the advisor's own network must pass `build_network.mjs --check`.
- Keys: a visitor's key never reaches a peer site, URL, manifest, prompt or trace. The
  site's Meta key lives only in a Vercel environment variable.
- AI provider default: Meta Model API (`https://api.meta.ai/v1`), model `muse-ember-1.0`.
  Never `-contributor` models.
- The demo video must be in the developer's own voice (challenge rule).
- The project is open source (MIT).

## Working rules
- Plain HTML, CSS and JavaScript modules; no framework. Plain design, no AI-looking styling.
- Run tests with `npm test` (quoted glob; Node 22 does not accept a bare folder).
- Write the test first for any scoring or rule change. A failing golden test for a test
  site means find the cause, don't loosen the test.
- The machine has about 7.6 GB RAM: run headless Chromium only with no dev server running.
- Every claim in docs or UI needs a source or is marked UNVERIFIED.
- Record important decisions in DECISIONS.md with the date and the reason.
- Check a dependency's licence before adding it.
