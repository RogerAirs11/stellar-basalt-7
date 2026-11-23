// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Execute the actual repository gate against virtual source variants. This
// proves the updated AST check retains each restriction without editing files.
// R154: the "professional" presentation was removed by owner decision, so the
// pinned provider condition shrank to its two remaining AND conditions.
const root = process.cwd();
const mainPath = join(root, "src/web/main.tsx");
const source = readFileSync(mainPath, "utf8");
const gate = readFileSync(join(root, "tools/validate-mobile-ux-system.mjs"), "utf8").replace(/^import .*;\r?\n/gm, "");
const original = 'enabled={tabHierarchy==="docked" && navigationLayout!=="sidebar"}';
function passes(expression: string, suffix = ""): boolean {
  const changed = source.replace(original, `enabled={${expression}}`) + suffix;
  let exitCode = 0; const stop = new Error("gate exit");
  try {
    runInNewContext(gate, {
      readFileSync: (path: string) => path === mainPath ? changed : readFileSync(path, "utf8"), join, ts,
      process: { cwd: () => root, exit: (code: number) => { exitCode = code; throw stop; } },
      console: { log() {}, error() {} },
    });
  } catch (error) { if (error !== stop) throw error; }
  return exitCode === 0;
}
describe("mobile dock gate protects actual provider conditions", () => {
  it("accepts the same two AND conditions with different order and spaces", () => {
    expect(source).toContain(original);
    expect(passes('( navigationLayout !== "sidebar" ) && (tabHierarchy === "docked")')).toBe(true);
  });
  it.each([
    'navigationLayout!=="sidebar"',
    'tabHierarchy==="docked"',
  ])("rejects a removed condition: %s", expression => { expect(passes(expression)).toBe(false); });
  it("rejects an OR that bypasses the inherited layout restrictions", () => {
    expect(passes('navigationLayout!=="sidebar" || tabHierarchy==="docked"')).toBe(false);
  });
  it("does not accept the correct condition in an unrelated string or comment", () => {
    expect(passes("true", `\n// ${original}\n`)).toBe(false);
  });
});
