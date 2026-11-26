// Reads page URLs from a sitemap or a sitemap index. Plain text matching is enough:
// sitemaps are simple XML, and we only need the <loc> values.

/**
 * @param {string} xml
 * @param {string} base  the sitemap's own URL, used to resolve relative locations
 * @returns {{pages: string[], sitemaps: string[]}}  page URLs, and child sitemaps of an index
 */
export function parseSitemap(xml, base) {
  const text = String(xml);
  const isIndex = /<sitemapindex[\s>]/i.test(text);
  const locs = [];
  for (const match of text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    try {
      locs.push(new URL(decodeEntities(match[1]), base).href);
    } catch {
      // Skip a location that is not a URL.
    }
  }
  return isIndex ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] };
}

/** @param {string} s */
function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
