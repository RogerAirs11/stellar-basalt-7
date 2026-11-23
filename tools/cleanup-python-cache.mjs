import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
let removed = 0;
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "__pycache__" && statSync(path).isDirectory()) { rmSync(path, { recursive: true, force: true }); removed += 1; continue; }
    if (statSync(path).isDirectory() && name !== "node_modules" && name !== ".git") walk(path);
  }
}
walk(root);
console.log(`Removed ${removed} Python cache director${removed === 1 ? "y" : "ies"}.`);
