// Node-only helpers for the scanner: an HTML parser and two fetchers.
// The browser uses DOMParser and the /api/scan endpoint instead.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseHTML } from "linkedom";
import { SCANNER_AGENT } from "./robots.js";

/** Most bytes read from one page. */
const MAX_BYTES = 2_000_000;

/** Most time for one fetch. */
const TIMEOUT_MS = 10_000;

/**
 * Parses HTML into a standard Document.
 * @param {string} html
 * @returns {Document}
 */
export function parse(html) {
  return parseHTML(html).document;
}

const TYPES = { ".html": "text/html", ".xml": "application/xml", ".txt": "text/plain" };

/**
 * A fetcher that serves a local folder as if it were the site at `origin`.
 * Used by the tests and for scanning the test sites without a server.
 * @param {string} root
 * @param {string} origin
 */
export function folderFetcher(root, origin) {
  const base = path.resolve(root);
  return async (url) => {
    const u = new URL(url);
    if (u.origin !== origin) return { status: 404, contentType: "", text: "" };
    let rel = decodeURIComponent(u.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(base, `.${rel}`);
    if (!file.startsWith(base)) return { status: 404, contentType: "", text: "" };
    try {
      const text = await readFile(file, "utf8");
      return { status: 200, contentType: TYPES[path.extname(file)] ?? "application/octet-stream", text };
    } catch {
      return { status: 404, contentType: "", text: "" };
    }
  };
}

/**
 * A fetcher for real sites: our own user agent, a timeout, a size limit, and no cookies.
 * @param {{userAgent?: string}} [options]
 */
export function httpFetcher(options = {}) {
  const userAgent = options.userAgent ?? `${SCANNER_AGENT}/0.1 (+https://github.com/Jullemyth122/MythAgentic)`;
  return async (url) => {
    const res = await fetch(url, {
      headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const contentType = res.headers.get("content-type") ?? "";
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) return { status: 413, contentType, text: "" };
    const text = (await res.text()).slice(0, MAX_BYTES);
    return { status: res.status, contentType, text };
  };
}
