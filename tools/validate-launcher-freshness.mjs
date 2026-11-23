import { readFileSync } from "node:fs";

const ps = readFileSync("HorseRegistryLauncher.ps1", "utf8");
const bat = readFileSync("Launch Horse Registry.bat", "utf8");
const routes = readFileSync("src/api/routes.ts", "utf8");
const local = readFileSync("tools/local-sqlite-vite.ts", "utf8");
const platform = readFileSync("src/contracts/platform.ts", "utf8");
const failures = [];
const need = (text, token, label) => { if (!text.includes(token)) failures.push(label); };

need(ps, "SMART LAUNCHER v9", "launcher banner is not v9");
need(bat, "Smart Launcher v9", "batch launcher title is not v9");
need(ps, "function Get-SourceFingerprint", "source-tree fingerprint function missing");
need(ps, "Clear-SourceCaches $sourceFingerprint", "source-change cache purge missing");
need(ps, "Stop-StaleSameVersionInstances $finalVersion $sourceFingerprint", "stale same-version process protection missing");
need(ps, "Find-HealthyCurrentInstance $finalVersion $sourceFingerprint", "instance reuse is not fingerprint-gated");
need(ps, "$env:HORSE_REGISTRY_SOURCE_FINGERPRINT = $sourceFingerprint", "fingerprint is not passed to Vite runtime");
need(ps, "sourceFingerprint).Trim().ToLowerInvariant() -eq $sourceFingerprint", "readiness probe does not verify exact source fingerprint");
need(ps, "?launch=", "browser launch cache-busting token missing");
need(ps, '"node_modules\\.vite", "node_modules\\.cache", ".vite", "dist"', "Vite/build cache purge set missing");
need(routes, "sourceFingerprint: env.SOURCE_FINGERPRINT || undefined", "health endpoint does not expose launcher source fingerprint");
need(local, 'SOURCE_FINGERPRINT: process.env.HORSE_REGISTRY_SOURCE_FINGERPRINT || ""', "local SQLite Vite runtime does not propagate fingerprint");
need(platform, "sourceFingerprint?: string;", "platform health type lacks source fingerprint");
need(ps, "Find-FreePort([int]$Start = 3000, [int]$End = 3099)", "smart launcher does not prefer port 3000 with upward fallback");
const devLaunch = readFileSync("tools/dev-launch.mjs", "utf8");
const pkg = readFileSync("package.json", "utf8");
need(devLaunch, 'viteArgs.push("--port", "3000")', "node dev launcher default port is not 3000");
if (devLaunch.includes('viteArgs.push("--strictPort")')) failures.push("node dev launcher still forces strictPort instead of allowing 3001+ fallback");
need(pkg, '"dev:raw": "vite dev --mode sqlite --host 127.0.0.1 --port 3000"', "dev:raw does not start at loopback port 3000 with Vite fallback");
if (pkg.includes('"dev:raw": "vite dev --mode sqlite --host 0.0.0.0')) failures.push("dev:raw must not bind 0.0.0.0 — R106 reviewed security posture is loopback-only by default");

if (failures.length) {
  console.error("Launcher freshness validation FAILED:");
  for (const failure of failures) console.error(`  ERROR ${failure}`);
  process.exit(1);
}
console.log("Launcher freshness validation passed: source fingerprints gate reuse, stale same-version Vite instances are rejected, caches are purged on source changes, and browser launches are cache-busted.");
