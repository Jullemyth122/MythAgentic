// A small robots.txt reader: groups, Allow/Disallow with * and $, and Sitemap lines.
// Follows RFC 9309: the longest matching rule wins, and Allow wins a tie.

/** The user agent our scanner announces and matches in robots.txt. */
export const SCANNER_AGENT = "MythAgenticScanner";

/**
 * Parses robots.txt text.
 * @param {string} text
 * @returns {{groups: Array<{agents:string[], rules:Array<{allow:boolean, path:string}>}>, sitemaps:string[]}}
 */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
    } else if ((key === "allow" || key === "disallow") && current) {
      // An empty Disallow allows everything, so it adds no rule.
      if (value) current.rules.push({ allow: key === "allow", path: value });
    }
  }
  return { groups, sitemaps };
}

/**
 * @param {string} pattern robots path pattern, may use * and a trailing $
 * @param {string} path
 */
function ruleMatches(pattern, path) {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${regex}${anchored ? "$" : ""}`).test(path);
}

/**
 * Whether robots.txt lets our scanner fetch a path. Uses our own group if there is one,
 * otherwise the * group.
 * @param {ReturnType<typeof parseRobots>} robots
 * @param {string} path  the URL path plus query, such as "/book.html?x=1"
 * @param {string} [agent]
 */
export function isAllowed(robots, path, agent = SCANNER_AGENT) {
  const name = agent.toLowerCase();
  const own = robots.groups.filter((g) => g.agents.some((a) => a !== "*" && name.includes(a)));
  const groups = own.length > 0 ? own : robots.groups.filter((g) => g.agents.includes("*"));
  let best = null;
  for (const rule of groups.flatMap((g) => g.rules)) {
    if (!ruleMatches(rule.path, path)) continue;
    const longer = !best || rule.path.length > best.path.length;
    const tieAllow = best && rule.path.length === best.path.length && rule.allow;
    if (longer || tieAllow) best = rule;
  }
  return best ? best.allow : true;
}
