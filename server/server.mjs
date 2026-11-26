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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 8090);
const HOST = process.env.HOST ?? "localhost";

/** The sample sites: made-up businesses with known problems. */
const SAMPLES = [
  { id: "clinic", cover: "book.html", name: "Ngiti Dental Clinic", blurb: "A 12-field booking form, HMO questions, prices on request and a patient portal.", tags: ["Healthcare", "Booking"] },
  { id: "tours", cover: "tours.html", name: "Isla Verde Tours", blurb: "Six island tours to compare, a reservation form and a long policy page.", tags: ["Travel", "Reservations"] },
  { id: "shop", cover: "catalog.html", name: "Narra & Co. Furniture", blurb: "Eight similar sofas, every price on request, and a quote form.", tags: ["Retail", "Quotes"] },
  { id: "clear", cover: "menu.html", name: "Panaderya Liwayway", blurb: "A clear little bakery site with prices and hours. The right answer is no agent.", tags: ["Food", "No agent"] },
];

/** Scans kept for building packs, newest last. */
const scans = new Map();
const MAX_SCANS = 30;

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
  if (body.sample) {
    sample = SAMPLES.find((s) => s.id === body.sample);
    if (!sample) throw new Error("Unknown sample.");
    const origin = `https://${sample.id}.sample`;
    crawl = await crawlSite(`${origin}/`, { fetcher: folderFetcher(path.join(ROOT, "test-sites", sample.id), origin), parse });
  } else {
    if (body.permission !== true) throw new Error("Tick the box to confirm you own this site or may scan it.");
    const url = await checkPublicUrl(String(body.url ?? "").trim());
    crawl = await crawlSite(url.href, { fetcher: httpFetcher(), parse, maxPages: 40 });
    if (crawl.pages.length === 0) {
      const reason = crawl.skipped[0]?.reason ?? "no HTML pages found";
      throw new Error(`Could not read any page (${reason}).`);
    }
  }
  const { size, groups, spots } = findSpots(crawl);
  const plan = decidePlan(spots, { size });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const name = sample?.name ?? siteNameOf(crawl);
  scans.set(id, { id, sample, name, crawl, size, spots, plan });
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
      pages: crawl.pages.map((p) => ({ path: p.path, title: p.title, url: p.url })),
      groups: groups.map((g) => ({ id: g.id, pages: g.urls.length })),
      skipped: crawl.skipped,
      robotsFound: crawl.robotsFound,
      sitemapFound: crawl.sitemapFound,
      drawnByJs: jsPages,
    },
    spots,
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
  const result = await buildPack({
    siteName: kept.name,
    plan,
    approved: Array.isArray(body.approved) ? body.approved : null,
    siteDir: kept.sample ? path.join(ROOT, "test-sites", kept.sample.id) : null,
    outDir,
  });
  return {
    ...result,
    name,
    openUrl: kept.sample ? `/generated/${name}${result.mounted[0] ?? "/"}` : null,
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

let busy = false;

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  try {
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
