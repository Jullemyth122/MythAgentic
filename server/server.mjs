// MythAgentic local server.
//
//   npm start            then open http://localhost:8090
//
// Serves the MythAgentic website, scans a sample site or any public URL, builds agent packs,
// and hosts the agentified samples so they can be tried in the browser.

import http from "node:http";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crawlSite } from "../src/scanner/crawl.js";
import { folderFetcher, httpFetcher, parse } from "../src/scanner/node.js";
import { findSpots, siteNameOf } from "../src/spots.js";
import { decidePlan } from "../src/score.js";
import { buildPack, listFiles, slugify } from "../src/pack/build.js";
import { zipFolder } from "../src/pack/zip.js";
import { snapshotFor } from "../src/pack/snapshot.js";
import { mirrorPage } from "../src/pack/mirror.js";
import { collectionFor, placementFor } from "../src/pack/build.js";
import { viewHtml, VIEW_HEADERS } from "../src/view.js";
import { briefFor } from "../src/brief.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 8090);
const HOST = process.env.HOST ?? "localhost";

// A local .env may hold META_API_KEY and GEMINI_API_KEY. They are read here only, and
// never sent to a browser.
try { process.loadEnvFile(path.join(ROOT, ".env")); } catch { /* no .env */ }

/** Where the local relay at /byok/v1 forwards to: the Meta Model API (OpenAI-compatible). */
const META_ROUTER = "https://api.meta.ai/v1";

/** The sample sites: made-up businesses with known problems. */
const SAMPLES = [
  { id: "clinic", cover: "book.html", name: "Brightside Dental Clinic", blurb: "A 12-field booking form, insurance questions, prices on request and a patient portal.", tags: ["Healthcare", "Booking"] },
  { id: "tours", cover: "tours.html", name: "Blue Bay Island Tours", blurb: "Six island tours to compare, a reservation form and a long policy page.", tags: ["Travel", "Reservations"] },
  { id: "shop", cover: "catalog.html", name: "Oakline & Co. Furniture", blurb: "Eight similar sofas, every price on request, and a quote form.", tags: ["Retail", "Quotes"] },
  { id: "clear", cover: "menu.html", name: "Sunrise Bakery", blurb: "A clear little bakery site with prices and hours. The right answer is no agent.", tags: ["Food", "No agent"] },
  { id: "cafe", cover: "drinks.html", name: "Corner Street Coffee", blurb: "A coffee shop barista handbook: opening and closing checklists, six drink build cards, food safety questions and a shift swap form.", tags: ["Staff onboarding", "Food service"] },
  { id: "warehouse", cover: "codes.html", name: "Swiftline Logistics", blurb: "A logistics warehouse floor guide: receiving steps, six exception codes, safety rules and a damage report form.", tags: ["Staff onboarding", "Logistics"] },
  { id: "callcenter", cover: "escalation.html", name: "Northstar Support", blurb: "A call center agent handbook: an escalation matrix, call handling questions, leave requests, and a payroll form no AI may touch.", tags: ["Staff onboarding", "Call center"] },
  { id: "social", cover: "rules.html", name: "Clipwave", blurb: "A short video app: community guidelines, a rule breaks table, a report form, a teen consent form no AI may touch, and a moderator console where only people remove clips.", tags: ["Social media", "Moderation"] },
];

/** Scans kept for building packs, newest last. */
const scans = new Map();
const MAX_SCANS = 10;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
  ".hocon": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".zip": "application/zip",
};

/** Folders served as static files, by URL prefix. */
const MOUNTS = [
  { prefix: "/samples/", dir: path.join(ROOT, "test-sites") },
  { prefix: "/generated/", dir: path.join(ROOT, "generated"), cors: true },
  { prefix: "/src/", dir: path.join(ROOT, "src") },
  { prefix: "/", dir: path.join(ROOT, "site") },
];

/**
 * Refuses URLs that point at this machine or a private network.
 * @param {string} raw
 */
async function checkPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That is not a URL. Start it with https://");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https sites can be scanned.");
  if (url.username || url.password) throw new Error("Remove the user name and password from the URL.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new Error(`Could not find ${host}. Check the address.`);
  for (const { address } of addresses) {
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address) || /^(::1|fc|fd|fe80)/i.test(address)) {
      throw new Error("Private and local addresses cannot be scanned. Use a public site, or a sample.");
    }
  }
  return url;
}

/**
 * Scans a sample or a URL and keeps the result for building a pack.
 * @param {{sample?:string, url?:string, permission?:boolean}} body
 */
async function scan(body) {
  let crawl;
  let sample = null;
  // Keep each page's HTML, to show the page as it was read and to build a companion.
  const htmls = new Map();
  const keeping = (fetcher) => async (url) => {
    const res = await fetcher(url);
    if (res.status === 200 && /html/i.test(res.contentType)) htmls.set(url, res.text);
    return res;
  };
  if (body.sample) {
    sample = SAMPLES.find((s) => s.id === body.sample);
    if (!sample) throw new Error("Unknown sample.");
    const origin = `https://${sample.id}.sample`;
    crawl = await crawlSite(`${origin}/`, { fetcher: keeping(folderFetcher(path.join(ROOT, "test-sites", sample.id), origin)), parse });
  } else {
    if (body.permission !== true) throw new Error("Tick the box to confirm you own this site or may scan it.");
    const url = await checkPublicUrl(String(body.url ?? "").trim());
    crawl = await crawlSite(url.href, { fetcher: keeping(httpFetcher()), parse, maxPages: 40 });
    if (crawl.pages.length === 0) {
      const reason = crawl.skipped[0]?.reason ?? "no HTML pages found";
      throw new Error(`Could not read any page (${reason}).`);
    }
  }
  const { size, groups, spots } = findSpots(crawl);
  const plan = decidePlan(spots, { size });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const name = sample?.name ?? siteNameOf(crawl);
  scans.set(id, { id, sample, name, crawl, size, spots, plan, htmls });
  while (scans.size > MAX_SCANS) scans.delete(scans.keys().next().value);

  const jsPages = crawl.pages.filter((p) => p.needsBrowser).length;
  return {
    scanId: id,
    site: {
      name,
      origin: sample ? null : crawl.origin,
      sample: sample?.id ?? null,
      preview: sample ? `/samples/${sample.id}/` : crawl.origin,
      size,
      pages: crawl.pages.map((p) => ({
        path: p.path, title: p.title, url: p.url, h1: p.h1, words: p.words, questions: p.questions,
        headings: p.headings.slice(0, 12),
        forms: p.forms.map((f) => ({ index: f.index, fields: f.fieldCount, submit: f.submitText, password: f.hasPassword })),
        tables: p.tables.map((t, i) => ({ index: i, rows: t.rows, cols: t.cols })),
        priceOnRequest: p.priceOnRequest, pricesShown: p.pricesShown, hasHours: p.hasHours, needsBrowser: p.needsBrowser,
      })),
      groups: groups.map((g) => ({ id: g.id, pages: g.urls.length })),
      skipped: crawl.skipped,
      robotsFound: crawl.robotsFound,
      sitemapFound: crawl.sitemapFound,
      drawnByJs: jsPages,
    },
    spots,
    // The real words of each spot, for the "Improve with AI" helper (text only).
    brief: briefFor({ spots, pages: crawl.pages, htmls, parse }),
  };
}

/**
 * Builds the pack for a kept scan, with the owner's choices.
 * @param {{scanId:string, approved?:string[], values?:Record<string,number>}} body
 */
async function pack(body) {
  const kept = scans.get(body.scanId);
  if (!kept) throw new Error("That scan has expired. Scan the site again.");
  const spots = kept.spots.map((s) => {
    const v = body.values?.[s.id];
    return Number.isInteger(v) && v >= 1 && v <= 5 ? { ...s, scores: { ...s.scores, value: v } } : s;
  });
  const plan = decidePlan(spots, { size: kept.size });
  const name = kept.sample ? kept.sample.id : `site-${slugify(new URL(kept.crawl.origin).hostname)}`;
  const outDir = path.join(ROOT, "generated", name);
  const approved = Array.isArray(body.approved) ? body.approved : null;
  let snapshot = null;
  let mirror = null;
  const livePages = kept.crawl.pages.filter((p) => kept.htmls.has(p.url));
  if (!kept.sample && body.mode !== "companion") {
    // A live site: a preview copy of its scanned pages with the assistant placed on them,
    // so the owner sees their own site agentified. Forms in the copy send nothing.
    const pagePaths = new Set(livePages.map((p) => p.path));
    mirror = {
      pages: livePages.map((p) => ({
        path: p.path,
        html: `<!doctype html>\n${mirrorPage(kept.htmls.get(p.url), { pageUrl: p.url, pagePaths, parse }).documentElement.outerHTML}`,
      })),
    };
  } else if (!kept.sample) {
    // The official live URL mode: a separate companion page that answers from a snapshot.
    const compares = placementFor(plan, approved).spots.filter((s) => s.kind === "compare");
    snapshot = snapshotFor({
      source: `${kept.crawl.origin}/`,
      fetchedAt: new Date().toISOString().slice(0, 10),
      parse,
      pages: livePages.map((p) => ({ url: p.url, title: p.title, html: kept.htmls.get(p.url) })),
      tables: compares.map((s) => ({ collection: collectionFor(s), url: new URL(s.path, kept.crawl.origin).href, tableIndex: s.tableIndex })),
    });
  }
  const result = await buildPack({
    siteName: kept.name,
    plan,
    approved,
    siteDir: kept.sample ? path.join(ROOT, "test-sites", kept.sample.id) : null,
    snapshot,
    mirror,
    // The owner's approved words for the assistant (written with the AI helper); text only.
    tuning: body.tuning ?? null,
    outDir,
  });
  // The page each spot was named after comes first, so the preview opens where the Ask bar is.
  const main = new Set(result.spots.map((s) => s.path));
  const ordered = [...result.mounted].sort((a, b) => Number(main.has(b)) - Number(main.has(a)));
  const after = (p) => (kept.sample || mirror ? `/generated/${name}${p}` : `/generated/${name}/`);
  return {
    ...result,
    name,
    mirror: !!mirror,
    openUrl: after(ordered[0] ?? "/"),
    // Before and after for each page that got the assistant: the page as scanned, and the
    // same page with the assistant placed on it.
    previews: (result.companion ? [] : ordered).map((p) => ({ path: p, before: `/api/view/${kept.id}?path=${encodeURIComponent(p)}`, after: after(p) })),
    zipUrl: `/api/zip/${name}`,
  };
}

/** @param {http.IncomingMessage} req */
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 200_000) throw new Error("Request too large.");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

/** @param {http.ServerResponse} res */
function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

/**
 * Serves a static file from one of the mounts.
 */
async function serveStatic(req, res, pathname) {
  const mount = MOUNTS.find((m) => pathname.startsWith(m.prefix));
  let rel = decodeURIComponent(pathname.slice(mount.prefix.length));
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(mount.dir, rel);
  if (!file.startsWith(mount.dir + path.sep) && file !== mount.dir) return notFound(res);
  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      res.writeHead(301, { location: `${pathname}/` });
      return res.end();
    }
    const headers = { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" };
    if (mount.cors) headers["access-control-allow-origin"] = "*";
    res.writeHead(200, headers);
    res.end(await readFile(file));
  } catch {
    notFound(res);
  }
}

/** @param {http.ServerResponse} res */
function notFound(res) {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

/**
 * Shows one scanned page as it was read, with the asked-for part outlined.
 * GET /api/view/<scanId>?path=/page.html&find=form&index=1
 */
function view(res, scanId, params) {
  const kept = scans.get(scanId);
  if (!kept) return notFound(res);
  const pagePath = params.get("path") ?? "/";
  const page = kept.crawl.pages.find((p) => p.path === pagePath);
  const html = page && kept.htmls.get(page.url);
  if (!html) return notFound(res);
  const base = kept.sample ? `/samples/${kept.sample.id}${pagePath}` : page.url;
  const find = params.get("find");
  const target = find ? { find, index: Number(params.get("index") ?? 0) } : null;
  const out = viewHtml(html, { base, target, parse });
  res.writeHead(200, VIEW_HEADERS);
  return res.end(out.html);
}

/**
 * The AI providers the local relay forwards to. Both speak the OpenAI chat/completions API.
 * The default model is what a fresh setup uses; the owner can change it in the AI key screen.
 */
const PROVIDERS = {
  meta: { name: "Meta Model API", route: "/byok/v1", upstream: META_ROUTER, env: "META_API_KEY", model: "muse-ember-1.0" },
  // Google AI Studio's OpenAI-compatible endpoint. gemini-3.5-flash-lite answered with tool
  // calls in 2-4 s on the free tier (2026-11-27); gemini-2.5-flash is closed to new users.
  gemini: { name: "Google Gemini", route: "/byok/gemini/v1", upstream: "https://generativelanguage.googleapis.com/v1beta/openai", env: "GEMINI_API_KEY", model: "gemini-3.5-flash-lite" },
};

/**
 * Local relay to an AI provider, so the assistant in a pack can call it from the browser
 * without CORS trouble. The browser's key passes through in the Authorization header and
 * is never logged or kept. With no key from the browser (or the "server" placeholder), the
 * provider's key from .env is used. Only the two paths the runtime uses are forwarded.
 */
async function relay(req, res, providerId, sub) {
  const provider = PROVIDERS[providerId];
  if (!provider || !["chat/completions", "models"].includes(sub)) return notFound(res);
  // Only pages on this server may use the relay (and the .env key), never another site.
  const from = req.headers.origin;
  if ((from && from !== `http://${req.headers.host}`) || req.headers["sec-fetch-site"] === "cross-site") {
    return sendJson(res, 403, { error: { message: "The AI relay only answers pages on this server." } });
  }
  const given = req.headers.authorization ?? "";
  // "server" is the placeholder key MythAgentic saves when the key lives in .env.
  const auth = given && !/^Bearer\s*(demo|server)?\s*$/i.test(given)
    ? given
    : process.env[provider.env] ? `Bearer ${process.env[provider.env]}` : "";
  if (!auth) return sendJson(res, 401, { error: { message: `No ${provider.name} key. Add one in MythAgentic's AI key screen, or put ${provider.env} in .env.` } });
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let upstream;
  try {
    upstream = await fetch(`${provider.upstream}/${sub}`, {
      method: req.method,
      headers: { authorization: auth, "content-type": req.headers["content-type"] ?? "application/json", accept: req.headers.accept ?? "application/json" },
      body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    return sendJson(res, 502, { error: { message: `Could not reach ${provider.name}: ${error.message}` } });
  }
  if (providerId === "gemini" && sub === "models" && upstream.ok) {
    // Gemini lists "models/gemini-…" but chat takes "gemini-…". The runtime checks the
    // chosen model against this list before a turn, so list the names chat accepts.
    const list = await upstream.json().catch(() => ({ data: [] }));
    for (const item of list.data ?? []) if (typeof item.id === "string") item.id = item.id.replace(/^models\//, "");
    return sendJson(res, 200, list);
  }
  res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" });
  if (!upstream.body) return res.end();
  for await (const chunk of upstream.body) res.write(chunk);
  return res.end();
}

let busy = false;

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  try {
    const viewMatch = pathname.match(/^\/api\/view\/([a-z0-9]+)$/);
    if (viewMatch && req.method === "GET") return view(res, viewMatch[1], searchParams);
    const relayMatch = pathname.match(/^\/byok(?:\/(gemini))?\/v1\/(.+)$/);
    if (relayMatch) return await relay(req, res, relayMatch[1] ?? "meta", relayMatch[2]);
    if (pathname === "/api/ai-status" && req.method === "GET") {
      // Which providers have a key in .env. Never the key itself.
      const providers = Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, { name: p.name, router: p.route, model: p.model, serverKey: !!process.env[p.env] }]));
      return sendJson(res, 200, { providers });
    }
    if (pathname === "/api/samples" && req.method === "GET") return sendJson(res, 200, SAMPLES.map((s) => ({ ...s, preview: `/samples/${s.id}/`, cover: `/samples/${s.id}/${s.cover}` })));
    if ((pathname === "/api/scan" || pathname === "/api/pack") && req.method === "POST") {
      if (busy) return sendJson(res, 429, { error: "Another scan or build is running. Try again in a moment." });
      busy = true;
      try {
        const body = await readJson(req);
        const started = Date.now();
        const data = pathname === "/api/scan" ? await scan(body) : await pack(body);
        console.log(`${pathname} ${body.sample ?? body.url ?? body.scanId} ${Date.now() - started} ms`);
        return sendJson(res, 200, data);
      } finally {
        busy = false;
      }
    }
    const zip = pathname.match(/^\/api\/zip\/([a-z0-9_-]+)$/);
    if (zip && req.method === "GET") {
      const dir = path.join(ROOT, "generated", zip[1]);
      const files = await listFiles(dir);
      const data = await zipFolder(dir, files, `${zip[1]}-agent-pack`);
      res.writeHead(200, { "content-type": "application/zip", "content-disposition": `attachment; filename="${zip[1]}-agent-pack.zip"` });
      return res.end(data);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return notFound(res);
    return await serveStatic(req, res, pathname);
  } catch (error) {
    if (error.code === "NOTHING_TO_BUILD") return sendJson(res, 400, { error: error.message });
    console.error(error);
    return sendJson(res, 400, { error: error.message || "Something went wrong." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`MythAgentic is running: http://${HOST}:${PORT}`);
});
