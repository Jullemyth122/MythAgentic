// Runs on every page of a MythAgentic preview copy: says what this page is, and stops every
// form from going anywhere (the copy must never send anything to the real site).

const banner = document.createElement("div");
banner.className = "mythagentic-preview";
banner.setAttribute("role", "note");
banner.title = "A copy of this site with its assistant placed by MythAgentic. The site's own scripts are off, so parts drawn by JavaScript stay empty, and forms send nothing.";
banner.innerHTML = '<span class="mythagentic-preview__dot"></span><b>Preview copy</b><span>site scripts off · forms send nothing</span>';
document.body.append(banner);

// Sites often keep content invisible until their own script plays an entrance animation:
// a "reveal on scroll" class, or a rule like `.hero:not([data-intro]) .hero-text > * {
// opacity: 0 }` that waits for the script to add an attribute. With the site's scripts off,
// that content would never appear. So: show every element that is invisible (opacity 0 or
// visibility hidden) but holds text or a picture and takes up room in the page flow.
// Menus, dialogs, tooltips and decorative layers stay as the site has them.
const KEEP_HIDDEN = /menu|dropdown|tooltip|modal|popover|drawer|toast|dialog|overlay|lightbox|sr-only|visually-hidden|skip/i;

function holdsContent(el) {
  return el.textContent.trim().length > 0 || !!el.querySelector("img, picture, svg, video, canvas");
}

function shouldShow(el, style) {
  if (style.display === "none") return false;
  if (!(Number(style.opacity) === 0 || style.visibility === "hidden")) return false;
  if (el.closest("#assistant, .agent-coach, .agent-go, .mythagentic-preview, [aria-hidden='true'], [role=dialog], [role=menu], [role=tooltip], dialog, nav")) return false;
  const names = `${typeof el.className === "string" ? el.className : ""} ${el.id}`;
  if (KEEP_HIDDEN.test(names)) return false;
  // An absolutely placed, click-through layer is decoration (a glow, a pattern).
  if ((style.position === "absolute" || style.position === "fixed") && style.pointerEvents === "none") return false;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && holdsContent(el);
}

/** The nearest ancestor that clips its children (overflow hidden or clip), or null. */
function clipper(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/hidden|clip/.test(s.overflow + s.overflowX + s.overflowY)) return p;
  }
  return null;
}

/**
 * The other common entrance: text slid out of a clipping box ("mask reveal": an inner line
 * moved 100% down inside an overflow-hidden line), or cut away with clip-path. Without the
 * script the text never slides back in, so put it back in place.
 */
function unslide(el, style) {
  if (el.closest("#assistant, .agent-coach, .agent-go, [aria-hidden='true'], nav, dialog")) return;
  if (!el.textContent.trim() && !el.querySelector("img, svg, picture")) return;
  if (/inset\(.*100%|circle\(0|polygon\(0(px)? 0(px)?, 0(px)? 0(px)?/.test(style.clipPath)) {
    el.style.setProperty("clip-path", "none", "important");
  }
  if (style.transform === "none") return;
  const box = clipper(el);
  if (!box) return;
  const a = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  // Less than a quarter of it shows inside the clipping box: it was slid out of view.
  const shownH = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const shownW = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  if (shownH < a.height * 0.25 || shownW < a.width * 0.25) {
    el.style.setProperty("transform", "none", "important");
    el.style.setProperty("transition", "none", "important");
    el.style.setProperty("animation", "none", "important");
  }
}

function showStaticContent() {
  for (const el of document.querySelectorAll("body *")) {
    const style = getComputedStyle(el);
    unslide(el, style);
    if (!shouldShow(el, style)) continue;
    el.style.setProperty("opacity", "1", "important");
    el.style.setProperty("visibility", "visible", "important");
    el.style.setProperty("transform", "none", "important");
    el.style.setProperty("animation", "none", "important");
    // No fade: a transition would start from the hidden state.
    el.style.setProperty("transition", "none", "important");
  }
}

// Run now, and again once the site's stylesheets and fonts have loaded.
showStaticContent();
addEventListener("load", () => { showStaticContent(); setTimeout(showStaticContent, 600); });

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  let receipt = form.querySelector(".mythagentic-receipt");
  if (!receipt) {
    receipt = document.createElement("p");
    receipt.className = "mythagentic-receipt";
    receipt.setAttribute("role", "status");
    form.append(receipt);
  }
  receipt.textContent = "Preview: the form is complete, but nothing was sent. On the real site this goes to the business.";
}, true);
