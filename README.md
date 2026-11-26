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

> Status: early build (Phase 1 of [PLAN.md](PLAN.md)). The scanner, the scoring rules and
> three test sites work from the command line. The website, the agent network and the pack
> generator are next.

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
npm test                          # all tests
npm run scan -- clinic            # scan a test site: clinic, shop or clear
npm run scan -- clinic --json     # the full result
```

Example (the made-up dental clinic in `test-sites/clinic`):

| Spot | F·V·Fi·E·R | Priority | Decision |
|---|---|---|---|
| Book a visit form (12 fields, 3 steps) | 5·5·5·1·2 | 63 | Inline form helper |
| HMO and FAQ questions | 3·4·4·1·1 | 48 | Answer desk (public facts only) |
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
| `test-sites/` | Three made-up businesses with known problems: clinic, shop, clear |
| `tests/` | `node --test` tests, including the expected decisions for each test site |
| `vendor/agentify-website/` | The challenge's official skill and runtime, unchanged |

## Licence

MIT, see [LICENSE](LICENSE). `vendor/agentify-website/` is Apache-2.0 (Cognizant AI Labs).
