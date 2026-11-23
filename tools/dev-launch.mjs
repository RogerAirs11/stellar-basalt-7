#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const forwarded = process.argv.slice(2);
const strictQa = forwarded.includes("--strict-qa");
const viteForwarded = forwarded.filter((arg) => arg !== "--strict-qa");

function hasArg(flag) {
  return viteForwarded.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

const viteArgs = [path.join(root, "node_modules", "vite", "bin", "vite.js"), "dev", "--mode", "sqlite"];
if (!hasArg("--host")) viteArgs.push("--host", "127.0.0.1");
if (!hasArg("--port")) viteArgs.push("--port", "3000");
// Intentionally do not force --strictPort: Vite will advance to 3001, 3002, ... when needed.
viteArgs.push(...viteForwarded);

const env = { ...process.env, VITE_REACT_STRICT_QA: strictQa ? "1" : (process.env.VITE_REACT_STRICT_QA ?? "0") };
if (strictQa) console.log("Horse Registry dev mode: Strict QA enabled (React StrictMode double-invocation checks active).");
else console.log("Horse Registry dev mode: fast runtime (use `npm run dev:qa` for React StrictMode QA).");
const vite = spawnSync(process.execPath, viteArgs, { cwd: root, stdio: "inherit", env });
if (vite.error) {
  console.error(`Vite failed to start: ${vite.error.message}`);
  process.exit(1);
}
process.exit(vite.status ?? 0);
