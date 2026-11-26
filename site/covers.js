// Draws each spot's card cover: a small schematic of the real thing on the page
// (a form with its real number of fields, a table with its real rows, a FAQ, a lock),
// on a dot grid. Colours come from CSS classes, so covers follow the card's decision
// tone and the light or dark theme. The numbers come from the scan.

let uid = 0;

/** @param {number} n @param {number} lo @param {number} hi */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** A rounded rectangle with a class. */
const r = (x, y, w, h, cls, rx = Math.min(h / 2, 6)) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="${cls}"/>`;

/** A white panel that holds the schematic. */
const panel = (x, y, w, h) => r(x, y, w, h, "cv-card", 12);

function formCover(spot) {
  const fields = clamp(spot.source?.fields?.length ?? 6, 2, 14);
  const steps = spot.source?.steps ?? 1;
  let y = 42;
  let out = "";
  if (steps > 1) {
    for (let i = 0; i < steps; i += 1) {
      out += `<circle cx="${50 + i * 24}" cy="${y}" r="6" class="${i === 0 ? "cv-tone" : "cv-soft"}"/>`;
      if (i < steps - 1) out += r(58 + i * 24, y - 1, 8, 2, "cv-soft", 1);
    }
    y += 22;
  }
  for (let i = 0; i < fields; i += 1) {
    out += r(42, y, 46 + ((i * 37) % 46), 5, "cv-line", 2.5);
    out += r(42, y + 10, 196, 18, "cv-soft", 5);
    y += 36;
  }
  out += r(42, y + 4, 96, 26, "cv-tone", 7);
  out += r(146, y + 4, 60, 26, "cv-soft", 7);
  const h = y + 54;
  return { h, body: panel(24, 22, 232, h - 44) + out };
}

function compareCover(spot) {
  const rows = clamp(spot.source?.rows ?? 6, 3, 12);
  const cols = clamp(spot.source?.cols ?? 4, 3, 6);
  const w = 196 / cols;
  let out = "";
  let y = 44;
  for (let c = 0; c < cols; c += 1) out += r(42 + c * w + 3, y, w - 14, 6, "cv-line", 3);
  y += 18;
  for (let i = 0; i < rows; i += 1) {
    const pick = i === 1;
    out += r(36, y - 6, 208, 24, pick ? "cv-tone-soft" : i % 2 ? "cv-card" : "cv-bg", 6);
    for (let c = 0; c < cols; c += 1) out += r(42 + c * w + 3, y + 3, (w - 14) * (0.45 + ((i + c) % 3) * 0.2), 5, pick ? "cv-tone" : "cv-soft", 2.5);
    y += 28;
  }
  const h = y + 30;
  return { h, body: panel(24, 22, 232, h - 44) + out };
}

function answersCover(spot) {
  const qs = clamp(spot.source?.questions ?? 5, 3, 9);
  let out = "";
  let y = 42;
  for (let i = 0; i < qs; i += 1) {
    out += `<circle cx="51" cy="${y + 7}" r="9" class="${i === 0 ? "cv-tone" : "cv-tone-soft"}"/>`;
    out += `<text x="51" y="${y + 11}" text-anchor="middle" font-size="11" class="${i === 0 ? "cv-hole" : "cv-text"}" font-weight="700">?</text>`;
    out += r(68, y + 1, 96 + ((i * 29) % 70), 7, "cv-line", 3.5);
    out += r(68, y + 15, 164, 4, "cv-soft", 2);
    out += r(68, y + 24, 128 - ((i * 17) % 40), 4, "cv-soft", 2);
    y += 42;
  }
  const h = y + 26;
  return { h, body: panel(24, 22, 232, h - 44) + out };
}

function priceCover() {
  return {
    h: 220,
    body: `${panel(24, 22, 232, 176)}
      <g transform="translate(98 48)">
        <path d="M0 42 L42 0 H84 V42 L42 84 Z" class="cv-tone-soft"/>
        <path d="M0 42 L42 0 H84 V42 L42 84 Z" class="cv-stroke" stroke-width="3" stroke-linejoin="round"/>
        <circle cx="66" cy="18" r="6" class="cv-tone"/>
        <text x="40" y="56" font-size="30" text-anchor="middle" class="cv-text">?</text>
      </g>
      ${r(70, 156, 140, 7, "cv-line", 3.5)}${r(92, 170, 96, 5, "cv-soft", 2.5)}`,
  };
}

function lockCover() {
  return {
    h: 230,
    body: `${panel(24, 22, 232, 186)}
      <g transform="translate(106 46)">
        <path d="M12 50 V32 a22 22 0 0 1 44 0 V50" class="cv-stroke" stroke-width="8" stroke-linecap="round"/>
        <rect x="0" y="48" width="68" height="58" rx="12" class="cv-tone"/>
        <circle cx="34" cy="72" r="7" class="cv-hole"/><rect x="31" y="75" width="6" height="15" rx="3" class="cv-hole"/>
      </g>
      ${r(58, 168, 164, 18, "cv-soft", 5)}`,
  };
}

function slotsCover() {
  let out = r(46, 44, 188, 22, "cv-tone", 7);
  for (let i = 0; i < 4; i += 1) {
    for (let c = 0; c < 6; c += 1) {
      const free = (i * 6 + c) % 5 === 1;
      out += r(46 + c * 32, 76 + i * 30, 26, 24, free ? "cv-tone-soft" : "cv-soft", 6);
    }
  }
  return { h: 230, body: panel(24, 22, 232, 186) + out };
}

function pageCover() {
  return {
    h: 210,
    body: `${panel(24, 22, 232, 166)}
      <g transform="translate(120 42)">
        <path d="M20 0 a20 20 0 0 1 20 20 c0 16 -20 38 -20 38 s-20 -22 -20 -38 a20 20 0 0 1 20 -20z" class="cv-tone"/>
        <circle cx="20" cy="20" r="7" class="cv-hole"/>
      </g>
      ${r(60, 118, 160, 8, "cv-line", 4)}${r(60, 136, 120, 5, "cv-soft", 2.5)}${r(60, 150, 140, 5, "cv-soft", 2.5)}`,
  };
}

/**
 * The SVG cover for a spot. Put it inside an element with a decision class (d-agent…).
 * @param {object} spot
 */
export function coverSvg(spot) {
  let shape;
  if (spot.purpose === "account") shape = lockCover(spot);
  else if (spot.kind === "form") shape = formCover(spot);
  else if (spot.kind === "compare") shape = compareCover(spot);
  else if (spot.kind === "action") shape = slotsCover(spot);
  else if (spot.purpose === "price") shape = priceCover(spot);
  else if (spot.kind === "answers") shape = answersCover(spot);
  else shape = pageCover(spot);
  uid += 1;
  const id = `cvdots${uid}`;
  return `<svg viewBox="0 0 280 ${shape.h}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <defs><pattern id="${id}" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.2" r="1.1" class="cv-dot"/></pattern></defs>
    <rect width="280" height="${shape.h}" class="cv-bg"/><rect width="280" height="${shape.h}" fill="url(#${id})"/>${shape.body}</svg>`;
}
