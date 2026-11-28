import { test } from "node:test";
import assert from "node:assert/strict";
import { AssistantDock } from "../src/pack/assistant-dock.js";

const flowers = ["rose", "peony", "tulip", "sunflower", "lily", "lotus", "daisy", "orchid", "carnation", "hydrangea"]
  .map((f) => ({ url: "https://site.test/flower-meanings", heading: `What does a ${f} mean?` }));

test("cited: the answer's sources are the headings whose own words it says", () => {
  const answer = "White roses and white tulips are traditional apology flowers. White peonies can also mean an apology, and hydrangeas are sent for apologies too.";
  assert.deepEqual(AssistantDock.cited(answer, flowers).map((s) => s.heading), [
    "What does a rose mean?", "What does a peony mean?", "What does a tulip mean?", "What does a hydrangea mean?",
  ]);
});

test("cited: words every heading shares (what, does, mean) cite nothing", () => {
  assert.deepEqual(AssistantDock.cited("What does it mean? It depends on what you mean.", flowers), []);
});

test("cited: a section heading needs two of its distinctive words when it has two", () => {
  const sources = [
    { url: "https://site.test/", heading: "Choose your pass. Keep the love going." },
    { url: "https://site.test/flowers/birthday", heading: "Birthday flowers that arrive right on time" },
  ];
  assert.deepEqual(AssistantDock.cited("A pass starts at $1.99. Choose one when you send.", sources).map((s) => s.url), ["https://site.test/"]);
  assert.deepEqual(AssistantDock.cited("Love is in the air.", sources), []);
});
