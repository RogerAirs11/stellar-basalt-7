import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const read=path=>readFileSync(path,"utf8");
const main=read("src/web/main.tsx");
const studio=read("src/web/heritage/AppearanceStudio.tsx");
const appearance=read("src/web/heritageAppearance.ts");
const schema=read("src/web/heritage/theme/schema.ts");
const compiler=read("src/web/heritage/theme/compiler.ts");
const autoPalette=read("src/web/heritage/theme/autoPalette.ts");
const visualAssets=read("src/web/heritageVisualAssets.ts");
const registry=read("src/web/heritageSurfaceRegistry.ts");
const binder=read("src/web/heritage/HeritageSurfaceEffectsBinder.tsx");
const system=read("src/web/styles/heritage.system.css");
const color=read("src/web/styles/heritage.color.css");
const material=read("src/web/styles/heritage.material.css");
const lighting=read("src/web/styles/heritage.lighting.css");
const studioCss=read("src/web/styles/heritage.appearance-studio.css");
const chrome=read("src/web/styles/heritage.chrome.css");
const assetsCss=read("src/web/styles/heritage.assets.css");
const app=read("src/web/styles/app.css");
const header=read("src/web/heritage/Header.tsx");
const nav=read("src/web/heritage/Navigation.tsx");
const failures=[];
const req=(text,needle,label)=>{if(!text.includes(needle))failures.push(label)};
const forbid=(text,needle,label)=>{if(text.includes(needle))failures.push(label)};

// Runtime architecture / performance regressions.
req(main,'const csrfRef=useRef<string|null>(null)','stable CSRF indirection missing');
req(main,'csrfToken:()=>csrfRef.current','PlatformClient does not read current CSRF token through a stable ref');
// R132 switched the transport to the caching layer; accept both constructions.
const platformConstruction = /createPlatformClient\(\{transport:(?:createFetchPlatformTransport\(\)|cachingTransport\.transport)/.test(main);
if(!platformConstruction) failures.push('PlatformClient construction missing');
const stableIdentity = /\}\)+,\[(?:cachingTransport)?\]\);/.test(main);
if(!stableIdentity) failures.push('PlatformClient identity is no longer stable');
req(main,'useHeritageAppearanceValue(value=>value.tabHierarchy)','root App still lacks selective appearance subscription');
req(appearance,'useSyncExternalStore','appearance state returned to root component state');
req(appearance,'applyTokens(root,compileHeritageThemeTokens','compiled token runtime mapping missing');
req(appearance,'window.setTimeout(persist,180)','persistence is no longer debounced');
req(appearance,'for(const key of LEGACY_THEME_KEYS)storage.removeItem(key)','one-time legacy theme-key cleanup missing');

// Appearance capabilities and bounded controls.
for(const palette of ['"auto"','"neutral"','"heritage"','"midnight"','"oxblood"'])req(schema,palette,`palette ${palette} missing`);
for(const state of ['"animated"','"still"','"off"'])req(schema,state,`Ambient state ${state} missing`);
for(const pattern of ['"organic"','"chromatic"'])req(schema,pattern,`Ambient pattern ${pattern} missing`);
for(const scope of ['"surfaces"','"major"','"global"'])req(schema,scope,`Ambient scope ${scope} missing`);
for(const mode of ['"contextual"','"stacked"','"docked"'])req(schema,mode,`tab hierarchy ${mode} missing`);
for(const role of ['major','panel','card','control']){
  for(const field of ['Transparency','Brightness','Saturation','Blur'])req(studio,`slider("${role}${field}"`,`${role} ${field.toLowerCase()} control missing`);
}
for(const key of ['ambientVisibility','ambientBrightness','ambientSaturation','shineEnergy','shineBrightness','shineSaturation','shineSeconds','schemeEnergy','schemeBrightness','schemeSaturation','schemeContrast','semanticBackgroundVisibility','semanticBackgroundBrightness','semanticBackgroundSaturation','semanticTextVisibility','semanticBrightness','semanticSaturation','contextColorEnergy','contextBackgroundVisibility','contextColorBrightness','contextColorSaturation','controlProminence','haloSoftness'])req(studio,`slider("${key}"`,`${key} tuning control missing`);
req(studio,'checkbox("shineMotion"','moving Shine toggle missing');
req(studio,'setAmbientDither','Ambient dither option missing');
req(studio,'exportHeritageThemePreset()','theme JSON export does not use v22 schema authority');
req(studio,'importHeritageThemePreset(parsed)','theme JSON import does not use schema migration/clamping authority');
req(studio,'navigator.clipboard.writeText','theme JSON clipboard action missing');
req(studio,'anchor.download=','theme JSON download action missing');
req(schema,'HERITAGE_THEME_PRESET_VERSION=22','current portable theme schema is not v22');
// Built-in default is the exact user-supplied Auto/Dark preset (adaptive night
// background + Achaemenid horse-and-sun medallion splash). The old R23 default remains
// separately addressable as a deterministic Legacy preset.
for(const [key,value] of Object.entries({majorTransparency:62,panelTransparency:57,cardTransparency:53,controlTransparency:41,majorBrightness:-100,panelBrightness:-100,cardBrightness:-76,controlBrightness:-100,majorSaturation:134,panelSaturation:100,cardSaturation:120,controlSaturation:130,majorBlur:24,panelBlur:22,cardBlur:6,controlBlur:2,tintEnergy:4,semanticBackgroundVisibility:76,semanticBackgroundBrightness:-19,semanticBackgroundSaturation:200,semanticTextVisibility:100,semanticBrightness:9,semanticSaturation:200,contextColorEnergy:15,contextBackgroundVisibility:43,contextColorBrightness:30,contextColorSaturation:100,schemeEnergy:22,schemeBrightness:-2,schemeContrast:-4,schemeSaturation:200,reverseLightBrightness:1,shineEnergy:5,shineBrightness:50,shineSaturation:100,shineMotion:1,shineSeconds:10,haloSoftness:12,ambientVisibility:74,ambientBrightness:-50,ambientSaturation:220,motionSeconds:14,controlProminence:100,selectedStateStrength:78,selectedStateSaturation:155,selectedStateGlow:68,selectedStateMotion:58}))req(schema,`${key}:${value}`,`R24 default tuning drifted: ${key}`);
req(appearance,'palette:"auto",mode:"dark",scene:"full"','default foundation is not Auto/Dark/Full');
req(appearance,'tabHierarchy:"contextual"','default desktop tab hierarchy is no longer Contextual');
req(appearance,'LEGACY_R23_HERITAGE_APPEARANCE_PRESET','Legacy R23 appearance preset missing');
req(schema,'LEGACY_R23_HERITAGE_THEME_TUNING','Legacy R23 tuning authority missing');
// LEGACY_R23_VISUAL_ASSETS also uses an adaptive background, so scope the built-in
// default artwork assertions to the DEFAULT_VISUAL_ASSETS declaration block.
const defaultVisualAssets=visualAssets.slice(visualAssets.indexOf("export const DEFAULT_VISUAL_ASSETS"));
// R150 owner directive: the default is the quiet faint-pattern 'none' artwork;
// 'adaptive' stays selectable but is no longer the shipped default.
req(defaultVisualAssets,'backgroundArt:"none"','default quiet wallpaper (owner R150 directive) missing');
req(visualAssets,'backgroundArt:"adaptive"','adaptive day/night wallpaper option missing');
req(defaultVisualAssets,'backgroundBottomFade:true','default bottom background fade missing');
req(defaultVisualAssets,'backgroundFitWidth:true','default full-width wallpaper fit missing');
// R148: an uploaded source archive may omit optional artwork. Keep the exact
// owner-approved IDs as the preferred defaults, but require an explicit, shipped
// neutral fallback instead of issuing broken URLs or relabeling another image.
for(const [field,preferred] of Object.entries({brandArt:"library-logo-antique_gold_crescent_horse_emblem",splashArt:"library-logo-achaemenid_horse_sun_medallion"})){
  req(defaultVisualAssets,`${field}:EXTRA_LOGO_OPTIONS.some(option=>option.id==="${preferred}")?"${preferred}":"registry-neutral"`,`${field} must retain its approved original and select the neutral fallback only when absent`);
}
req(visualAssets,'id:"registry-neutral",label:"Registry Monogram"','neutral fallback must be an explicitly named selectable option');
req(read("src/web/assetCatalog.ts"),'brand: "/assets/fallbacks/registry-mark.svg"','neutral brand fallback must resolve to the shipped SVG');
if(!existsSync("public/assets/fallbacks/registry-mark.svg")||!read("public/assets/fallbacks/registry-mark.svg").includes("<svg"))failures.push("neutral brand fallback SVG is missing or invalid");
req(visualAssets,'LEGACY_R23_VISUAL_ASSETS','Legacy R23 visual-assets preset missing');
req(studio,'applyBuiltInPreset("legacy-r23")','Legacy R23 one-click preset action missing');
req(studio,'applyBuiltInPreset("default")','R24 one-click default preset action missing');
req(main,'route.startsWith("/f/heritage/wallpaper")','desktop Wallpaper route missing');
req(read("src/frontend-kit/navigation.ts"),'heritage: "/f/heritage/wallpaper"','desktop Wallpaper canonical destination missing');
req(read("src/web/heritage/Navigation.tsx"),'link.id === "wallpaper" ? "wallpaper-nav-tab"','desktop Wallpaper section visibility binding missing');
req(chrome,'[data-page="wallpaper"]','Wallpaper presentation-mode chrome authority missing');
req(chrome,'.wallpaper-nav-tab{display:none!important}','Wallpaper tab is not desktop-only');
req(material,'--h-pedigree-stage-grid-image','shared pedigree stage background token missing');
req(material,'--h-pedigree-role-surface','shared pedigree role surface token missing');
req(material,'.pedigree-map-shell .radial-slice path','Radial is not bound to shared pedigree material authority');
forbid(system,'.radial-slice.generation-1 path{filter:','Radial still has independent generation washout filters');
forbid(system,'.radial-slice.relation-father path{fill:','Radial still has independent sire fill in legacy system CSS');
forbid(assetsCss,'.hero-art>.hero-art-halo{display:block','landing splash halo was re-enabled');
req(assetsCss,'.hero-art>.hero-art-halo{display:none!important}','landing splash alpha is not protected from the synthetic halo');
req(compiler,'set("--h-user-shine-motion-speed",`${t.shineSeconds}s`)','Shine movement-cycle control is disconnected from the CSS runtime');
// Global Dark/Light polarity: all signed tone channels must mirror together.
for(const key of ['majorBrightness','panelBrightness','cardBrightness','controlBrightness','schemeBrightness','semanticBackgroundBrightness','semanticBrightness','contextColorBrightness','ambientBrightness','shineBrightness'])req(schema,`"${key}"`,`${key} is missing from global Light/Dark polarity authority`);
req(compiler,'const brightnessDirection=mode==="light"&&t.reverseLightBrightness>=.5?-1:1','Light/Dark polarity direction missing');
req(compiler,'const brightness=resolveSignedTone(`${role}Brightness`,100)','Material shade is not governed by Light/Dark polarity');
req(studio,'checkbox("reverseLightBrightness",L("Mirror Dark ↔ Light tone controls"','global Light/Dark polarity control missing from Foundation');
req(studio,'HERITAGE_LIGHT_REVERSIBLE_TUNING_KEYS.includes','Appearance Studio does not identify reversible signed tone controls');
// Scene-aware Auto palette.
req(studio,'data-palette-option={value}','palette controls no longer expose semantic palette identity');
req(studio,'palette==="auto"','Auto palette guidance/recalculate surface missing');
req(studio,'refreshHeritageAutoPalette','Auto palette manual recalculation missing');
req(appearance,'value.palette==="auto"','appearance runtime does not activate scene-aware Auto palette');
req(autoPalette,'deriveHeritageSceneColorSignature','scene color analysis missing');
req(autoPalette,'deriveHeritageAutoPaletteTokens','professional scene-derived palette synthesis missing');
req(autoPalette,'resolveHeritageSceneImageSource','Auto palette is not tied to the active background scene');
req(autoPalette,'canvas.getContext("2d"','Auto palette does not sample the selected background image');
req(autoPalette,'splitA=wrapHue(primaryHue+150),splitB=wrapHue(primaryHue-150)','split-complementary Ambient harmony missing');
req(color,'[data-palette="auto"]','flash-safe Auto palette CSS fallback missing');
req(studioCss,'.theme-auto-palette-card','Auto palette quality-of-life UI missing');

// Appearance Studio accordion: compact by default, one expanded section at a time.
req(studio,'useState<string|null>(null)','Appearance Studio no longer starts with all sections collapsed');
req(studio,'const toggleStudioSection=(id:string)=>setActiveStudioSection(current=>current===id?null:id)','Appearance Studio accordion no longer has single-section state ownership');
for(const id of ['appearance-foundation','appearance-artwork','appearance-material','appearance-lighting','appearance-color','appearance-navigation','appearance-presets']){
  req(studio,`data-expanded={activeStudioSection===\"${id}\"?\"true\":\"false\"}`,`${id} accordion expansion state missing`);
  req(studio,`aria-expanded={activeStudioSection===\"${id}\"}`,`${id} accordion accessibility state missing`);
}
forbid(studio,'IntersectionObserver','Appearance Studio returned to scroll-position section tracking instead of explicit accordion state');
req(studioCss,'.theme-studio-section[data-expanded="false"]>:not(.theme-studio-section-head)','collapsed Appearance Studio sections do not hide their body content');
req(studioCss,'.theme-studio-section[data-expanded="true"] .theme-section-chevron','expanded-section affordance missing');

// User-selectable backgrounds, header logo and splash art.
req(studio,'HERITAGE_BACKGROUND_OPTIONS.map','background artwork gallery missing from Appearance Studio');
req(studio,'HERITAGE_BRAND_ART_OPTIONS.map','header-logo artwork gallery missing from Appearance Studio');
req(studio,'HERITAGE_SPLASH_ART_OPTIONS.map','splash artwork gallery missing from Appearance Studio');
req(studio,'optimizeHeritageVisualAsset','custom artwork upload/optimization path missing');
req(visualAssets,'backgroundFocusX','background horizontal focus personalization missing');
req(visualAssets,'backgroundFocusY','background vertical focus personalization missing');
req(visualAssets,'brandScale','header logo scale personalization missing');
req(visualAssets,'splashScale','splash scale personalization missing');
req(visualAssets,'customBackground','custom background persistence missing');
req(visualAssets,'customBrand','custom header-logo persistence missing');
req(visualAssets,'customSplash','custom splash persistence missing');
req(assetsCss,'--h-scene-focus-x','background focus CSS authority missing');
req(assetsCss,'--h-brand-art-scale','header-logo scale CSS authority missing');
req(assetsCss,'--h-splash-art-scale','splash scale CSS authority missing');
// R122: the header (and its selected brand artwork) moved from the main
// shell into the HeritageHeader component; reachability is unchanged.
if (!main.includes('resolveHeritageBrandSource(visualAssets)') && !header.includes('resolveHeritageBrandSource(visualAssets)')) problems.push('header does not use selected logo artwork');
req(main,'resolveHeritageSplashSource(visualAssets)','Core surfaces do not use selected splash artwork');

// Phone + navigation behavior (R122 contract): resizing never overwrites an
// explicit saved navigation choice; phones get the Docked treatment on first
// paint (appearance defaults, still asserted below), the mobile dock stays
// available, and narrow viewports get the collapsible mobile navigation.
req(main,'HeritageMobileDockProvider','mobile dock provider missing from the shell');
req(nav,'h102-mobile-toggle','narrow-viewport mobile navigation toggle missing');
req(appearance,'tabHierarchy:phone?"docked"','phone first paint no longer defaults to Docked navigation');
req(system,'.heritage-app-dock','Core dock styling missing');
req(main,'import "./styles/heritage.chrome.css";','persistent Chrome stacking authority is not loaded');
req(chrome,'.app-shell>.topbar','topbar no longer has explicit persistent Chrome ownership');
req(chrome,'z-index:var(--h-z-chrome-topbar)!important','topbar can fall behind page stacking contexts');
req(chrome,'body>.heritage-app-dock','Dock portal no longer has body-level Chrome stacking authority');
req(chrome,'z-index:var(--h-z-chrome-dock)!important','Dock portal can fall behind viewport overlays');
req(chrome,'body>.theme-settings-portal-layer','Appearance Studio no longer yields the persistent topbar band');
req(chrome,'top:var(--h-chrome-topbar-height)!important','Appearance Studio can cover the persistent topbar');
req(chrome,'bottom:calc(166px + env(safe-area-inset-bottom))!important','Docked Appearance Studio can cover bottom navigation Chrome');

// Pedigree visual rules from the H42/v0.42.15 baseline.
req(system,'.pedigree-map-shell.desktop-map :is(.pedigree-desktop-lineage,.pedigree-radial-view){display:none!important}','desktop Map exclusivity missing');
req(system,'.pedigree-map-shell.desktop-lineage :is(.pedigree-map-visual,.pedigree-radial-view){display:none!important}','desktop Lineage exclusivity missing');
req(system,'.pedigree-map-shell.desktop-radial :is(.pedigree-map-visual,.pedigree-desktop-lineage){display:none!important}','desktop Radial exclusivity missing');
req(system,'.pedigree-map-shell.mobile-vertical :is(.pedigree-mobile-compact,.pedigree-mobile-readable,.pedigree-map-visual,.pedigree-radial-view){display:none!important}','mobile vertical lineage still leaks Map/Radial content');
req(system,'.pedigree-radial-host.is-fit','Radial fitted state missing');
req(system,'overflow:hidden!important;\n  overscroll-behavior:none!important','Radial 100%/fit state can scroll');
req(system,'.pedigree-radial-host.is-zoomed-in','Radial zoomed-in scroll state missing');
req(system,'.pedigree-map-visual :is(.ped-edge,.ped-edge-spark){display:none!important','legacy solid/spark pedigree lines returned');
req(system,'.pedigree-map-visual .ped-edge-flow','moving dashed pedigree line authority missing');
req(main,'path-dim','family-map hover dimming state missing');
req(color,'--h-sire-raw:','sire blue semantic authority missing');
req(color,'--h-dam-raw:','dam pink semantic authority missing');
req(material,'.ped-card.relation-father','sire material semantic treatment missing');
req(material,'.ped-card.relation-mother','dam material semantic treatment missing');

// Consolidated surface semantics / performance.
req(main,'data-h-surface-role="major"','explicit Major surface markup missing');
req(main,'data-h-surface-role="panel"','explicit Panel surface markup missing');
req(registry,'element.getAttribute("data-h-surface-role")','explicit role override missing');
req(registry,'return role==="major"||role==="panel"','Cards/Controls regained independent local Lighting');
req(binder,'ROLE_WEIGHT','weighted effect budget missing');
req(binder,'load==="high"?','budget hysteresis missing');
req(lighting,'mix-blend-mode:normal','local Ambient returned to Screen blending');
req(lighting,'[data-frost-load="high"] [data-h-material-role="panel"]>.heritage-v2-surface-effects::after{display:none!important}','high-load panel Shine suspension missing');
req(material,'backdrop-filter:blur(var(--h-material-blur))','real recursive frost missing');
for(const role of ['major','panel','card','control'])req(schema,`${role}Blur:`,`${role} recursive blur default missing`);

// Cross-frontend isolation: known generic Core hooks must be gated.
for(const generic of ['primary','ghost','danger','panel']){
  const naked=new RegExp(`(^|[,}])\\s*\\.${generic}(?=[\\s,:.#>{+~\\[]|\\{)`,`m`);
  if(naked.test(app))failures.push(`generic .${generic} selector in app.css is not Heritage-scoped`);
}
req(app,':where(html[data-frontend="heritage"]) .primary','Heritage low-specificity button scope missing');

// Retired architecture must stay retired.
const allActive=[main,studio,appearance,schema,compiler,registry,binder,system,color,material,lighting,studioCss,chrome,app].join('\n');
forbid(allActive,'data-tint-motion','legacy data-tint-motion returned');
forbid(allActive,'graphite','Graphite palette residue returned');
// R32: gating selectors (display:none on the pseudo) are legal; only a real
// compositor declaration block on cards/controls is a regression.
forbid(lighting,'[data-h-material-role="card"]>.heritage-v2-surface-effects{','per-card Ambient compositor returned');
forbid(lighting,'[data-h-material-role="control"]>.heritage-v2-surface-effects{','per-control Ambient compositor returned');

if(failures.length){console.error('Core UI semantic regression validation FAILED:');for(const failure of failures)console.error(`  ERROR ${failure}`);process.exit(1);}
console.log('Core UI semantic regression validation passed: H42 presentation rules, v22 appearance controls, global Dark/Light tone polarity, scene-aware Auto palette, stable runtime identity, phone Docked navigation, pedigree exclusivity, Radial fit behavior, semantic sex colors, and cross-frontend isolation are intact.');
