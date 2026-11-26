// Placement scoring: the formula, the placement rules and the safety vetoes.
//
// Plain code, shared by the browser and the tests. The LLM never produces a number:
// it may only classify a task, and every number here comes from measured signals
// or the owner's own input.
//
//   Priority = (Friction × Value × Fit) ÷ (Effort × Risk)      max 125

/** The five score parts, each 1 to 5. */
export const PARTS = ["friction", "value", "fit", "effort", "risk"];

/** An agent is recommended only at or above this Priority (rule R1). */
export const PRIORITY_THRESHOLD = 20;

/** An agent is recommended only at or above this Fit (rule R1). */
export const FIT_THRESHOLD = 3;

/** Most agent spots in a first plan, by site size (rule R3). */
export const MAX_AGENT_SPOTS = { small: 3, medium: 5, large: 8 };

/** Every rule the advisor can cite. The id is shown next to each decision. */
export const RULES = {
  R1: "Recommend an agent only when Priority is 20 or more and Fit is at least 3. Otherwise fix the page.",
  R2: "If a page fix makes the agent pointless, recommend the fix first.",
  R3: "No more than 3 agent spots in a first plan for a small site, 5 for a medium one. Start where the score is highest.",
  R4: "One front agent per site; specialist agents only for separate knowledge or systems.",
  R5: "Every recommendation quotes at least two measured signals, or it is marked low confidence.",
  R6: "A task that lives in the business's own back-end system needs a connector first: plan it next.",
  V1: "Payments: the agent may prepare a payment but never complete it. The visitor confirms in the site's own checkout.",
  V2: "Health, legal or financial data: an answer desk for public facts only, with a human handoff for anything else.",
  V3: "ID numbers, card numbers and passwords never pass through the agent.",
  V4: "Minors' data or services for children: no agent is recommended.",
};

/** What each placement type is for, as shown to the owner. */
export const PLACEMENTS = {
  inline_form_helper: "Inline form helper",
  compare_helper: "Compare-and-choose helper",
  answer_desk: "Answer desk",
  agent_action: "Agent-callable action",
  partner_handoff: "Partner handoff",
  background_agent: "Background agent",
  human_handoff: "Human handoff",
  none: "No agent: fix the page",
};

/** The placement type that suits each kind of task when an agent is recommended. */
const PLACEMENT_FOR_KIND = {
  form: "inline_form_helper",
  compare: "compare_helper",
  answers: "answer_desk",
  action: "agent_action",
  partner: "partner_handoff",
  followup: "background_agent",
};

/**
 * Checks that a score part is a whole number from 1 to 5.
 * @param {string} part
 * @param {unknown} value
 */
function checkPart(part, value) {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new RangeError(`${part} must be a whole number from 1 to 5, got ${String(value)}`);
  }
}

/**
 * Computes Priority from the five score parts.
 * @param {{friction:number,value:number,fit:number,effort:number,risk:number}} s
 * @returns {number} unrounded, from 0.04 to 125
 */
export function priority(s) {
  for (const part of PARTS) checkPart(part, s[part]);
  return (s.friction * s.value * s.fit) / (s.effort * s.risk);
}

/**
 * Every veto that applies to a spot, strictest first. Only Risk 5 spots are vetoed.
 * @param {{risk:number}} scores
 * @param {{minors?:boolean,secrets?:boolean,regulated?:boolean,payment?:boolean}} flags
 * @returns {Array<"V1"|"V2"|"V3"|"V4">}
 */
export function vetoesFor(scores, flags = {}) {
  if (scores.risk < 5) return [];
  const vetoes = [];
  if (flags.minors) vetoes.push("V4");
  if (flags.regulated) vetoes.push("V2");
  if (flags.secrets) vetoes.push("V3");
  if (flags.payment) vetoes.push("V1");
  // Risk 5 with no named reason is treated as regulated: the strictest common case.
  if (vetoes.length === 0) vetoes.push("V2");
  return vetoes;
}

/**
 * Decides one spot on its own, before the plan-wide cap (rule R3).
 *
 * @param {object} spot
 * @param {string} spot.id
 * @param {string} spot.kind  form | compare | answers | action | partner | followup | page
 * @param {{friction:number,value:number,fit:number,effort:number,risk:number}} spot.scores
 * @param {{minors?:boolean,secrets?:boolean,regulated?:boolean,payment?:boolean}} [spot.flags]
 * @param {Array<{id:string,text:string}>} [spot.signals]  measured evidence
 * @param {Array<{text:string, removesNeed?:boolean}>} [spot.fixes]  page fixes found
 * @param {boolean} [spot.needsConnector]  the task lives in a back-end system
 * @param {boolean} [spot.publicFactsOnly]  regulated topic, but only public facts are asked
 * @returns {{decision:"agent"|"plan_next"|"fix"|"fine"|"veto", placement:string, priority:number,
 *   rules:string[], confidence:"measured"|"low", fixes:string[], note:string}}
 */
export function decideSpot(spot) {
  const p = priority(spot.scores);
  const flags = spot.flags ?? {};
  const signals = spot.signals ?? [];
  const fixes = (spot.fixes ?? []).map((f) => f.text);
  const confidence = signals.length >= 2 ? "measured" : "low";
  const rules = [];
  const base = { priority: p, confidence, fixes };
  if (confidence === "low") rules.push("R5");

  const vetoes = vetoesFor(spot.scores, flags);
  if (vetoes.includes("V4")) {
    return { ...base, decision: "veto", placement: "none", rules: [...rules, ...vetoes], note: "Children's data or services: no agent." };
  }
  if (vetoes.includes("V2")) {
    return { ...base, decision: "veto", placement: "human_handoff", rules: [...rules, ...vetoes], note: "Regulated data: a person handles this." };
  }
  if (vetoes.includes("V3")) {
    return { ...base, decision: "veto", placement: "human_handoff", rules: [...rules, ...vetoes], note: "Secrets such as ID or card numbers never pass through an agent." };
  }

  if ((spot.fixes ?? []).some((f) => f.removesNeed)) {
    return { ...base, decision: "fix", placement: "none", rules: [...rules, "R2"], note: "Fix the page first; the agent would only work around the gap." };
  }

  if (p < PRIORITY_THRESHOLD || spot.scores.fit < FIT_THRESHOLD) {
    if (fixes.length === 0) {
      return { ...base, decision: "fine", placement: "none", rules: [...rules, "R1"], note: "No agent needed, and nothing to fix." };
    }
    return { ...base, decision: "fix", placement: "none", rules: [...rules, "R1"], note: belowThresholdNote(p, spot.scores.fit) };
  }

  const placement = PLACEMENT_FOR_KIND[spot.kind] ?? "answer_desk";
  if (spot.needsConnector) {
    return { ...base, decision: "plan_next", placement, rules: [...rules, "R1", "R6"], note: "Worth an agent, but it needs a connector to the business's own system first." };
  }
  if (spot.publicFactsOnly) {
    return { ...base, decision: "agent", placement, rules: [...rules, "R1", "V2"], note: "Public facts only; personal health, legal or money questions go to a person." };
  }
  if (vetoes.includes("V1")) {
    return { ...base, decision: "agent", placement, rules: [...rules, "R1", "V1"], note: "Prepares the payment only; the visitor confirms in the site's own checkout." };
  }
  return { ...base, decision: "agent", placement, rules: [...rules, "R1"], note: "" };
}

/**
 * @param {number} p
 * @param {number} fit
 */
function belowThresholdNote(p, fit) {
  const reasons = [];
  if (p < PRIORITY_THRESHOLD) reasons.push(`Priority ${Math.round(p)} is under ${PRIORITY_THRESHOLD}`);
  if (fit < FIT_THRESHOLD) reasons.push(`Fit ${fit} is under ${FIT_THRESHOLD}`);
  return `${reasons.join(" and ")}, so no agent.`;
}

/**
 * Decides every spot and applies the plan-wide cap (rule R3): only the highest-Priority
 * agent spots stay "agent"; the rest move to "plan_next". The result is sorted by
 * Priority, highest first, with the input order breaking ties.
 *
 * @param {Array<object>} spots  see decideSpot
 * @param {{size?: "small"|"medium"|"large"}} [options]
 */
export function decidePlan(spots, options = {}) {
  const size = options.size ?? "small";
  const cap = MAX_AGENT_SPOTS[size];
  if (cap === undefined) throw new RangeError(`unknown site size: ${size}`);

  const decided = spots.map((spot, index) => ({ spot, index, ...decideSpot(spot) }));
  decided.sort((a, b) => b.priority - a.priority || a.index - b.index);

  let agents = 0;
  for (const d of decided) {
    if (d.decision !== "agent") continue;
    agents += 1;
    if (agents > cap) {
      d.decision = "plan_next";
      d.rules = [...d.rules, "R3"];
      d.note = `Over the first-plan limit of ${cap} agent spots for a ${size} site.`;
    }
  }
  return decided.map(({ index, ...rest }) => rest);
}
