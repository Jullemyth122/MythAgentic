import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/scanner/node.js";
import { viewHtml, VIEW_HEADERS } from "../src/view.js";

const page = `<!doctype html><html><head><title>T</title><script>alert(1)</script><meta http-equiv="refresh" content="0;url=https://evil.test"></head>
<body onload="steal()"><h1>Book</h1><form id="search"><input name="q"></form>
<form id="booking"><input name="name"><button onclick="x()">Send</button></form>
<table><tr><td>a</td></tr></table><h2>Is it covered?</h2><p>Sofa <span>Price on request</span></p></body></html>`;

test("view: scripts and handlers are removed, the target is outlined, links go to the real site", () => {
  const { html, found } = viewHtml(page, { base: "https://shop.test/book.html", target: { find: "form", index: 2 }, parse });
  assert.equal(found, true);
  assert.doesNotMatch(html, /<script|onload|onclick|http-equiv/i);
  assert.match(html, /<base href="https:\/\/shop.test\/book.html">/);
  assert.match(html, /<span[^>]*id="ma-target"[^>]*><\/span><form(?=[^>]*id="booking")[^>]*data-ma-target[^>]*><input name="name">/, "the second form, numbered from 1 as in measurePage; it keeps its own id");
  assert.match(VIEW_HEADERS["content-security-policy"], /sandbox; script-src 'none'/);
});

test("view: finds the first question and the smallest price-on-request element", () => {
  assert.match(viewHtml(page, { base: "https://x.test/", target: { find: "question", index: 0 }, parse }).html, /<span[^>]*id="ma-target"[^>]*><\/span><h2 data-ma-target="">Is it covered\?/);
  assert.match(viewHtml(page, { base: "https://x.test/", target: { find: "price", index: 0 }, parse }).html, /<span[^>]*id="ma-target"[^>]*><\/span><span data-ma-target="">Price on request/);
  assert.equal(viewHtml(page, { base: "https://x.test/", target: { find: "page", index: 0 }, parse }).found, false);
});
