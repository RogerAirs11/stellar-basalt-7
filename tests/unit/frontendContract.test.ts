import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const frontendsRoot = join(process.cwd(), "src", "web", "frontends");
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

describe("external frontend platform boundary", () => {
  it("keeps raw backend routes and backend-runtime imports out of all frontend modules", () => {
    const offenders: string[] = [];
    for (const folder of readdirSync(frontendsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      for (const path of walk(join(frontendsRoot, folder.name))) {
        if (!sourceExtensions.has(extname(path))) continue;
        const source = readFileSync(path, "utf8");
        if (/\/api\//.test(source)) offenders.push(`${folder.name}: raw /api route`);
        if (/from\s+["'][^"']*(?:\/api\/|\/db\/|\/auth\/|\/worker(?:["'/]))/.test(source)) offenders.push(`${folder.name}: backend import`);
        if (/\b(?:D1Database|env\.DB|wrangler|\.wrangler|horse-registry\.sqlite)\b/.test(source)) offenders.push(`${folder.name}: backend runtime`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}
