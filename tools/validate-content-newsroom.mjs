import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const problems = [];
const contract = read("src/contracts/platform.ts");
const routes = read("src/api/routes.ts");
// R106: the demo-admin enablement policy moved from an inline routes.ts check
// into src/auth/publicAuthPolicy.ts (isDemoAdminLoginAvailable) with stricter
// reviewed semantics (recognized local environment AND opt-in). The validator
// follows the reviewed behavior: the flag is pinned in the policy module.
const authPolicy = read("src/auth/publicAuthPolicy.ts");
const api = read("src/content/api.ts");
const gemini = read("src/content/gemini.ts");
const deepseek = read("src/content/deepseek.ts");
const aiShared = read("src/content/aiShared.ts");
const generator = read("src/content/generate.ts");
const migration = read("migrations/0014_content_posts.sql");
const seedMigration = read("migrations/0015_newsroom_seed_images.sql");
const capabilities = read("src/auth/capabilities.ts");
const client = read("src/frontend-kit/platformClient.ts");
const newsroom = read("src/web/frontends/retro-astra/transplant/pages/Newsroom.tsx");
const shell = read("src/web/frontends/retro-astra/transplant/components/Shell.tsx");
const app = read("src/web/frontends/retro-astra/transplant/App.tsx");
const navigation = read("src/frontend-kit/navigation.ts");
const retroNavigation = read("src/web/frontends/retro-astra/transplant/components/GroupedNavigation.tsx");
const heritageNavigation = read("src/web/heritage/Navigation.tsx");

for (const token of [
  'ContentPostKind = "article" | "news" | "update"',
  'GeminiContentModel = "gemini-2.5-flash" | "gemini-3.8-flash" | "gemini-3.5-flash-lite"',
  'AiContentModel = GeminiContentModel | "deepseek-flash"',
  '"content.manage"',
  'content: {',
]) if (!contract.includes(token)) problems.push(`platform contract missing ${token}`);

for (const token of [
  '/api/content/posts',
  '/api/admin/content/posts',
  '/api/admin/content/generate',
]) if (!routes.includes(token) || !client.includes(token)) problems.push(`server/client route parity missing ${token}`);

for (const token of [
  'CREATE TABLE IF NOT EXISTS content_posts',
  "kind IN ('article','news','update')",
  "status IN ('draft','published','archived')",
  'title_en TEXT NOT NULL', 'title_fa TEXT NOT NULL',
  'body_en TEXT NOT NULL', 'body_fa TEXT NOT NULL',
  'sources_json TEXT NOT NULL', 'row_version INTEGER NOT NULL DEFAULT 1',
]) if (!migration.includes(token)) problems.push(`content migration missing ${token}`);


for (const token of [
  'ALTER TABLE content_posts ADD COLUMN cover_image_url TEXT',
  'ALTER TABLE content_posts ADD COLUMN cover_image_credit TEXT',
  'seed-arabian-introduction', 'seed-khuzestan-asil', 'seed-iran-waho-2025', 'seed-read-pedigree', 'seed-horsedb-newsroom',
  'Wikimedia Commons', 'WAHO',
]) if (!seedMigration.includes(token)) problems.push(`starter newsroom migration missing ${token}`);
if ((seedMigration.match(/INSERT OR IGNORE INTO content_posts/g) || []).length !== 5) problems.push('starter newsroom must seed exactly five idempotent posts');

for (const role of ['admin:', 'super_admin:']) {
  const start = capabilities.indexOf(role);
  const end = start >= 0 ? capabilities.indexOf('],', start) : -1;
  if (start < 0 || end < 0 || !capabilities.slice(start, end).includes('"content.manage"')) problems.push(`${role.replace(':','')} lacks content.manage`);
}

for (const token of [
  'gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite',
  'x-goog-api-key', 'response_format', 'application/json',
  'googleSearch', 'google_search', 'groundingChunks',
  'GeneratedContentSchema.safeParse',
]) if (!gemini.includes(token)) problems.push(`Gemini integration missing ${token}`);
for (const token of ['deepseek-flash','thinkingLevel: "off"','responseFormat: "json_object"','runPaidEditorialTurn','GeneratedContentSchema.safeParse']) if (!deepseek.includes(token)) problems.push(`DeepSeek content integration missing ${token}`);
for (const token of ['AI_CONTENT_MODELS','deepseek-flash','GeneratedContentSchema','buildEditorialPrompt']) if (!aiShared.includes(token)) problems.push(`provider-neutral content layer missing ${token}`);
if (!generator.includes('generateDeepSeekBilingualContent') || !generator.includes('generateGeminiBilingualContent')) problems.push('provider-neutral content router is incomplete');
if (/AIza[0-9A-Za-z_-]{20,}/.test([gemini,deepseek,aiShared,generator].join('\n'))) problems.push('AI provider key is embedded in content source');
if (!gemini.includes('AI_GEMINI_WEB_GROUNDING_ENABLED')) problems.push('Gemini web grounding is not deployment-gated');
if (!gemini.includes('generationConfig.responseFormat') && /responseFormat\s*:/.test(gemini)) problems.push('Gemini classic endpoint must not use the SDK-style camelCase responseFormat field');

for (const token of [
  'requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "content.manage")',
  'requireCsrf(request, auth)', 'expected_row_version', 'status: "draft"',
]) if (!api.includes(token)) problems.push(`governed content API missing ${token}`);

if (/input\.publish|content\.ai_publish/.test(api)) problems.push("AI generation must remain draft-only; immediate publish path is still present");
if (/Generate & publish|Publish immediately/.test([newsroom, read("src/web/heritage/NewsroomPage.tsx"), read("src/web/heritage/EditorialStudioPage.tsx"), read("src/web/frontends/fei-classic/content.tsx")].join("\n"))) problems.push("Newsroom UI still exposes immediate AI publication");

for (const token of [
  '/api/auth/demo-admin', 'demoAdminLoginAvailable',
]) if (!routes.includes(token)) problems.push(`demo-admin server integration missing ${token}`);
if (!authPolicy.includes('ENABLE_DEMO_ADMIN_LOGIN')) problems.push('demo-admin server integration missing ENABLE_DEMO_ADMIN_LOGIN (policy module)');
if (!authPolicy.includes('isDemoAdminLoginAvailable') || !authPolicy.includes('isProductionAuth')) problems.push('demo-admin policy must use the reviewed isProductionAuth/isDemoAdminLoginAvailable predicates');
for (const token of ['async demoAdmin(request)', '/api/auth/demo-admin']) if (!client.includes(token)) problems.push(`demo-admin client integration missing ${token}`);

for (const token of [
  "Gemini 3.8 Flash", "Gemini 3.5 Flash-Lite", "DeepSeek V4.1 Flash", "Google Grounding",
  "Generate draft", "Article / Blog",
  "runtime.platform.admin.content.generate", "runtime.platform.admin.content.create",
  "Demo Admin Login", "runtime.platform.auth.demoAdmin", "cover_image_url", "newsroom-reader-cover",
]) if (!newsroom.includes(token)) problems.push(`Newsroom UI missing ${token}`);
if (!navigation.includes('"retro-astra": "#/newsroom"') || !retroNavigation.includes("navigationGroups('retro-astra', route, language)") || !shell.includes('<PrimaryNavigation') || !app.includes("route.page === 'newsroom'")) problems.push('RetroAstra Newsroom route/navigation is not reachable');

const webSources = [newsroom, shell, app].join("\n");
if (/AIza[0-9A-Za-z_-]{20,}/.test(webSources)) problems.push('Gemini API key leaked into browser/frontend source');


const heritageMain = read("src/web/main.tsx");
const heritageHeader = read("src/web/heritage/Header.tsx");
const heritageNewsroom = read("src/web/heritage/NewsroomPage.tsx");
const heritageStudio = read("src/web/heritage/EditorialStudioPage.tsx");
// R122: PrimaryNavigation moved from the main shell into the Header
// component (viewport-bounded overflow menu); reachability is unchanged.
if (!navigation.includes('heritage: "/newsroom"') || !heritageNavigation.includes('navigationGroups("heritage", route, locale)') || !(heritageMain.includes('<PrimaryNavigation') || heritageHeader.includes('<PrimaryNavigation')) || !heritageMain.includes('HeritageNewsroomPage')) problems.push('Heritage canonical Newsroom navigation or route is missing');
for (const token of [
  'platform.content.list', 'platform.auth.demoAdmin()', 'Demo Admin Login',
]) if (!heritageNewsroom.includes(token)) problems.push(`Heritage Newsroom missing ${token}`);
for (const token of [
  'platform.admin.content.generate', 'platform.admin.content.create', 'Google Grounding',
]) if (!heritageStudio.includes(token)) problems.push(`Heritage Editorial Studio missing ${token}`);
if (!heritageMain.includes('HeritageEditorialStudioPage')) problems.push('Heritage shell missing the Editorial Studio route');
if (problems.length) {
  console.error("Content/Newsroom validation FAILED:\n" + problems.map((p) => `  ERROR ${p}`).join("\n"));
  process.exit(1);
}
console.log("Content/Newsroom validation passed: persistent bilingual publishing, provider-neutral Gemini/DeepSeek draft-only generation with human review, explicit Gemini grounding gate, five sourced starter posts, and governed Newsroom reachability are intact.");
