// Sweep helper injected via agent-browser eval on each route
(function(){
  const vw = window.innerWidth;
  const doc = document.documentElement;
  const bad = [];
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    if (el.closest('aside.sb') || el.closest('[data-offcanvas]')) continue; // intentional off-canvas drawer
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.closest('aside.sb')) continue; // drawer subtree even if mid-transition
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > vw + 1 || r.left < -1) {
      const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 70);
      bad.push(el.tagName + '[' + cls + '] L' + Math.round(r.left) + ' R' + Math.round(r.right));
      if (bad.length >= 6) break;
    }
  }
  return JSON.stringify({ vw, scrollW: doc.scrollWidth, hOverflow: doc.scrollWidth > vw + 1, bad });
})()
