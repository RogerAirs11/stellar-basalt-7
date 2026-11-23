import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// A disposable committed fixture, not the developer's possibly dirty project.
let directory: string;
let currentSha: string;
const gate = join(__dirname, "../../tools/require-r95-release-approval.mjs");
function runGate(env: Record<string, string>): { exit: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [gate], {
      cwd: directory, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return { exit: 0, output };
  } catch (error) {
    const cause = error as { status?: number; stderr?: string };
    return { exit: cause.status ?? 1, output: cause.stderr ?? "" };
  }
}
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "release-gate-test-"));
  execFileSync("git", ["init", "--quiet"], { cwd: directory });
  writeFileSync(join(directory, "fixture.txt"), "synthetic approved source\n");
  execFileSync("git", ["add", "fixture.txt"], { cwd: directory });
  execFileSync("git", ["-c", "user.name=Release Gate Test", "-c", "user.email=synthetic@example.invalid", "commit", "--quiet", "-m", "synthetic fixture"], { cwd: directory });
  currentSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

describe("Exact clean-checkout release approval", () => {
  it("blocks a missing approval", () => {
    const result = runGate({ R95_PRODUCTION_RELEASE_APPROVED_SHA: "", GITHUB_SHA: "" });
    expect(result.exit).toBe(1); expect(result.output).toContain("blocked");
  });
  it("blocks a stale or spoofed CI revision", () => {
    const other = `${currentSha.slice(0, -1)}${currentSha.endsWith("f") ? "0" : "f"}`;
    const result = runGate({ R95_PRODUCTION_RELEASE_APPROVED_SHA: other, GITHUB_SHA: other });
    expect(result.exit).toBe(1); expect(result.output).toContain("exact git SHA");
  });
  it("accepts only the exact clean checkout and does not claim tests ran", () => {
    const result = runGate({ R95_PRODUCTION_RELEASE_APPROVED_SHA: currentSha, GITHUB_SHA: currentSha });
    expect(result.exit).toBe(0); expect(result.output).toContain("not proof that tests ran");
  });
  it("blocks changed tracked source", () => {
    try {
      writeFileSync(join(directory,"fixture.txt"), "unapproved change\n");
      expect(runGate({R95_PRODUCTION_RELEASE_APPROVED_SHA:currentSha,GITHUB_SHA:currentSha}).exit).toBe(1);
    } finally { writeFileSync(join(directory,"fixture.txt"), "synthetic approved source\n"); }
  });
  it("blocks untracked source", () => {
    const extra=join(directory,"unapproved.ts");
    try {
      writeFileSync(extra,"export const unapproved = true;\n");
      expect(runGate({R95_PRODUCTION_RELEASE_APPROVED_SHA:currentSha,GITHUB_SHA:currentSha}).exit).toBe(1);
    } finally { rmSync(extra,{force:true}); }
  });
});
