import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read=path=>readFileSync(path,"utf8");
const main=read("src/web/main.tsx");
const appearanceStore=read("src/web/heritageAppearance.ts");
const studio=read("src/web/heritage/AppearanceStudio.tsx");
const binder=read("src/web/heritage/HeritageSurfaceEffectsBinder.tsx");
const registry=read("src/web/heritageSurfaceRegistry.ts");
const schema=read("src/web/heritage/theme/schema.ts");
const compiler=read("src/web/heritage/theme/compiler.ts");
const autoPalette=read("src/web/heritage/theme/autoPalette.ts");
const visualAssets=read("src/web/heritageVisualAssets.ts");
const devLaunch=read("tools/dev-launch.mjs");
const packageJson=read("package.json");
const material=read("src/web/styles/heritage.material.css");
const lighting=read("src/web/styles/heritage.lighting.css");
const color=read("src/web/styles/heritage.color.css");
const appearanceCss=read("src/web/styles/heritage.appearance-studio.css");
const activeWebFiles=[];
const collect=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())collect(path);else if(/\.(?:ts|tsx|css)$/.test(entry.name))activeWebFiles.push(path)}};
collect("src/web");
const allActive=activeWebFiles.map(read).join("\n");
const cssFiles=activeWebFiles.filter(path=>path.endsWith(".css"));
const allCss=cssFiles.map(read).join("\n");
const failures=[];
const req=(text,needle,label)=>{if(!text.includes(needle))failures.push(label)};
const forbid=(text,needle,label)=>{if(text.includes(needle))failures.push(label)};

const importOrder=[
  'import "./styles/heritage.system.css";',
  'import "./styles/heritage.tokens.css";',
  'import "./styles/heritage.color.css";',
  'import "./styles/heritage.analytics.css";',
  'import "./styles/heritage.final.css";',
  'import "./styles/heritage.motion.css";',
  'import "./styles/heritage.navigation.css";',
  'import "./styles/heritage.refinement.css";',
  'import "./styles/heritage.material.css";',
  'import "./styles/heritage.lighting.css";',
  'import "./styles/heritage.appearance-studio.css";',
  'import "./styles/heritage.chrome.css";',
  'import "./styles/heritage.assets.css";'
];
let cursor=-1;
for(const line of importOrder){const at=main.indexOf(line);if(at<0||at<=cursor)failures.push(`canonical Core CSS import order missing/out of order: ${line}`);cursor=at;}
forbid(main,'import "./styles/heritage.ambient.css";','retired heritage.ambient.css is live');
forbid(main,'import "./styles/heritage.runtime-ambient.css";','retired runtime Ambient CSS is live');

// Appearance runtime: visual-only settings must not live in root App.
req(appearanceStore,'useSyncExternalStore','appearance runtime is not an external React store');
req(appearanceStore,'registry-heritage-appearance-v22','v22 appearance persistence key missing');
req(appearanceStore,'compileHeritageThemeTokens','theme compiler is not used by the appearance runtime');
req(appearanceStore,'appliedTokens[name]!==value','CSS token writes are not diffed');
req(appearanceStore,'window.setTimeout(persist,180)','appearance persistence is not debounced');
req(appearanceStore,'root.dataset.ambientMotion=value.ambientMotion','Ambient state is not mapped to the live root channel');
req(appearanceStore,'root.dataset.hLegacyMotion="still"','historical motion compatibility is not pinned still');
req(appearanceStore,'root.dataset.visualArchitecture="2"','v2 visual architecture marker missing');
req(appearanceStore,'resolveResponsiveSnapshot','phone-first responsive appearance resolution missing');
req(appearanceStore,'phone&&value.tabHierarchy!=="docked"?{...value,tabHierarchy:"docked"}:value','persisted desktop hierarchy can override first-frame phone Docked mode');
req(main,'bootstrapHeritageAppearance();','appearance is not synchronously bootstrapped before createRoot');
if(main.indexOf('bootstrapHeritageAppearance();')>main.indexOf('createRoot('))failures.push('appearance bootstrap happens after React root creation');
req(main,'useHeritageAppearanceValue(value=>value.tabHierarchy)','root App is not selectively subscribed to layout-relevant appearance state');
forbid(main,'setProperty("--h-user-','root main.tsx still performs visual CSS token writes');

// Theme schema/compiler authority.
req(schema,'HERITAGE_THEME_PRESET_VERSION=22','theme preset schema is not v22');
req(schema,'material:Record<HeritageMaterialRole,HeritageMaterialDepthPreset>','structured Material Depth preset missing');
for(const role of ['major','panel','card','control']){
  req(schema,`${role}Transparency:number`,`${role} transparency tuning missing`);
  req(schema,`${role}Brightness:number`,`${role} shade tuning missing`);
  req(schema,`${role}Saturation:number`,`${role} saturation tuning missing`);
  req(schema,`${role}Blur:number`,`${role} recursive blur tuning missing`);
  req(schema,`${role}Brightness:[-100,100]`,`${role} material shade no longer reaches black/white extremes`);
}
for(const [role,value] of [['major','21'],['panel','25'],['card','11'],['control','7']])req(schema,`${role}Blur:${value}`,`${role} user-selected recursive blur default changed`);
req(schema,'if(raw.tuning&&typeof raw.tuning==="object")','legacy flat preset migration missing');
req(schema,'raw.version!==HERITAGE_THEME_PRESET_VERSION','v22 portable preset recognition is not version-gated');
req(schema,'clampHeritageThemeTuning','theme import is not range-clamped');
req(compiler,'compileHeritageThemeTokens','Theme → CSS compiler missing');
req(compiler,'set("--h-user-shine-motion-speed",`${t.shineSeconds}s`)','Shine movement-cycle control is disconnected from the CSS runtime');
// Global signed-tone polarity is centralized in the compiler, including Material shade.
for(const key of ['majorBrightness','panelBrightness','cardBrightness','controlBrightness','schemeBrightness','semanticBackgroundBrightness','semanticBrightness','contextColorBrightness','ambientBrightness','shineBrightness'])req(schema,`"${key}"`,`${key} missing from Light/Dark polarity schema`);
req(compiler,'const resolveSignedTone=(key:HeritageLightReversibleTuningKey,limit:number)=>Math.max(-limit,Math.min(limit,t[key]))*brightnessDirection','signed-tone polarity is not centralized');
req(compiler,'const brightness=resolveSignedTone(`${role}Brightness`,100)','Material shade bypasses Light/Dark polarity');
// Auto palette belongs to Color authority and derives from the actual scene image.
req(schema,'export type HeritagePalette = "auto"','Auto palette is not part of the canonical palette enum');
req(appearanceStore,'if(value.palette==="auto")void refreshAutoPaletteFor(value)','Auto palette runtime activation missing');
req(autoPalette,'deriveHeritageSceneColorSignature','Auto palette scene analysis missing');
req(autoPalette,'deriveHeritageAutoPaletteTokens','Auto palette synthesis missing');
req(autoPalette,'resolveHeritageSceneImageSource','Auto palette scene-source resolution missing');
req(autoPalette,'const lowColor=imageSat<.08','low-color scene detection missing');
req(autoPalette,'const primaryHue=lowColor?205:wrapHue(signature.hue)','low-color scenes do not fall back to stable neutral hue authority');
req(autoPalette,'lowColor?clamp(colorSat*.95,.06,.14)','low-color accents are not restrained toward neutral');
req(color,'html:root[data-frontend="heritage"][data-palette="auto"]','Auto palette fallback is not owned by Color CSS');
for(const semantic of ['--h-sire-','--h-dam-','--h-info-','--h-success-','--h-warning-','--h-danger-'])forbid(autoPalette,semantic,`Auto palette illegally overrides semantic authority ${semantic}`);

// Visual assets are a separate local personalization layer so portable v22 themes stay compact.
req(visualAssets,'registry-heritage-visual-assets-v1','visual asset persistence authority missing');
req(visualAssets,'HERITAGE_BACKGROUND_OPTIONS','background artwork gallery missing');
req(visualAssets,'HERITAGE_BRAND_ART_OPTIONS','header logo artwork gallery missing');
req(visualAssets,'HERITAGE_SPLASH_ART_OPTIONS','splash artwork gallery missing');
req(visualAssets,'optimizeHeritageVisualAsset','custom artwork local optimization missing');
req(appearanceStore,'applyHeritageVisualAssets(value.mode)','appearance mode changes do not refresh adaptive visual assets before Auto palette analysis');
req(main,'bootstrapHeritageVisualAssets();','visual assets are not bootstrapped before appearance/root render');
if(main.indexOf('bootstrapHeritageVisualAssets();')>main.indexOf('bootstrapHeritageAppearance();'))failures.push('visual assets bootstrap happens after appearance bootstrap');

// Compiler outputs must all have an active CSS consumer.
const outputs=new Set([...compiler.matchAll(/set\("(--[^\"]+)"/g)].map(match=>match[1]));
for(const suffix of ['alpha','darken','brighten','tone-scale','chroma-scale','blur'])for(const role of ['major','panel','card','control'])outputs.add(`--h-user-${role}-${suffix}`);
const unused=[...outputs].filter(token=>!allCss.includes(token));
if(unused.length)failures.push(`theme compiler has unused CSS outputs: ${unused.join(', ')}`);

// Semantic role contract and transitional inference.
req(registry,'[data-h-surface-role]','explicit semantic Material role selector missing');
req(registry,'element.getAttribute("data-h-surface-role")','explicit semantic role does not override selector inference');
req(registry,'selector.length>0&&element.matches(selector)','empty fallback Material selectors are not guarded');
for(const role of ['major','panel','card','control'])req(registry,`${role}:[`,`surface registry missing ${role}`);
req(registry,'return role==="major"||role==="panel"','local Lighting is not limited to Major/Panel');
req(binder,'useLayoutEffect','semantic compatibility binder does not bind before paint');
req(binder,'ROLE_WEIGHT:Record<HeritageMaterialRole,number>={major:8,panel:4,card:1.5,control:.2}','weighted effects budget missing');
req(binder,'cost>=48?"high":cost>=24?"medium":"normal"','normal → medium/high budget thresholds missing');
req(binder,'cost<38?"medium":"high"','effects budget hysteresis missing');
req(binder,'.theme-settings-portal-layer,.theme-settings-sidebar,.theme-controls','Appearance Studio chrome is not excluded from performance calibration');
req(binder,'new IntersectionObserver','offscreen compositor suspension missing');
req(binder,'for(const node of record.addedNodes)process(node)','MutationObserver does not process added branches incrementally');
req(main,'<HeritageSurfaceEffectsBinder />','Core effects binder is not mounted');

// Development runtime should be fast by default, with StrictMode available as an explicit QA mode.
req(main,'import.meta.env.VITE_REACT_STRICT_QA==="1"','React StrictMode is not gated behind explicit QA mode');
req(devLaunch,'forwarded.includes("--strict-qa")','dev launcher has no Strict QA switch');
req(devLaunch,'VITE_REACT_STRICT_QA','dev launcher does not forward Strict QA state to Vite');
req(packageJson,'"dev:qa": "node tools/dev-launch.mjs --strict-qa"','package scripts do not expose explicit Strict QA mode');

// Heritage scoping must put the document-root selector first. A syntactically
// valid selector such as `.profile-actions :where(html[...]) .ghost` can never
// match because <html> cannot be a descendant of an application element.
const heritageRoot=':where(html[data-frontend="heritage"])';
for(const path of cssFiles){
  const css=read(path).replace(/\/\*[\s\S]*?\*\//g,"");
  for(const match of css.matchAll(/([^{}]+)\{/g)){
    const selectorList=match[1].trim();
    if(selectorList.startsWith('@')||!selectorList.includes(heritageRoot))continue;
    for(const selectorRaw of selectorList.split(',')){
      const selector=selectorRaw.trim();
      const occurrences=selector.split(heritageRoot).length-1;
      if(occurrences>1)failures.push(`${path} duplicates Heritage document scope: ${selector}`);
      if(occurrences===1&&!selector.startsWith(heritageRoot))failures.push(`${path} places Heritage document scope below another ancestor: ${selector}`);
    }
  }
}

// Material owns material; Lighting owns effects.
req(material,'MATERIAL DEPTH authority','Material authority banner missing');
for(const role of ['major','panel','card','control']){
  req(material,`[data-h-material-role="${role}"]`,`Material does not consume ${role} role`);
  req(material,`--h-v2-${role}-blur:var(--h-user-${role}-blur`,`Material ${role} blur mapping missing`);
}
req(material,'backdrop-filter:blur(var(--h-material-blur))','recursive true-frost formula missing');
req(material,'[data-glass="0"]','solid Material state missing');
forbid(material,'data-ambient-motion','Material illegally branches on Ambient motion');
forbid(material,'--h-user-ambient-','Material illegally consumes Ambient tuning');
forbid(material,'@keyframes','Material module contains motion');
req(lighting,'performance-aware','Lighting performance contract missing');
req(lighting,'[data-frost-load="high"]','high-load Lighting budget missing');
req(lighting,'.heritage-v2-surface-effects::before','single local Ambient pseudo compositor missing');
req(lighting,'mix-blend-mode:normal','local Ambient is not ordinary-alpha composition');
req(lighting,'background-blend-mode:normal,normal,normal,normal','local Ambient still uses expensive blend compositing');
req(lighting,'--h-v2-ambient-dither-layer:repeating-conic-gradient','moving-field dithering contract missing');
req(lighting,'[data-h-v2-effect-visible="0"]','offscreen effect pause CSS missing');
forbid(lighting,'backdrop-filter:','Lighting illegally owns backdrop blur');
forbid(lighting,'background-color:','Lighting illegally owns material fill');
forbid(lighting,'--h-material-opacity:','Lighting illegally owns material opacity');
// R32: the needle includes the declaration-block brace so pure Ambient *gating*
// rules (which always target the ::before pseudo with display:none) stay legal
// while true card/control compositor enablement stays forbidden.
forbid(lighting,'[data-h-material-role="card"]>.heritage-v2-surface-effects{','Card regained an independent local effects compositor');
forbid(lighting,'[data-h-material-role="control"]>.heritage-v2-surface-effects{','Control regained an independent local effects compositor');
req(color,'[data-ambient-pattern="chromatic"]','chromatic Ambient palette authority is not in Color');
forbid(lighting,'--h-v2-chroma-a:','Lighting contains Chromatic palette derivation');

// Retirement checks.
forbid(allActive,'data-tint-motion','retired data-tint-motion contract remains in active Core source');
forbid(allActive,'graphite','retired Graphite palette remains in active Core source');
for(const legacy of ['--h-gas-','--h-v6-','--h-v11-'])forbid(allActive,legacy,`retired legacy token family remains active: ${legacy}`);
const propertyNames=[...allCss.matchAll(/@property\s+(--[\w-]+)/g)].map(match=>match[1]);
if(propertyNames.length>2)failures.push(`orphan-prone @property registry grew to ${propertyNames.length} entries`);
for(const name of propertyNames){const count=allCss.split(name).length-1;if(count<2)failures.push(`orphaned @property ${name}`);}

// Appearance Studio remains a separate, H42-compatible presentation surface.
req(studio,'className="theme-settings-popover theme-settings-sidebar theme-studio-v20"','Appearance Studio H42 chrome marker missing');
req(studio,'className="theme-studio-nav"','Appearance Studio navigator missing');
req(studio,'className="theme-material-depth-stack"','Material Depth visual hierarchy missing');
req(studio,'L("Material shade","سایه متریال")','explicit Material shade labeling missing');
req(studio,'-100,100,1','Material shade UI no longer spans true black/white range');
req(studio,'createPortal(','Appearance Studio is not body-portaled');
req(appearanceCss,'Appearance Studio — H42','H42 Appearance Studio CSS authority banner missing');
forbid(appearanceCss,'backdrop-filter:','Appearance Studio layout illegally owns backdrop blur');

if(failures.length){console.error('CSS architecture validation FAILED:');for(const failure of failures)console.error(`  ERROR ${failure}`);process.exit(1);}
console.log(`CSS architecture validation passed: v22 external appearance runtime, global Dark/Light tone polarity, scene-aware Auto palette, explicit Material roles, recursive frost, Major/Panel-only local effects, weighted hysteretic budgeting, and legacy painter retirement are intact. Theme compiler outputs: ${outputs.size}, unused: 0; active @property registrations: ${propertyNames.length}.`);
