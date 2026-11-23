// R162 Farsi QA sweep helper — injected via agent-browser eval "$(cat this file)"
// Reports viewport overflow, direction, lang, and up to 8 offending elements.
// Ignores intentional off-canvas drawers and elements inside horizontal scroll containers.
(function(){
  const vw = window.innerWidth;
  const doc = document.documentElement;
  const SKIP = 'aside.sb,[data-offcanvas],[data-sweep-skip]';
  const bad = [];
  const seen = new Set();
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    if (el.closest(SKIP)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    // skip elements living inside a horizontal scroll container (by design)
    let p = el.parentElement, inScroller = false;
    while (p && p !== document.body) {
      if (p.matches && p.matches(SKIP)) { inScroller = true; break; }
      const pcs = getComputedStyle(p);
      if ((pcs.overflowX === 'auto' || pcs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) { inScroller = true; break; }
      p = p.parentElement;
    }
    if (inScroller) continue;
    if (r.right > vw + 1 || r.left < -1) {
      const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 60);
      const key = el.tagName + (el.id ? '#' + el.id : '') + '[' + cls + ']';
      if (!seen.has(key)) { seen.add(key); bad.push(key + ' L' + Math.round(r.left) + ' R' + Math.round(r.right)); }
      if (bad.length >= 8) break;
    }
  }
  return JSON.stringify({ vw, scrollW: doc.scrollWidth, hOverflow: doc.scrollWidth > vw + 1, dir: doc.getAttribute('dir'), lang: doc.getAttribute('lang'), bad });
})()
