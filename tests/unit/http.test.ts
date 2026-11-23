import { describe, expect, it } from "vitest";
import { HttpError, readJson } from "../../src/api/http";

describe("bounded JSON reader", () => {
  it("parses a valid JSON body inside the limit", async () => {
    const req = new Request("https://example.test/api/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true }) });
    await expect(readJson<{ok:boolean}>(req, 64)).resolves.toEqual({ ok: true });
  });

  it("rejects a declared body larger than the route limit", async () => {
    const req = new Request("https://example.test/api/test", { method: "POST", headers: { "content-type": "application/json", "content-length": "999" }, body: "{}" });
    await expect(readJson(req, 64)).rejects.toMatchObject({ status: 413, code: "body_too_large" });
  });

  it("rejects an oversized body even without Content-Length", async () => {
    const req = new Request("https://example.test/api/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "x".repeat(128) }) });
    await expect(readJson(req, 32)).rejects.toMatchObject({ status: 413, code: "body_too_large" });
  });
});
