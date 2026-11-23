import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const main=read("src/web/main.tsx");
// R128: the phone registry card system (structure, zebra, narrow mode, view
// toggle) lives in the semantic-encoding authority file; app.css keeps the
// shared row tokens. The gate checks the union so the contract is location-
// transparent while staying just as strict.
const css=read("src/web/styles/app.css")+"\n"+read("src/web/styles/heritage.registry-encoding.css");
const appearance=read("src/web/styles/heritage.appearance-studio.css");
const i18n=read("src/web/i18n.tsx");
const pkg=JSON.parse(read("package.json"));

const requiredMain=[
  'mobileRegistryView,setMobileRegistryView',
  'safeStorageGet("registry-mobile-view-mode")',
  'safeStorageSet("registry-mobile-view-mode",mobileRegistryView)',
  'mobile-view-${mobileRegistryView}',
  'className="mobile-registry-view-toggle"',
  'browse.mobileDetail',
  'browse.mobileCompact',
];
const requiredCss=[
  '--h-registry-row-alt:',
  '.registry-table tbody tr:nth-child(even)>*',
  '.mobile-registry-list>.mobile-registry-card:nth-child(even)',
  '.mobile-registry-view-toggle',
  '.mobile-registry-view-segment button:is(.active,[aria-pressed="true"])',
  '.table-panel.mobile-view-compact .mobile-registry-card',
  'min-height:58px!important',
  // R128: the register-number micro-line joins the narrow-mode hide set (it
  // remains one tap away on the record page; nothing is removed from data).
  '.table-panel.mobile-view-compact :is(.mobile-native,.mobile-match,.mobile-lineage,.mobile-card-id small){display:none!important}',
];
const requiredAppearance=[
  '.theme-studio-nav{',
  'display:flex!important',
  'overflow-x:auto!important',
  'min-height:30px!important',
  'font:850 11.5px/1.1 var(--h-font-ui)!important',
];
const requiredI18n=[
  '"browse.mobileView":"Phone view"',
  '"browse.mobileDetail":"Detailed"',
  '"browse.mobileCompact":"Narrow"',
  '"browse.mobileView":"نمای موبایل"',
  '"browse.mobileDetail":"کامل"',
  '"browse.mobileCompact":"باریک"',
];
const missing=[
  ...requiredMain.filter(t=>!main.includes(t)).map(t=>`main:${t}`),
  ...requiredCss.filter(t=>!css.includes(t)).map(t=>`css:${t}`),
  ...requiredAppearance.filter(t=>!appearance.includes(t)).map(t=>`appearance:${t}`),
  ...requiredI18n.filter(t=>!i18n.includes(t)).map(t=>`i18n:${t}`),
];
if(pkg.scripts?.["validate:registry-mobile"]!=="node tools/validate-registry-mobile-view.mjs")missing.push("package:validate:registry-mobile");
if(!pkg.scripts?.check?.includes("npm run validate:registry-mobile"))missing.push("package:check missing registry-mobile gate");
if(missing.length){
  console.error("Registry mobile-view contract validation failed:\n"+missing.map(x=>` - ${x}`).join("\n"));
  process.exit(1);
}
console.log("Registry mobile-view contract passed: persistent detailed/narrow phone modes, zebra rhythm, and compact Appearance Studio rail are enforced.");
