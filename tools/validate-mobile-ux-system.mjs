import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const problems = [];
const main = read("src/web/main.tsx");
const dock = read("src/web/heritage/MobileDock.tsx");
const transition = read("src/web/heritage/viewTransition.ts");
const stats = read("src/web/heritage/RegistryStatsPage.tsx");
const newsroom = read("src/web/heritage/NewsroomPage.tsx");
const dockCss = read("src/web/styles/heritage.mobile-dock.css");
const navCss = read("src/web/styles/heritage.navigation.css");
const newsroomCss = read("src/web/styles/heritage.newsroom.css");
const feiHeader = read("src/web/frontends/fei-classic/Header.tsx");
const feiNavigation = read("src/web/frontends/fei-classic/Navigation.tsx");
const feiNavCss = read("src/web/frontends/fei-classic/Navigation.css");
const retroCss = read("src/web/frontends/retro-astra/transplant/styles/adaptive.css");
const assistantPanel = read("src/frontend-kit/ai/AssistantPanel.tsx");
const assistantCss = read("src/frontend-kit/ai/assistant.css");
const heritageAiCss = read("src/web/styles/heritage.ai.css");
const classicCss = read("src/web/frontends/classic-registry/classic-registry.css");

for (const token of [
  "HeritageMobileDockProvider", "useHeritageMobileDock", "revealHeritageContent",
  'useHeritageMobileDock("horse-profile"',
]) if (!main.includes(token)) problems.push(`Heritage shell/profile missing ${token}`);

// Check the actual provider's expression, independent of spaces and AND order.
// The original docked-hierarchy and non-sidebar restrictions remain mandatory.
// R154: the professional presentation was removed; the two remaining restrictions are mandatory.
const mainAst = ts.createSourceFile("main.tsx", main, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const dockProviders = [];
function findDockProviders(node) {
  if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(mainAst) === "HeritageMobileDockProvider") dockProviders.push(node);
  ts.forEachChild(node, findDockProviders);
}
findDockProviders(mainAst);
function andConditions(expression) {
  if (ts.isParenthesizedExpression(expression)) return andConditions(expression.expression);
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return [...andConditions(expression.left), ...andConditions(expression.right)];
  return [expression.getText(mainAst).replace(/\s+/g, "")];
}
const enabled = dockProviders[0]?.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(mainAst) === "enabled")?.initializer;
const conditions = enabled && ts.isJsxExpression(enabled) && enabled.expression ? andConditions(enabled.expression) : [];
const requiredDockConditions = ['tabHierarchy==="docked"', 'navigationLayout!=="sidebar"'];
if (dockProviders.length !== 1 || conditions.length !== requiredDockConditions.length || !requiredDockConditions.every(condition => conditions.includes(condition))) {
  problems.push("Heritage mobile dock must be enabled only when tabHierarchy is docked AND navigationLayout is not sidebar");
}

for (const token of [
  "heritage-global-app-dock", "dock-primary", 'level?: "secondary" | "tertiary"',
  "scrollIntoView", "revealTarget", "[...contextualLayers].reverse()", 'navigationGroups("heritage", route, locale)', "HERITAGE_PRIMARY_IDS", "h112-dock-section",
]) if (!dock.includes(token)) problems.push(`global mobile dock missing ${token}`);

for (const token of ["max-width: 820px", "requestAnimationFrame", "focus({ preventScroll: true })", "scrollIntoView"])
  if (!transition.includes(token)) problems.push(`shared reveal transition missing ${token}`);

for (const token of ['useHeritageMobileDock("registry-stats"', 'revealHeritageContent(".stats-workspace-context")', 'revealHeritageContent(".premium-intelligence-head")'])
  if (!stats.includes(token)) problems.push(`Statistics mobile hierarchy missing ${token}`);

for (const token of [
  'useHeritageMobileDock("newsroom"', "mobileReaderOpen", "history.pushState",
  "closeMobileReader", 'revealHeritageContent(".heritage-news-reader")', "heritage-news-reader-back",
]) if (!newsroom.includes(token)) problems.push(`Newsroom mobile master-detail missing ${token}`);

for (const token of [
  ".heritage-global-app-dock", "overflow-x:auto!important", "overflow-y:hidden!important", "touch-action:pan-x",
  ".profile-workspace-nav", ".stats-subnav", ".hero-crest-frame", "object-fit:contain!important",
]) if (!dockCss.includes(token)) problems.push(`Heritage mobile dock/splash CSS missing ${token}`);

if (!navCss.includes(".heritage-tab-rail") || !navCss.includes("min-height:40px")) problems.push("shared Heritage tab rail contract missing compact touch target");
if (!newsroomCss.includes(".heritage-newsroom.is-reading") || !newsroomCss.includes(".heritage-newsroom:not(.is-reading) .heritage-news-reader")) problems.push("Newsroom compact reader visibility contract missing");

// R124 owner-directed FEI donor header restoration (the data.fei.org port
// lost at R117, recovered from the R115 tree). All devices keep real
// keyboard-operable links: the donor menu anchors are in the tab order and
// focus opens the submenu; the mobile drawer keeps its own close control.
for (const token of ['fei-donor-header-exact', 'useNavigationLayout', 'role="menubar"', '<LayoutSwitcher locale={view.locale}/>', 'fei-mobile-drawer', 'onFocus={()=>enter(i)}', 'onKeyDown={e=>{if(e.key==="Escape")setOpen(null)}}'])
  if (!feiHeader.includes(token)) problems.push(`FEI shell navigation missing ${token}`);
if (feiHeader.includes('tabIndex={-1}')) problems.push('FEI header removes navigation from the keyboard order');
for (const token of ['navigationGroups(FRONTEND, route, locale)', 'aria-expanded={open}', 'isPlainNavigationClick', 'event.key === "Escape"', 'pointerdown'])
  if (!feiNavigation.includes(token)) problems.push(`FEI canonical navigation missing ${token}`);
for (const token of ['--fc-nav-control: 2.75rem', 'max-block-size:min(70dvh', '.fc102-sidebar[data-open="false"]', ':focus-visible'])
  if (!feiNavCss.includes(token)) problems.push(`FEI responsive navigation missing ${token}`);

for (const token of [
  "overflow-x: clip !important", ".primary-nav-inner", "overflow-x: auto !important", "overflow-y: hidden !important", "touch-action: pan-x",
]) if (!retroCss.includes(token)) problems.push(`RetroAstra mobile overflow contract missing ${token}`);

for (const token of ["autoFollow", "trackThreadScroll", "scrollThreadToBottom", 'ref={thread}', 'onScroll={trackThreadScroll}'])
  if (!assistantPanel.includes(token)) problems.push(`AI mobile smart-scroll contract missing ${token}`);
if (assistantPanel.includes('bottom.current?.scrollIntoView')) problems.push("AI assistant still force-scrolls a DOM sentinel during streaming");
for (const token of ["overflow-y:auto", "touch-action:pan-y", "-webkit-overflow-scrolling:touch", "overscroll-behavior-y:contain"])
  if (!assistantCss.includes(token)) problems.push(`AI thread mobile scrolling CSS missing ${token}`);
for (const token of ["height:max(360px,calc(100dvh - var(--h-mobile-dock-stack-height,72px) - 56px))", "min-height:0", "max-height:none"])
  if (!heritageAiCss.includes(token)) problems.push(`Core AI mobile viewport contract missing ${token}`);
for (const token of ["height:100dvh", "max-height:100dvh", "min-height:0", "overflow:hidden"])
  if (!classicCss.includes(token)) problems.push(`Classic AI mobile viewport contract missing ${token}`);

if (main.includes("createPortal(profileDock") || stats.includes("createPortal(statsDock")) problems.push("page-local dock portal survived global dock migration");

if (problems.length) {
  console.error("Mobile UX system validation FAILED:\n" + problems.map((p) => `  ERROR ${p}`).join("\n"));
  process.exit(1);
}
console.log("Mobile UX system validation passed: shell-owned hierarchical Heritage dock, smart touch-owned AI thread scrolling, shared reveal/focus transitions, mobile Newsroom master-detail, contained splash art, FEI canonical responsive navigation, and RetroAstra axis-safe scrolling are enforced.");
