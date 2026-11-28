import { test } from "node:test";
import assert from "node:assert/strict";
import { closeJson, parseReply } from "../site/tune.js";

test("parseReply: a plain JSON reply, and one inside a code fence with text around it", () => {
  assert.deepEqual(parseReply('{"reply":"Hi","rules":["a"]}'), { reply: "Hi", rules: ["a"] });
  assert.deepEqual(parseReply('Here you go:\n```json\n{"reply":"Hi \\"there\\""}\n```\nDone.'), { reply: 'Hi "there"' });
});

test("parseReply: a reply cut off mid-string keeps everything before the cut", () => {
  // As muse-wonder-1.0 sent it when it ran out of room.
  const cut = '{"reply": "Sorry, my last reply came out empty.", "ideas": [{"title": "Flower meanings answer desk", "pattern": "answer desk", "facts": ["21 questions"]}, {"title": "Homepage form filler", "why": "This would not pay off. The scan marked both forms fine, each has only 1 field, so';
  const j = parseReply(cut);
  assert.equal(j.reply, "Sorry, my last reply came out empty.");
  assert.equal(j.ideas.length, 2);
  assert.equal(j.ideas[0].title, "Flower meanings answer desk");
  assert.match(j.ideas[1].why, /only 1 field, so$/);
});

test("closeJson: drops a dangling key or comma, and ends an escape cut in half", () => {
  assert.deepEqual(JSON.parse(closeJson('{"a": 1, "gree')), { a: 1 });
  assert.deepEqual(JSON.parse(closeJson('{"a": 1, "b":')), { a: 1 });
  assert.deepEqual(JSON.parse(closeJson('{"a": [1, 2,')), { a: [1, 2] });
  assert.deepEqual(JSON.parse(closeJson('{"a": "x\\')), { a: "x" });
  assert.equal(closeJson("no json here"), null);
  assert.deepEqual(parseReply("Just text."), { reply: "Just text." });
});
