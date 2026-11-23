import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function configText(name: string): string {
  return readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
}

describe("Cloudflare Worker Node compatibility", () => {
  for (const name of ["wrangler.jsonc", "wrangler.staging.jsonc"]) {
    it(`${name} enables nodejs_compat for the statically bundled Supabase adapter`, () => {
      const text = configText(name);
      expect(text).toMatch(/"compatibility_flags"\s*:\s*\[[^\]]*"nodejs_compat"[^\]]*\]/s);
    });
  }
});
