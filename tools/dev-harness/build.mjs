#!/usr/bin/env node
/* Builds harness HTML pages from the captured production header fragments,
 * patched to the R63 markup (svg home icon, CSS chevrons) plus a content
 * stand-in so header/content edge alignment is reviewable.
 * Run after each capture: node tools/dev-harness/build.mjs
 *
 * R117-20: the retired header layers (fei-classic-header-reference.css,
 * fei-classic-header-pro.css, fei-classic-header-polish.css,
 * fei-donor-header-exact.css) were never imported by entry.tsx and have been
 * deleted from the production tree; the harness now links only the layers the
 * live app loads. The captured fragments below are historical (R63 header);
 * regenerate them before using this harness for new alignment work.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const HOME_SVG =
  '<span class="fei-home-pill" aria-hidden="true"><svg class="fc-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 5l8 6.5"></path><path d="M6.5 10.5V19h11v-8.5"></path></svg></span>';
const DROPDOWNS = {
  en: '<div class="fei-dropdown"><button class="active">Registry Analytics</button><button>Registry Timeline</button><button>Data Quality</button></div>',
  fa: '<div class="fei-dropdown"><button class="active">تحلیل سامانه ثبت</button><button>خط زمانی سامانه ثبت</button><button>کیفیت داده</button></div>',
};

function patch(html) {
  return html
    .replace(/<span class="fei-home-pill" aria-hidden="true">⌂<\/span>/g, HOME_SVG)
    .replace(/<span class="fei-chevron" aria-hidden="true">⌄<\/span>/g, '<span class="fei-chevron" aria-hidden="true"></span>')
    .replace(/<button class="fei-drawer-toggle">⌄<\/button>/g,
      '<button class="fei-drawer-toggle" aria-label="Toggle submenu"><span class="fei-chevron" aria-hidden="true"></span></button>');
}

function page(fragment, { htmlDir, lang, locale }) {
  const body = patch(readFileSync(path.join(dir, fragment), "utf8"));
  // Inject an open dropdown on the first nav li to review the open state.
  const withDropdown = body.replace(
    /(<nav class="fei-nav-desktop">[\s\S]*?<li[^>]*>)([\s\S]*?)(<\/li>)/,
    (m, liOpen, mid, liClose) => `${liOpen}${mid}${DROPDOWNS[locale]}${liClose}`
  );
  return `<!doctype html>
<html lang="${lang}" dir="${htmlDir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FEI header harness — ${locale}</title>
<style>
  html,body{margin:0;padding:0;background:#f4f2f4}
  button,input,textarea,select{font:inherit}
  button{color:inherit}
  .harness-note{max-width:1680px;margin:26px auto 0;padding:0 clamp(24px,4.25vw,72px);color:#8a7d8c;font:12px/1.6 'Source Sans 3',Arial,sans-serif}
</style>
<link rel="stylesheet" href="/css/fei/fei-classic.css">
<link rel="stylesheet" href="/css/fei/fei-donor-exact.css">
</head>
<body>
<div class="fei-classic-ui" dir="${htmlDir}" lang="${lang}" data-locale="${locale}">
${withDropdown}
<div class="fei-content-shell"><main class="fc-main" style="min-height:220px">
  <div class="fc-page-title fei-page-title"><div><h1>${locale === "fa" ? "تحلیل سامانه ثبت" : "Registry Analytics"}</h1><p>${locale === "fa" ? "محتوای مرجع برای بررسی تراز لبه‌ها" : "Content stand-in for edge alignment reference."}</p></div></div>
</main></div>
</div>
<div class="harness-note">Harness replica · ${locale.toUpperCase()} · live CSS from src/web/frontends/fei-classic/</div>
</body>
</html>`;
}

writeFileSync(path.join(dir, "index.html"), page("header-en.frag.html", { htmlDir: "ltr", lang: "en", locale: "en" }));
writeFileSync(path.join(dir, "fa.html"), page("header-fa.frag.html", { htmlDir: "rtl", lang: "fa", locale: "fa" }));
console.log("harness built: index.html (EN) + fa.html (FA)");
