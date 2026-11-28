# Decisions

Newest first.

## 2026-11-27 (the review queue as a console)

- **One screen, three columns**: the clip list (thumbnail, id, title, reports, a status dot)
  on the left, the selected clip in the middle, and the decision panel sticky on the right.
  At medium widths, or with the assistant panel open, the list becomes a strip on top
  (container queries). The decision is a row of chips (radio buttons) instead of a
  dropdown, and Moment and Strike sit side by side. The label field shows only for a warning
  label or 18+, and the second-moderator note folds away. Why: the owner pointed out the
  form sat at the bottom of a long page, far from the clip being judged.
- **Two more clips**: CW-1048, mass-posted AI "facts" from 40 new accounts (AI slop:
  remove as spam), and CW-1049, a jump-scare prank with strong language (no rule broken:
  18+ only, kept from teen accounts). A new decision, "Age-restrict: 18+ only", shows an 18+
  cover until played. The guidelines and the handbook got matching questions. The queue page
  avoids the words that flag minors (V4), because it is not a page about minors.
- **A clip link no longer scrolls the page** (`#clip=CW-1042` matches no element id), the
  Clip field always follows the clip on screen, and when the assistant points at a part of
  another clip, that clip is shown.
- **Every fill action now carries the page's own guidance for its form** (the text its
  `aria-describedby` points at, or the paragraphs right before it, at most 500 characters).
  Why: the agent called the jump-scare prank "Keep" until it saw the queue's rule for 18+;
  with the guidance it chose 18+ only with the right label and no strike.
- **Spacing tightened on every sample** (title band, lede, headings, forms).

## 2026-11-27 (one form, on the page)

- **The assistant never draws a form in the chat.** The challenge template's presentation
  rules allow a CRUSE form "when a form helps", so pressing "Fill it with the assistant"
  made the agent draw a second copy of the booking form inside the chat. The owner (rightly)
  called it pointless. MythAgentic packs now use their own `CRUSE_RULES` (build.js): the page
  is the interface, the agent fills the page's own form, and asks for anything missing in
  one sentence. CRUSE stays on for a quick choice, a small table, a summary card or a chart.
  The form, report and html widget kinds are not offered. The instructions also got
  shorter: 4,400 to 4,760 characters across the samples.
- **"Fill it with the assistant" starts a sentence instead of sending one.** It used to
  send "Help me fill in this form." with no details, which is what led to the widget. Now it
  opens the panel with `Fill in the "Book a visit" form: ` and the cursor at the end; the
  visitor finishes the sentence with their details.
- **Dates**: the fill action's description carries today's date (from the visitor's
  browser, when the page loads), and both fill and send refuse a date that has passed.
  Why: the agent turned "next Tuesday" into 2025-05-06. Browser test after the change:
  2026-12-08, every field filled on the page, nothing in the chat.

## 2026-11-27 (Clipwave review queue: the agent prepares moderation decisions)

- **New page `moderators/queue.html`**: a practice review queue with six made-up reported
  clips. Each clip plays (an animated scene with subtitles, on-screen text and a progress
  bar, `queue.js`) and lists what the automatic checks found and a second-by-second
  timeline (what it shows, what is said, text on screen). Below is the decision form
  (clip, decision, rule, moment, strike, label text, notes). Applying a decision changes
  the clip on the page: removed (blurred, "Removed"), kept with a warning label, kept,
  muted, second look, or sent to the safety team. Why: the owner asked for a real demo of
  how a video is removed or not, and for agentification beyond a report form.
- **The clips are mixed on purpose**: two to remove (private address shown by accident, no
  strike; a dangerous challenge, 1 strike), one scam (close the account), one news clip to
  keep with a warning label, one harsh product review to keep (opinion, not harassment), and
  one possible self-harm clip that goes to the safety team first.
- **Scored by the same rules**: the decision form (9 fields, a 16-option rule list) gets
  Priority 30 and an inline form helper. A removal can be restored on appeal, so it is
  Risk 2, and the runtime's confirmation dialog means the moderator applies every
  decision. Rule R3 (3 agent spots in a small site's first plan) moves the report form
  (Priority 23) to "plan next". Left as measured.
- **Every form helper now works out values from the site** instead of asking for every
  field: asked to review, decide or choose, it reads the site, fills its best suggestion and
  says which page and rule it rests on; it asks only for what only the visitor knows. It
  tries the fill action first (which says when the form is on another page). Why: in the
  first test the agent found clip CW-1042 and then asked the moderator for every field.
  Other instruction lines were shortened so every pack stays under the runtime's
  5,000-character instruction budget (clinic 4,971, Clipwave 4,923).
- **Browser test (Gemini flash-lite)**: "Review clip CW-1042 and prepare the decision" →
  Remove · Private information shown · 0:08 · No strike, with a note to blur the label; the
  confirmation dialog showed every value; after Apply the clip showed "Removed" and the
  queue said 5 of 6 waiting; the answer cited the clip, the rule page and the guideline.
  "Go through the other five" → 5 reasoned calls with nothing applied; one was wrong (news
  clip kept with no label instead of a warning label), which the moderator corrects before
  confirming.

## 2026-11-27 (designed sample sites)

- **Each sample site has its own brand now**: its own fonts (Google Fonts, loaded from the
  site's style.css), colours, logo mark, header, footer and a home-page illustration
  (inline SVG, `aria-hidden`). Clinic: calm teal. Tours: navy and sand, serif italic. Shop:
  bone-white luxury, centred wordmark. Bakery: cream and rust, a menu card. Café handbook:
  espresso and kraft paper. Warehouse: charcoal and safety yellow. Call center: a
  knowledge base with a sidebar. Clipwave: dark with pink and cyan. Why: the owner said
  the plain samples looked amateur; a demo is judged on how real the sites look.
- **`<main>` was not touched.** Everything the scanner measures (forms, tables, questions,
  words, the template fingerprint) comes from `<main>`; only the header, footer and
  stylesheet changed, and nothing outside `<main>` mentions opening hours or "call to
  book". All golden plans stayed the same (49 tests pass) and every pack still passes
  `--check`.
- **Site styles are scoped to `main`** (forms, buttons, headings) and skip `.agent-*`
  buttons, so the assistant's panel and Ask bars keep their own look.
- **Clipwave buttons are #e0245e with white text** (4.6:1), not the lighter #ff3d7f, so
  the assistant picks the brand pink for its launcher; it takes the first solid button
  colour that passes 4.5:1 with white text.

## 2026-11-27 (a social video app: content moderation)

- **New sample, Clipwave** (`test-sites/social`, made up): community guidelines, a rule
  breaks table with six rule pages, a report form, an appeal form, a moderator handbook, a
  teen consent form and a moderator console sign-in. Why: the owner asked whether an AI
  could "remove uploads that break the terms". The plan answers it with the existing rules:
  the agent helps viewers report (fills the 8-field form from one sentence, picks one of
  15 reasons) and helps new moderators find the rule; removing clips lives behind the
  moderator console's password (V3, human handoff), and the handbook says so. Automated
  removal is an irreversible action on someone else's account, so MythAgentic never places
  an agent on it.
- **V4 now fires from a scan.** `page.mentionsMinors` was measured but never used, so a
  form on a page about minors was scored like any other form. Now such a form gets Risk 5
  and the `minors` flag, so V4 gives "no agent" (the teen consent form). Test first:
  `tests/scanner.test.js`, the social video app. No other sample uses those words, so no
  other plan changed.
- **The appeal form gets no agent** (Priority 18, under 20): six short fields, so R1 says
  the form is fine as it is. Left as measured, not tuned.

## 2026-11-27 (the conversation carries across pages)

- **The chat no longer starts over on every page.** The runtime keeps the conversation in
  the open page's memory only (`engine.history`), so moving to another page lost it. After
  each answer the panel now saves, for this browser tab (sessionStorage, one key per pack),
  the messages the visitor saw and the turns the model remembers (at most 24, the
  runtime's own limit). On the next page it puts both back before the visitor types, with
  a small "Your conversation continues from the last page" divider. New chat clears it.
  The runtime is not edited: the panel reads the engine from the page's own site.js
  module.
- Checked in a browser (Gemini): "How much does Pro cost?" on /docs, then on /features
  "Which of those is the best value if I use it for a year?" answered from the earlier
  turn (Yearly, $20, $10 less than monthly). New chat emptied both the screen and the
  model's history.

## 2026-11-27 (blank sections in preview copies)

- **Preview copies show "reveal on scroll" sections.** The developer saw an empty Aullevo
  home page in the copy. The HTML had all 32 sections, but the site's CSS hides
  `[data-reveal]` (`opacity: 0`) until its own script adds `is-revealed` while scrolling,
  and the copy runs none of the site's scripts. Now the copy and the scan snapshot add
  `REVEAL_CSS` (common reveal attributes and classes shown), remove an inline animation
  start state (`opacity:0` with a transform), and `mirror-page.js` shows any element that
  is still invisible and whose class or data attribute names an animation. A deliberate
  opacity such as 0.5 is kept. The site's scripts stay off (safety).
- **Correction, same day:** that was not enough for Aullevo. Its hero waits for the script
  to add an attribute (`.hero:not([data-intro]) .hero-text > * { opacity: 0 }`), and its
  headline lines are slid 100% down inside an `overflow: clip` box until the script slides
  them up. Name lists cannot catch site-specific rules like these, so `mirror-page.js` now
  checks what the browser actually shows: any element that holds text or a picture, takes
  up room, and is invisible is shown (no transition); any text slid so that less than a
  quarter shows inside its clipping box is put back; clip-paths that cut it away to nothing
  are removed. Menus, dialogs, tooltips, navigation, `aria-hidden` and click-through
  decorative layers are left alone. Checked in the browser: 0 hidden text elements on the
  Aullevo home, features, docs and how-it-works pages and the Aphrodite home page.
- Pages drawn entirely by JavaScript (an empty root element) can still be blank in a
  copy; the scanner already flags them, and the browser scanner is not built.

## 2026-11-27 (samples in English, international names)

- **All seven samples are English with international or generic local names** (developer:
  "make it English… like some international company or simple local business"):
  Brightside Dental Clinic, Blue Bay Island Tours, Oakline & Co. Furniture, Sunrise Bakery,
  Corner Street Coffee, Swiftline Logistics, Northstar Support (sample id `callcenter`,
  was `bpo`). Prices are in dollars, phones are (555) 010-xxxx, addresses are on made-up
  streets in Springfield, the clinic speaks of insurance instead of HMO, and the payroll
  form asks for a Social Security number and a taxpayer ID (still vetoed, V3).
- The scanner keeps its Philippine words (HMO, ₱, SSS, PhilHealth): real sites still use
  them. Only the sample content changed; every decision stayed the same (golden tests).

## 2026-11-27 (staff handbooks: three onboarding samples)

- **Three new made-up samples for employees, not customers** (developer's request: "a new
  employee needs to learn the business operation quickly"): a café crew handbook
  (Kapihan sa Kanto), a courier hub floor guide (Bagwis Express Hub) and a call center
  agent handbook (Tala Connect BPO). Each has checklists or steps, a table whose rows link
  to their own pages, a page of questions, a request form, and a "who to call" page. Every
  page says it is made up; numbers and addresses are fake.
- The scanner's rules were not changed for them. Its decisions (golden tests): the table,
  the questions and the request form get an agent; "who to call" is fine; the BPO payroll
  form that asks for SSS, TIN, PhilHealth and Pag-IBIG numbers is vetoed (V3), and in the
  browser the assistant refused to fill it and pointed to HR.
- Checked in a browser with gemini-3.5-flash-lite (2026-11-27): a 6-step guided tour of
  the café opening checklist; DMG named and its row outlined for "wet and leaking parcel";
  the damage report filled 8 of 9 fields from one sentence, asked for the 9th, showed the
  confirmation dialog and sent through the page's own form; the leave form filled all 8
  fields and sent nothing on "Don't send"; "take me to how to end a call" opened the call
  handling page with that question outlined and the "You're here because" card.
- Fixes found in those runs: number badges now sit inside the outlined part (they drifted
  when the panel moved the page); a table note no longer wipes the rows it marked; table
  rows on the open page count as sources; answer text is read with spaces between table
  cells; the tour card sits at the bottom left so it never covers the steps; the panel is
  narrower on mid-size screens (`clamp(340px, 30vw, 420px)`).

## 2026-11-27 (the assistant acts on the site, not only chats)

- The developer wanted more than a chatbot: "AI can do navigation, mapping…". Four new
  actions in every source and preview pack, all generic (they read the page, so they work
  on any site):
  - `guide_on_page` (read): a guided tour on the open page. Up to 6 steps, each found by
    its words (button label, field label or placeholder, heading, row), outlined and
    numbered, with a note bubble and Back / Next.
  - `highlight_table` (read): the rows (by first cell) and columns (by header) that answer
    the visitor are tinted, the other rows fade, and a note sits on the table.
  - `site_map` (read): every page with its title and headings, written into
    placement.json at build time.
  - `go_to_page` (write, a known site path only): a 3-second "Taking you to…" countdown the
    visitor can stop, then the page opens with the part outlined (`?show=`), and the panel
    opens with "You're here because…". The runtime keeps no chat across pages, so the
    reason carries over instead.
- Number badges are drawn over the page, not with `::before` and `position: relative` on
  the site's own elements, so the site's layout never changes.
- Checked on the real pages with linkedom: Aullevo's Free vs Pro table ("Pro" column, 12
  cells; Voice Mode and Multi-link Queue rows) and a 4-step tour of Aphrodite's home page
  (prompt field, "Painted sunset with EVE", "Write your note", the pricing card).

## 2026-11-27 (every answer points at its source)

- **Code, not the model, shows where an answer comes from.** The developer found answers
  vague: the model called `show_on_page` only sometimes, and never for answers that used
  several items. Now every read action reports what it returned (`agent:sources` event),
  and when the answer is done the panel picks the sources the answer names: headings whose
  distinctive words (shared by at most a fifth of the returned headings) the answer says.
  Those parts of the open page get a numbered outline that stays until the next question,
  and the answer gets "Where it says so" buttons (scroll to each) and links to other
  pages (`?show=<heading>` opens the page with that part outlined).
- The assistant's instructions now ask it to name each item it used the way the site
  names it, so there is something to point at.

## 2026-11-27 (the helper reads the whole site; plain words)

- **Improve with AI reads every page**, not a slice. The brief now carries each page's
  words in reading order (headings, paragraphs, lists, buttons, options), up to 8,000
  characters a page and 150,000 in all; the helper sends up to 120,000 characters (about
  30,000 tokens) and shrinks every page by the same share when a site is bigger. Before, it
  got about 16,000 characters: the scored page's questions and 600 characters of the home
  page, so it never saw Aphrodite's prompt ideas, occasion pages or passes (developer: "it
  doesn't check the prompts, ideas, everything in the page"). Aphrodite: 21 pages, about
  10,900 words, 15,900 prompt tokens with gemini-3.5-flash-lite (2026-11-27).
- It reads text, not screenshots: MythAgentic has no page renderer yet.
- **Plain words for owners**: the prompt bans "spot", "scan", "agent", "signal" and the
  like in what the owner reads, and ideas must cover the whole site (home page feature,
  occasion pages, prices). The screen says "First message in the chat", "Help box", "Quick
  questions visitors can tap", "More ideas for your site", "From your site:".
- **New read action `search_site`** in every source and preview pack: it searches all the
  site's pages (up to 40), split at their headings, and returns the best sections with
  their links. The visitor's assistant can now answer about anything the site says
  (Aphrodite: "How much is a pass?" finds "from $1.99 or ₱115" on the home page), not
  only the part it was placed at. Read-only, so no rule changes.

## 2026-11-27 (a simple panel for visitors)

- **The side panel shows visitors only what they need**: the assistant's name with New chat
  and close in one top bar, the chat, up to 3 suggested questions (the owner's Ask bar
  questions first, else the page's own questions) until the first message, the input, and
  one short line that answers come from AI and nothing is sent without the visitor's OK.
  Hidden in the panel: the runtime's model badge, the Developer button, the "website
  actions connected" list, the intro sentence, and the "connected" status. The developer's
  view was "so many unneeded texts... unfriendly for normal users". The runtime is not
  edited; the panel restyles and moves its parts. Errors (no key, could not load) still
  show in the status line, and the AI model settings stay at the bottom.

## 2026-11-27 (smarter Improve with AI, checked in a browser)

- **The helper reads the real words now** (`src/brief.js`, sent with every scan): each
  approved spot's questions with the start of their answers, form fields, table columns and
  rows, and the home page's opening. Before, it saw only page titles and headings, so its
  question buttons were guesses.
- **The prompt is a writer's brief**: who visits, what the Ask bar and the chat look like,
  and that question buttons must be ones the page answers; when the owner names what
  visitors come for (for example anniversaries and apologies), every button serves it.
- **The screen shows the result**: a live preview of the Ask bar and the chat's first
  message as visitors see them, a 3-step strip, a "Draft my assistant" button, and
  "Use these and build" in one click. The build screen has the same 3-step strip.
- Checked in a browser with gemini-3.5-flash-lite (2026-11-27): a draft came back in about
  2 s; on the Aphrodite copy the assistant answered "What does a sunflower mean?" and
  highlighted the sunflower card; on the tours sample it filled 7 of 8 reservation fields
  from one sentence and asked for the missing hotel.

## 2026-11-27 (Improve with AI, all Meta models)

- **"Improve with AI"** in the results screen: the owner chats with their own model about
  the scan. The model gets the scan as data (page titles, headings, measured counts, every
  decision with its scores and signals) and writes the assistant's greeting, rules and Ask
  bar text and questions, plus ideas that must quote measured facts. It changes no score and
  no decision (CLAUDE.md core rule); its ideas are labelled "not scored". Its words reach the
  pack only after the owner edits and approves them, and the builder keeps them as plain
  text with length limits (`cleanTuning`).
- **The AI key screen lists the models the key can use** (`GET {router}/models` through the
  relay), so every Meta model on the owner's key (Muse Ember, Wonder, Wonder Full) can be
  picked. `-contributor` models are never offered. Gemini's speech, image and embedding
  models are hidden because they cannot chat.
- **`npm start` reloads on code changes** (`node --watch-path=server --watch-path=src`). The
  developer's server kept the old pack builder in memory, so Build rebuilt the old layout
  over the new one. `npm run start:once` runs without reloading.

## 2026-11-27 (side panel and Ask bars)

- **The assistant is a side panel, not a section in the page.** The developer found the
  in-page chat box bad: visitors had to scroll to it, and it pushed the content apart. Now
  every page gets one launcher ("Ask <site>") that opens the assistant in a panel on the
  right (a bottom sheet on phones). On wide screens the page moves over, so the panel never
  covers what the assistant points at. This replaces "mounted only on pages with a spot":
  rule R4 already says one front agent per site, and the actions are still only for the
  approved spots.
- **Ask bars at the spots.** The pack builder marks the part of the page each approved spot
  is about (`data-agent-spot`: the form, the table, the first question's card), and
  `assistant-dock.js` puts a small bar right before it: "Fill it with the assistant",
  "Help me choose", or the page's first questions as buttons. A button only opens the panel
  and types the question, as the visitor could.
- **New read action `show_on_page`**: scrolls the visitor's page to the heading, row or form
  the assistant answered from and outlines it; filling a form outlines the form too. It
  changes nothing on the page. The model still cannot write HTML into the page: it can only
  call the actions the pack registers, which is the runtime's safety model.
- The panel, launcher and bars take the site's own button colour when white text has 4.5:1
  contrast on it.

## 2026-11-27 (see it agentified)

- **A live URL now builds a preview copy, not a companion page.** The developer wanted to
  see their own site with the agent on it. The copy uses the scanned HTML and the site's own
  stylesheets (absolute URLs to the real site), with the page scripts removed, links between
  scanned pages kept inside the copy, and every form neutralised (`action="#"` plus
  `mirror-page.js`, which stops submits and shows "nothing was sent"). It is built in source
  mode, so the assistant can read tables and fill forms on the copy. The companion (official
  live URL mode) stays available with `mode: "companion"`.
- **The assistant is placed where the spot is**: right after its form or table (stepping out
  of single-child wrappers), or at the end of the main content for answers. Before, it was
  always at the end of `<main>`.
- **Before / After** in the build screen: the page as scanned next to the same page with its
  assistant, for every page that got one.
- The answer desk's read action reads all its pages (up to 10) and takes an optional
  `query` that puts matching answers first, since the text limit cannot hold all of them.

## 2026-11-27 (Gemini)

- **Google Gemini as a second relay provider** (developer's request, to use its free tier):
  `/byok/gemini/v1` forwards to Google AI Studio's OpenAI-compatible endpoint
  (`generativelanguage.googleapis.com/v1beta/openai`). Default model `gemini-3.5-flash-lite`:
  in a test on this date it returned tool calls in 2-4 s; `gemini-3.5-flash` took 10-12 s,
  `gemini-3.8-flash` was overloaded (HTTP 503), and `gemini-2.5-flash` is closed to new users.
- **Keys in `.env` are used automatically.** With no setup saved in the browser, the website
  saves a profile whose key is the placeholder `server`; the relay swaps in the `.env` key.
  The owner can change provider, model or key in the AI key screen at any time.
- The generated packs still name the Meta Model API in their manifest (challenge default);
  the browser's saved setup overrides it at run time.

- **One answer desk per site.** Every page that answers questions (5+ question headings, or
  2+ in 600+ words) feeds one spot, named after the page with the most. Before, each long page
  was its own spot: aullevo.com showed 14 near-identical cards, and long pages with no
  questions counted. Rule R4 (one front agent per site) already said one.
- **A compare table must be a choice**: half its rows link to their own page, or it shows
  prices. A privacy-policy table of 8 rows is reading, not choosing.
- **Every spot names where it is** (`target`: the page, and its form, table, first question,
  price text or the whole page). Cards show the scanned page with that part outlined. The
  snapshot has its scripts removed and is served with a CSP sandbox, so a scanned site runs
  no code here.
- **Live URLs build a companion assistant** (agentify-website live URL mode, with the official
  `content-actions.js` and `standalone-index.html`), so a real site's pack can be opened and
  tried. Before, only the samples could be tried.
- **AI key screen in MythAgentic.** It writes the runtime's own BYOK profile store
  (`nsweb-byok-profiles-v1`), which the packs read because they are served from the same
  origin. Meta calls go through a local `/byok/v1` relay (same-origin only, two paths, key
  passed through and never logged), with `META_API_KEY` from `.env` as a fallback.

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
