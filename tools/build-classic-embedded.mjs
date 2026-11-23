/** Reproducibly publish the native Classic app under its host mount.
 * --check is read-only and detects donor/public drift before build/deploy.
 * Replacement requires --force and uses a staged directory with rollback. */
import { cp, mkdir, readFile, writeFile, access, rm, readdir, mkdtemp, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
if (outIndex >= 0 && (!args[outIndex + 1] || args[outIndex + 1].startsWith("--"))) throw new Error("--out requires a directory");
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") { i++; continue; }
  if (!["--force", "--check"].includes(args[i])) throw new Error(`Unknown option: ${args[i]}`);
}
if (args.includes("--force") && args.includes("--check")) throw new Error("--check cannot be combined with --force");
const defaultOut = path.join(root, "public/classic-registry");
const out = path.resolve(outIndex >= 0 ? args[outIndex + 1] : defaultOut);
const source = path.join(root, "standalone-frontends/classic-v1.4/public");
if (out === root || out === source || source.startsWith(out + path.sep) || out.startsWith(source + path.sep)) throw new Error("Unsafe output directory");
if (out.startsWith(root + path.sep) && out !== defaultOut) throw new Error("Inside the repository, only public/classic-registry is an allowed output; use an external temporary directory otherwise.");
const markerName = ".horse-db-classic-build.json";
const marker = JSON.stringify({ kind: "horse-db-classic-embedded", version: 1 }) + "\n";
// The native app and React skins consume the same service workflow semantics.
// Bundle only the framework-neutral entry, with deterministic output and no
// dependency on a development server or a runtime import of TypeScript/React.
const serviceName = "ui/service-domain.js";
const serviceBuild = await build({
  absWorkingDir: root, entryPoints: ["src/frontend-kit/service-domain-entry.ts"],
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
  legalComments: "none", charset: "utf8", sourcemap: false,
});
const serviceBytes = Buffer.from(serviceBuild.outputFiles[0].contents);
async function filesAt(directory, prefix = "") {
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) names.push(...await filesAt(path.join(directory, entry.name), name));
    else if (entry.isFile()) names.push(name);
    else throw new Error(`Unsupported non-regular Classic asset: ${name}`);
  }
  return names.sort();
}
function transform(name, bytes) {
  if (name === "index.html") return Buffer.from(bytes.toString("utf8")
    .replaceAll('src="/ui/', 'src="/classic-registry/ui/')
    .replaceAll('href="/ui/', 'href="/classic-registry/ui/')
    .replace('href="/manifest.webmanifest"', 'href="/classic-registry/manifest.webmanifest"'));
  if (name === "manifest.webmanifest") {
    const manifest = JSON.parse(bytes.toString("utf8"));
    manifest.start_url = "/classic-registry/#/home"; manifest.scope = "/classic-registry/";
    return Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  }
  return bytes;
}
let exists = false; try { await access(out); exists = true; } catch {}
if (args.includes("--check")) {
  const names = await filesAt(source);
  const expected = new Set([...names, serviceName, markerName]);
  const problems = [];
  try { if (!serviceBytes.equals(await readFile(path.join(source, serviceName)))) problems.push(`outdated donor domain: ${serviceName}`); }
  catch { problems.push(`missing donor domain: ${serviceName}`); }
  for (const name of expected) {
    const bytes = name === markerName ? Buffer.from(marker) : name === serviceName ? serviceBytes : transform(name, await readFile(path.join(source, name)));
    try { if (!bytes.equals(await readFile(path.join(out, name)))) problems.push(`outdated: ${name}`); }
    catch { problems.push(`missing: ${name}`); }
  }
  if (exists) for (const name of await filesAt(out)) if (!expected.has(name)) problems.push(`unexpected: ${name}`);
  if (problems.length) { console.error(`Classic embedded output is stale:\n${problems.join("\n")}\nRebuild with npm run build:classic:embedded -- --force, then review the diff.`); process.exitCode = 1; }
  else console.log(`Classic embedded output matches ${expected.size} generated files.`);
} else {
  if (exists && !args.includes("--force")) throw new Error(`Output exists: ${out}. Inspect it before explicitly passing --force.`);
  if (exists && out !== defaultOut) {
    let previous; try { previous = JSON.parse(await readFile(path.join(out, markerName), "utf8")); } catch {}
    if (previous?.kind !== "horse-db-classic-embedded") throw new Error("Refusing to replace an unmarked external directory, even with --force.");
  }
  await mkdir(path.dirname(out), { recursive: true });
  const staging = await mkdtemp(`${out}.staging-`);
  const backup = `${out}.backup-${randomUUID()}`;
  let backedUp = false;
  try {
    await writeFile(path.join(source, serviceName), serviceBytes);
    await cp(source, staging, { recursive: true });
    for (const name of ["index.html", "manifest.webmanifest"]) await writeFile(path.join(staging, name), transform(name, await readFile(path.join(source, name))));
    await writeFile(path.join(staging, markerName), marker);
    if (exists) { await rename(out, backup); backedUp = true; }
    try { await rename(staging, out); }
    catch (error) { if (backedUp) { await rename(backup, out); backedUp = false; } throw error; }
    if (backedUp) await rm(backup, { recursive: true });
    console.log(`Built native Classic mount: ${out}`);
  } finally { await rm(staging, { recursive: true, force: true }); }
}
