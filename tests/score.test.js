import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePlan, decideSpot, priority, vetoesFor } from "../src/score.js";

const twoSignals = [
  { id: "a", text: "signal a" },
  { id: "b", text: "signal b" },
];

/** The made-up dental clinic from the build plan, with the plan's own scores. */
const dentalSpots = [
  { id: "booking", kind: "form", scores: { friction: 5, value: 5, fit: 5, effort: 1, risk: 2 }, signals: twoSignals },
  { id: "hmo", kind: "answers", scores: { friction: 3, value: 4, fit: 4, effort: 1, risk: 1 }, signals: twoSignals },
  { id: "prices", kind: "answers", scores: { friction: 4, value: 2, fit: 2, effort: 1, risk: 1 }, signals: twoSignals, fixes: [{ text: "Publish your prices" }] },
  { id: "check_slots", kind: "action", scores: { friction: 3, value: 5, fit: 4, effort: 3, risk: 1 }, signals: twoSignals, needsConnector: true },
  { id: "contact", kind: "page", scores: { friction: 2, value: 2, fit: 1, effort: 1, risk: 1 }, signals: twoSignals, fixes: [{ text: "Add opening hours" }] },
  { id: "portal", kind: "form", scores: { friction: 4, value: 5, fit: 3, effort: 5, risk: 5 }, flags: { regulated: true }, signals: twoSignals },
];

test("Priority follows the formula, max 125", () => {
  assert.equal(priority({ friction: 5, value: 5, fit: 5, effort: 1, risk: 1 }), 125);
  assert.equal(priority({ friction: 5, value: 5, fit: 5, effort: 1, risk: 2 }), 62.5);
  assert.throws(() => priority({ friction: 6, value: 1, fit: 1, effort: 1, risk: 1 }), RangeError);
  assert.throws(() => priority({ friction: 1, value: 1, fit: 1, effort: 0, risk: 1 }), RangeError);
  assert.throws(() => priority({ friction: 2.5, value: 1, fit: 1, effort: 1, risk: 1 }), RangeError);
});

test("the dental example from the build plan gives the plan's decisions", () => {
  const plan = decidePlan(dentalSpots, { size: "small" });
  const byId = Object.fromEntries(plan.map((d) => [d.spot.id, d]));

  assert.deepEqual(
    plan.map((d) => [d.spot.id, Math.round(d.priority)]),
    [["booking", 63], ["hmo", 48], ["check_slots", 20], ["prices", 16], ["contact", 4], ["portal", 2]],
  );
  assert.equal(byId.booking.decision, "agent");
  assert.equal(byId.booking.placement, "inline_form_helper");
  assert.equal(byId.hmo.decision, "agent");
  assert.equal(byId.hmo.placement, "answer_desk");
  assert.equal(byId.check_slots.decision, "plan_next");
  assert.deepEqual(byId.check_slots.rules, ["R1", "R6"]);
  assert.equal(byId.prices.decision, "fix");
  assert.equal(byId.prices.note, "Priority 16 is under 20 and Fit 2 is under 3, so no agent.");
  assert.deepEqual(byId.prices.fixes, ["Publish your prices"]);
  assert.equal(byId.contact.decision, "fix");
  assert.equal(byId.portal.decision, "veto");
  assert.equal(byId.portal.placement, "human_handoff");
  assert.deepEqual(byId.portal.rules, ["V2"]);
});

test("a veto applies whatever the score", () => {
  const d = decideSpot({ id: "x", kind: "form", scores: { friction: 5, value: 5, fit: 5, effort: 1, risk: 5 }, flags: { minors: true }, signals: twoSignals });
  assert.equal(Math.round(d.priority), 25);
  assert.equal(d.decision, "veto");
  assert.deepEqual(d.rules, ["V4"]);
});

test("every veto that applies is cited, strictest first; only at Risk 5", () => {
  const all = { minors: true, secrets: true, regulated: true, payment: true };
  assert.deepEqual(vetoesFor({ risk: 4 }, all), []);
  assert.deepEqual(vetoesFor({ risk: 5 }, all), ["V4", "V2", "V3", "V1"]);
  assert.deepEqual(vetoesFor({ risk: 5 }, { payment: true }), ["V1"]);
  assert.deepEqual(vetoesFor({ risk: 5 }, {}), ["V2"]);
  const login = decideSpot({ id: "portal", kind: "form", scores: { friction: 3, value: 5, fit: 3, effort: 5, risk: 5 }, flags: { regulated: true, secrets: true }, signals: twoSignals });
  assert.equal(login.decision, "veto");
  assert.equal(login.placement, "human_handoff");
  assert.deepEqual(login.rules, ["V2", "V3"]);
});

test("below the threshold with nothing to fix is fine, not a fix", () => {
  const d = decideSpot({ id: "hours", kind: "page", scores: { friction: 1, value: 2, fit: 1, effort: 1, risk: 1 }, signals: twoSignals });
  assert.equal(d.decision, "fine");
  assert.deepEqual(d.fixes, []);
});

test("a payment spot keeps its agent but only prepares the payment (V1)", () => {
  const d = decideSpot({ id: "checkout", kind: "form", scores: { friction: 5, value: 5, fit: 4, effort: 1, risk: 5 }, flags: { payment: true }, signals: twoSignals });
  assert.equal(d.decision, "agent");
  assert.deepEqual(d.rules, ["R1", "V1"]);
});

test("a fix that removes the need wins over a high score (R2)", () => {
  const d = decideSpot({ id: "hours", kind: "answers", scores: { friction: 5, value: 5, fit: 5, effort: 1, risk: 1 }, signals: twoSignals, fixes: [{ text: "Add opening hours", removesNeed: true }] });
  assert.equal(d.decision, "fix");
  assert.deepEqual(d.rules, ["R2"]);
});

test("fewer than two signals is marked low confidence (R5)", () => {
  const d = decideSpot({ id: "faq", kind: "answers", scores: { friction: 3, value: 4, fit: 4, effort: 1, risk: 1 }, signals: [{ id: "a", text: "one" }] });
  assert.equal(d.confidence, "low");
  assert.deepEqual(d.rules, ["R5", "R1"]);
});

test("the first-plan cap keeps the top spots and moves the rest to plan next (R3)", () => {
  const strong = (id, friction) => ({ id, kind: "form", scores: { friction, value: 5, fit: 5, effort: 1, risk: 1 }, signals: twoSignals });
  const spots = [strong("a", 2), strong("b", 5), strong("c", 4), strong("d", 3)];
  const plan = decidePlan(spots, { size: "small" });
  assert.deepEqual(plan.map((d) => [d.spot.id, d.decision]), [["b", "agent"], ["c", "agent"], ["d", "agent"], ["a", "plan_next"]]);
  assert.ok(plan[3].rules.includes("R3"));
  assert.equal(decidePlan(spots, { size: "medium" }).filter((d) => d.decision === "agent").length, 4);
  assert.throws(() => decidePlan(spots, { size: "huge" }), RangeError);
});
