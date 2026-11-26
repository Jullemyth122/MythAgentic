// Groups pages that share a layout (template), so a big site needs few decisions.
//
// Each page's fingerprint is a 64-bit simhash of its tag paths (such as
// "main>table>tr>td"), ignoring text. Pages with nearly the same fingerprint in the same
// folder are one template group.

/** Most differing bits for two pages to count as the same template. */
export const MAX_DISTANCE = 3;

/** Fewest pages that make a template group. Smaller sets stay single pages. */
export const MIN_GROUP = 3;

const MASK = (1n << 64n) - 1n;

/**
 * FNV-1a 64-bit hash of a string.
 * @param {string} s
 */
function fnv64(s) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i += 1) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & MASK;
  }
  return h;
}

/**
 * The tag paths of an element's descendants, such as "main>form>fieldset>input".
 * Scripts, styles and inline text tags are left out; only layout matters.
 * @param {Element} root
 * @returns {string[]}
 */
export function tagPaths(root) {
  const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "B", "I", "EM", "STRONG", "SPAN", "BR", "OPTION"]);
  const paths = [];
  const walk = (el, prefix) => {
    for (const child of el.children ?? []) {
      if (skip.has(child.tagName)) continue;
      const path = `${prefix}>${child.tagName.toLowerCase()}`;
      paths.push(path);
      walk(child, path);
    }
  };
  walk(root, root.tagName.toLowerCase());
  return paths;
}

/**
 * The simhash of a list of features.
 * @param {string[]} features
 * @returns {bigint}
 */
export function simhash(features) {
  const weights = new Array(64).fill(0);
  for (const feature of features) {
    const h = fnv64(feature);
    for (let bit = 0; bit < 64; bit += 1) weights[bit] += (h >> BigInt(bit)) & 1n ? 1 : -1;
  }
  let out = 0n;
  for (let bit = 0; bit < 64; bit += 1) if (weights[bit] > 0) out |= 1n << BigInt(bit);
  return out;
}

/**
 * Number of differing bits.
 * @param {bigint} a
 * @param {bigint} b
 */
export function distance(a, b) {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/**
 * The folder part of a URL path: "/products/a.html" → "/products/".
 * @param {string} url
 */
function folderOf(url) {
  const path = new URL(url).pathname;
  return path.slice(0, path.lastIndexOf("/") + 1);
}

/**
 * Groups pages by template. A group holds at least MIN_GROUP pages in the same folder
 * whose fingerprints are within MAX_DISTANCE of the group's first page.
 *
 * @param {Array<{url:string, hash:bigint}>} pages
 * @returns {Array<{id:string, folder:string, urls:string[], representative:string}>}
 *   in the input order of each group's first page; single pages are groups of one
 */
export function groupByTemplate(pages) {
  const byFolder = new Map();
  for (const page of pages) {
    const folder = folderOf(page.url);
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(page);
  }

  const assigned = new Map();
  for (const [folder, list] of byFolder) {
    const left = [...list];
    while (left.length > 0) {
      const first = left.shift();
      const members = [first];
      for (let i = left.length - 1; i >= 0; i -= 1) {
        if (distance(first.hash, left[i].hash) <= MAX_DISTANCE) members.push(...left.splice(i, 1));
      }
      if (members.length >= MIN_GROUP) {
        const group = { folder, urls: pages.filter((p) => members.includes(p)).map((p) => p.url) };
        for (const m of members) assigned.set(m.url, group);
      } else {
        left.unshift(...members.slice(1));
        assigned.set(first.url, { folder, urls: [first.url] });
      }
    }
  }

  const groups = [];
  const seen = new Set();
  for (const page of pages) {
    const group = assigned.get(page.url);
    if (seen.has(group)) continue;
    seen.add(group);
    const id = group.urls.length > 1 ? `template:${group.folder}` : `page:${new URL(page.url).pathname}`;
    groups.push({ id, folder: group.folder, urls: group.urls, representative: group.urls[0] });
  }
  return groups;
}
