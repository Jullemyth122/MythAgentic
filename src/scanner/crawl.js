// Crawls one site politely: same origin only, robots.txt respected, a page limit, and no
// account, cart or checkout pages. A login page is measured (it is public) but never
// submitted, and its links are not followed.

import { isAllowed, parseRobots } from "./robots.js";
import { parseSitemap } from "./sitemap.js";
import { measurePage } from "./page.js";

/** Default most pages to fetch from one site. */
export const MAX_PAGES = 60;

/** Paths the scanner never fetches without the owner's same-origin script. */
const PRIVATE_PATH = /\/(checkout|cart|basket|account|my-account|profile|admin|wp-admin|logout|signout)(\/|\.|$)/i;

/** Files that are not pages. */
const NOT_A_PAGE = /\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|json|xml|txt|zip|mp4|mp3|woff2?)$/i;

/**
 * @typedef {(url: string) => Promise<{status:number, contentType:string, text:string}>} Fetcher
 * @typedef {(html: string) => Document} Parser
 */

/**
 * Crawls a site from its start URL.
 *
 * @param {string} startUrl
 * @param {{fetcher: Fetcher, parse: Parser, maxPages?: number}} options
 * @returns {Promise<{origin:string, robotsFound:boolean, sitemapFound:boolean,
 *   pages: ReturnType<typeof measurePage>[], skipped: Array<{url:string, reason:string}>}>}
 */
export async function crawlSite(startUrl, { fetcher, parse, maxPages = MAX_PAGES }) {
  const start = new URL(startUrl);
  const origin = start.origin;
  const skipped = [];

  let robots = { groups: [], sitemaps: [] };
  let robotsFound = false;
  try {
    const res = await fetcher(`${origin}/robots.txt`);
    if (res.status === 200) {
      robots = parseRobots(res.text);
      robotsFound = true;
    }
  } catch {
    // No robots.txt: everything is allowed.
  }

  const queue = [start.href];
  let sitemapFound = false;
  const sitemapUrls = robots.sitemaps.length > 0 ? robots.sitemaps : [`${origin}/sitemap.xml`];
  for (const sm of sitemapUrls.slice(0, 5)) {
    try {
      const smUrl = new URL(sm, origin).href;
      const res = await fetcher(smUrl);
      if (res.status !== 200) continue;
      const parsed = parseSitemap(res.text, smUrl);
      queue.push(...parsed.pages);
      sitemapFound = sitemapFound || parsed.pages.length > 0;
      for (const child of parsed.sitemaps.slice(0, 5)) {
        const childRes = await fetcher(child);
        if (childRes.status === 200) queue.push(...parseSitemap(childRes.text, child).pages);
      }
    } catch {
      // A broken sitemap is not fatal: links still lead to pages.
    }
  }

  const seen = new Set();
  const pages = [];
  while (queue.length > 0 && pages.length < maxPages) {
    const url = normalize(queue.shift());
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const parsedUrl = new URL(url);
    if (parsedUrl.origin !== origin) continue;
    if (NOT_A_PAGE.test(parsedUrl.pathname)) continue;
    if (PRIVATE_PATH.test(parsedUrl.pathname)) {
      skipped.push({ url, reason: "account, cart or checkout page" });
      continue;
    }
    if (!isAllowed(robots, parsedUrl.pathname + parsedUrl.search)) {
      skipped.push({ url, reason: "robots.txt disallows it" });
      continue;
    }

    let res;
    try {
      res = await fetcher(url);
    } catch (error) {
      skipped.push({ url, reason: `could not fetch: ${error.message}` });
      continue;
    }
    if (res.status !== 200) {
      skipped.push({ url, reason: `HTTP ${res.status}` });
      continue;
    }
    if (!/html/i.test(res.contentType)) continue;

    const page = measurePage(parse(res.text), url);
    pages.push(page);
    const isLogin = page.forms.some((f) => f.hasPassword);
    if (!isLogin) {
      for (const link of page.links) queue.push(link.url);
    }
  }
  if (queue.length > 0 && pages.length >= maxPages) {
    skipped.push({ url: origin, reason: `stopped at the ${maxPages}-page limit` });
  }
  return { origin, robotsFound, sitemapFound, pages, skipped };
}

/**
 * Drops the hash and treats "/" and "/index.html" as one page.
 * @param {string} url
 */
function normalize(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    if (u.pathname.endsWith("/index.html")) u.pathname = u.pathname.slice(0, -"index.html".length);
    return u.href;
  } catch {
    return null;
  }
}
