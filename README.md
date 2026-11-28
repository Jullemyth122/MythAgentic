# MythAgentic

**Don't put a chatbot everywhere.** MythAgentic scans a website task by task and tells
the owner where an AI agent pays off, what kind, and where none should go. Then it builds
only those agents, in the official format of the
[Open Agentic Web Challenge](https://github.com/cognizant-ai-labs/agentic-web).

For each spot on a site it decides one of:

- **add an agent here**, and which kind (form helper, answer desk, compare helper, …)
- **expose an action here** that other agents can call
- **fix the page instead**, because no agent is needed
- **fine**: nothing to do

Every decision shows the measured signals and the rule that produced it.

> Status: working local build. Scan a sample or any public URL, see the placement map,
> override, and build an agent pack that passes the official `build_network.mjs --check`.
> Still to come: the AI classification step, the browser scanner for JavaScript-drawn
> pages, MythAgentic's own `score_page` network, and hosting.

## How it decides

Code measures the page, the LLM only classifies and explains, and a fixed formula ranks:

```
Priority = (Friction × Value × Fit) ÷ (Effort × Risk)      each part 1–5, max 125
```

An agent is recommended only when Priority is 20 or more and Fit is at least 3. Payments,
health data, ID numbers and children's services go through safety vetoes whatever their
score. The full rule list is in [`src/score.js`](src/score.js).

## Try it

Needs Node.js 22 or newer.

```shell
npm install
npm start                         # then open http://localhost:8090
```

`npm start` restarts the server when a file in `server/` or `src/` changes. Use
`npm run start:once` to run it without that.

On the website:

1. Put a key in a `.env` file next to `package.json` (never committed) and restart:
   `GEMINI_API_KEY=...` (Google AI Studio, free tier works) or `META_API_KEY=...`. The
   website then uses it automatically. Or select **AI key** (top right) to pick Gemini, Meta,
   OpenRouter or another OpenAI-compatible provider, pick any model your key can use (the
   screen asks the provider for its list), or paste a key that
   is saved only in your browser. Scanning and scoring never use AI; the key is only for the
   assistants you build. Gemini and Meta calls go through this server's relay
   (`/byok/gemini/v1`, `/byok/v1`), which passes the key on without logging or keeping it.
2. Pick a sample, or paste a public URL you own or may scan. Four samples are customer
   websites (clinic, tours, shop, bakery); three are staff handbooks where new employees
   learn the job (coffee shop, logistics warehouse, call center).
3. Every card shows the real page with the part it is about outlined in pink. **Pages read**
   lists every page the scanner read and what it measured there. Click a card for its
   evidence, score parts and rules; change "How important is this task" to re-run the formula.
4. Optional: **Improve with AI**. Tell your model what visitors come for, or ask what it
   would change. It reads the scan and writes the assistant's greeting, rules and Ask bar
   questions, plus ideas that quote what was measured. Edit them and select **Use these in
   my pack**. It never changes a score or a decision.
5. Pick the agent spots and select **Build agent pack**. It is checked with the challenge's
   own `build_network.mjs --check`. **Before / After** shows each page with its assistant:
   an **Ask** button on every page opens it in a side panel, and an Ask bar sits right at
   each part of the page that scored. While it answers, it scrolls the page to the part it
   used and highlights it (`website_show_on_page`).
   - A sample becomes an agentified copy of the site: the assistant fills its forms.
   - A live URL becomes a **preview copy** of its scanned pages (its own HTML and styles,
     page scripts off, forms send nothing). `mode: "companion"` builds the skill's live URL
     mode instead: a separate page that answers from a snapshot of the public pages.

Command line:

```shell
npm test                          # all tests
npm run scan -- clinic            # scan a test site: clinic, tours, shop, clear, cafe, warehouse or callcenter
npm run scan -- clinic --json     # the full result
```

Example (the made-up dental clinic in `test-sites/clinic`):

| Spot | F·V·Fi·E·R | Priority | Decision |
|---|---|---|---|
| Book a visit form (12 fields, 3 steps) | 5·5·5·1·2 | 63 | Inline form helper |
| Insurance and FAQ questions | 3·4·4·1·1 | 48 | Answer desk (public facts only) |
| check_slots for other agents | 3·5·4·3·1 | 20 | Plan next: needs the clinic's schedule |
| Prices ("price on request") | 4·2·2·1·1 | 16 | No agent: publish the prices |
| Contact page (no opening hours) | 2·2·1·1·1 | 4 | No agent: add opening hours |
| Patient portal (behind a login) | 3·4·3·5·5 | 1 | Health-data veto: human handoff |

Only scan sites you own or have permission to scan. The scanner respects robots.txt and
skips account, cart and checkout pages.

## Layout

| Path | What |
|---|---|
| `src/score.js` | The formula, the placement rules and the vetoes |
| `src/spots.js` | Measured pages → spots with 1–5 scores and their evidence |
| `src/scanner/` | Crawler, robots.txt, sitemap, page measurement, template grouping |
| `src/pack/` | Agent pack generator (official templates), generic site actions, ZIP |
| `server/server.mjs` | Local server: website, `/api/scan`, `/api/pack`, agentified samples |
| `site/` | The MythAgentic website |
| `test-sites/` | Four made-up businesses with known problems: clinic, tours, shop, clear |
| `tests/` | `node --test` tests, including the expected decisions for each test site |
| `vendor/agentify-website/` | The challenge's official skill and runtime, unchanged |

## Licence

MIT, see [LICENSE](LICENSE). `vendor/agentify-website/` is Apache-2.0 (Cognizant AI Labs).
