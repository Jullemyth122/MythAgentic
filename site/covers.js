// Draws each spot's card cover: a small schematic of the real thing on the page
// (a form with its real number of fields, a table with its real rows, a FAQ, a lock).
// Shapes only; the numbers come from the scan.

const TONES = {
  agent: { bg: "#dff3e8", ink: "#0f6b45", soft: "#b9e3cc" },
  plan_next: { bg: "#fdf0d9", ink: "#8a5300", soft: "#f3d8a6" },
  fix: { bg: "#e4ebff", ink: "#2443b8", soft: "#c2d0fb" },
  fine: { bg: "#eeeeec", ink: "#4d4d4a", soft: "#d7d7d3" },
  veto: { bg: "#fde5e2", ink: "#a32014", soft: "#f6c3bc" },
};

/** @param {number} n @param {number} lo @param {number} hi */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * One rounded bar.
 */
function bar(x, y, w, h, fill, r = h / 2) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
}

function formCover(spot, t) {
  const fields = clamp(spot.source?.fields?.length ?? 6, 2, 14);
  const steps = spot.source?.steps ?? 1;
  let y = 28;
  let out = "";
  if (steps > 1) {
    for (let i = 0; i < steps; i += 1) out += `<circle cx="${40 + i * 26}" cy="${y}" r="7" fill="${i === 0 ? t.ink : t.soft}"/>`;
    y += 26;
  }
  for (let i = 0; i < fields; i += 1) {
    out += bar(28, y, 54 + ((i * 37) % 50), 6, t.ink, 3);
    out += bar(28, y + 11, 224, 20, "#fff", 6);
    y += 42;
  }
  out += bar(28, y + 4, 112, 30, t.ink, 15);
  return { h: y + 56, body: out };
}

function compareCover(spot, t) {
  const rows = clamp(spot.source?.rows ?? 6, 3, 12);
  const cols = clamp(spot.source?.cols ?? 4, 3, 6);
  const w = 224 / cols;
  let out = "";
  let y = 28;
  for (let c = 0; c < cols; c += 1) out += bar(28 + c * w + 4, y, w - 12, 8, t.ink, 4);
  y += 22;
  for (let r = 0; r < rows; r += 1) {
    out += bar(28, y - 6, 224, 26, r % 2 ? "#ffffff" : "#ffffffaa", 6);
    for (let c = 0; c < cols; c += 1) out += bar(28 + c * w + 6, y + 3, (w - 16) * (0.5 + ((r + c) % 3) * 0.2), 6, t.soft, 3);
    y += 30;
  }
  return { h: y + 20, body: out };
}

function answersCover(spot, t) {
  const qs = clamp(spot.source?.questions ?? 5, 3, 9);
  let out = "";
  let y = 28;
  for (let i = 0; i < qs; i += 1) {
    out += `<text x="28" y="${y + 10}" font-size="14" font-weight="700" fill="${t.ink}">?</text>`;
    out += bar(44, y, 120 + ((i * 29) % 80), 9, t.ink, 4);
    out += bar(44, y + 17, 200, 5, t.soft, 3);
    out += bar(44, y + 27, 160 - ((i * 17) % 50), 5, t.soft, 3);
    y += 48;
  }
  return { h: y + 12, body: out };
}

function priceCover(spot, t) {
  return {
    h: 210,
    body: `<g transform="translate(90 40)">
      <path d="M0 40 L40 0 H100 V60 L60 100 Z" fill="#fff" stroke="${t.ink}" stroke-width="4" stroke-linejoin="round"/>
      <circle cx="80" cy="20" r="7" fill="${t.ink}"/>
      <text x="50" y="68" font-size="40" font-weight="800" text-anchor="middle" fill="${t.ink}">?</text>
    </g>
    ${bar(60, 168, 160, 8, t.soft, 4)}`,
  };
}

function lockCover(spot, t) {
  return {
    h: 230,
    body: `<g transform="translate(100 44)">
      <path d="M14 56 V36 a26 26 0 0 1 52 0 V56" fill="none" stroke="${t.ink}" stroke-width="9" stroke-linecap="round"/>
      <rect x="0" y="54" width="80" height="66" rx="12" fill="${t.ink}"/>
      <circle cx="40" cy="82" r="8" fill="${t.bg}"/><rect x="36" y="86" width="8" height="18" rx="3" fill="${t.bg}"/>
    </g>
    ${bar(70, 186, 140, 8, t.soft, 4)}`,
  };
}

function slotsCover(spot, t) {
  let out = bar(40, 30, 200, 26, t.ink, 8);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 6; c += 1) {
      const free = (r * 6 + c) % 5 === 1;
      out += `<rect x="${40 + c * 34}" y="${66 + r * 34}" width="28" height="28" rx="6" fill="${free ? t.ink : "#fff"}"/>`;
    }
  }
  return { h: 220, body: out };
}

function pageCover(spot, t) {
  return {
    h: 200,
    body: `<g transform="translate(118 34)">
      <path d="M22 0 a22 22 0 0 1 22 22 c0 18 -22 42 -22 42 s-22 -24 -22 -42 a22 22 0 0 1 22 -22z" fill="${t.ink}"/>
      <circle cx="22" cy="22" r="8" fill="${t.bg}"/>
    </g>
    ${bar(60, 120, 160, 9, t.ink, 4)}${bar(60, 140, 120, 7, t.soft, 3)}${bar(60, 156, 140, 7, t.soft, 3)}`,
  };
}

/**
 * The SVG cover for a spot.
 * @param {object} spot
 * @param {string} decision
 */
export function coverSvg(spot, decision) {
  const t = TONES[decision] ?? TONES.fine;
  let shape;
  if (spot.purpose === "account") shape = lockCover(spot, t);
  else if (spot.kind === "form") shape = formCover(spot, t);
  else if (spot.kind === "compare") shape = compareCover(spot, t);
  else if (spot.kind === "action") shape = slotsCover(spot, t);
  else if (spot.purpose === "price") shape = priceCover(spot, t);
  else if (spot.kind === "answers") shape = answersCover(spot, t);
  else shape = pageCover(spot, t);
  return `<svg viewBox="0 0 280 ${shape.h}" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><rect width="280" height="${shape.h}" fill="${t.bg}"/>${shape.body}</svg>`;
}
