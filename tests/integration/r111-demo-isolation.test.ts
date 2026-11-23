import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { configuredPaymentCallbackOrigin, isIsolatedDemoPaymentEnvironment } from "../../src/commerce/payments/demoGateway";
import { isDemoAdminLoginAvailable } from "../../src/auth/publicAuthPolicy";
import { openLocalSqlite } from "../../src/db/localSqlite";
import { localDemoControl } from "../../tools/local-demo-controls";
import { resolveBreedingSeason } from "../../src/genetics/breedingDates";
import { parseRegistryDate } from "../../src/registry/dates";
import { seasonRangeForPartialDate } from "../../src/genetics/seasonDisplay";

const local = { APP_ENV:"local", ISOLATED_DEMO_MODE:"1", REGISTRY_DATASET_KIND:"synthetic", ENABLE_DEMO_ADMIN_LOGIN:"1", PAYMENT_CALLBACK_BASE_URL:"http://127.0.0.1:3000" };
afterEach(() => vi.unstubAllGlobals());

describe("R111 local payment callback exception", () => {
  it("requires the independent local + isolated + synthetic payment policy", () => {
    expect(isIsolatedDemoPaymentEnvironment(local)).toBe(true);
    for (const overrides of [{APP_ENV:"production"},{APP_ENV:"test"},{ISOLATED_DEMO_MODE:"0"},{REGISTRY_DATASET_KIND:"client"}]) {
      expect(isIsolatedDemoPaymentEnvironment({...local,...overrides})).toBe(false);
    }
  });
  it("allows only the fixed marked local demo origin", () => {
    expect(configuredPaymentCallbackOrigin(local,"demo")?.origin).toBe("http://127.0.0.1:3000");
    expect(configuredPaymentCallbackOrigin(local,"live")).toBeNull();
    for (const overrides of [{APP_ENV:"production"},{APP_ENV:"test"},{ISOLATED_DEMO_MODE:"0"},{REGISTRY_DATASET_KIND:"client"},{PAYMENT_CALLBACK_BASE_URL:"http://localhost:3000"},{PAYMENT_CALLBACK_BASE_URL:"http://127.0.0.1:3001"},{PAYMENT_CALLBACK_BASE_URL:"http://127.0.0.1:3000/override"},{PAYMENT_CALLBACK_BASE_URL:"http://127.0.0.1:3000?redirect=https://example.test"},{PAYMENT_CALLBACK_BASE_URL:"http://user:pass@127.0.0.1:3000"}]) {
      expect(configuredPaymentCallbackOrigin({...local,...overrides},"demo")).toBeNull();
    }
    expect(configuredPaymentCallbackOrigin({PAYMENT_CALLBACK_BASE_URL:"https://registry.example"},"live")?.origin).toBe("https://registry.example");
  });
  it("cannot enable privileged persona login using a feature flag alone", () => {
    expect(isDemoAdminLoginAvailable(local)).toBe(true);
    for (const overrides of [{APP_ENV:"production"},{APP_ENV:"development"},{ISOLATED_DEMO_MODE:"0"},{REGISTRY_DATASET_KIND:"client"},{ENABLE_DEMO_ADMIN_LOGIN:"0"}]) expect(isDemoAdminLoginAvailable({...local,...overrides})).toBe(false);
    expect(isDemoAdminLoginAvailable({APP_ENV:"local",ENABLE_DEMO_ADMIN_LOGIN:"1"})).toBe(false);
  });
  it("production job and clock controls fail before touching a database or network", async () => {
    const fetch = vi.fn(() => { throw new Error("No external IO permitted"); });
    vi.stubGlobal("fetch",fetch);
    const prepare = vi.fn(() => { throw new Error("Must be gated before DB access"); });
    for (const path of ["context","clock","run-pending-jobs"]) {
      await expect(localDemoControl(new Request(`https://registry.example/api/demo/${path}`,{method:path==="context"?"GET":"POST"}),
        {...local,APP_ENV:"production",DB:{prepare}} as never)).rejects.toMatchObject({status:404});
    }
    expect(prepare).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("R111 immutable reference backing store", () => {
  it("rejects writes in SQLite even if a caller bypasses HTTP controls", async () => {
    const directory=mkdtempSync(join(tmpdir(),"r111-reference-"));
    const path=join(directory,"reference.sqlite");
    const original=new DatabaseSync(path); original.exec("CREATE TABLE records(id INTEGER PRIMARY KEY, name TEXT);INSERT INTO records VALUES(1,'Synthetic reference');"); original.close();
    const db=openLocalSqlite(path,{readOnly:true});
    try {
      expect(await db.prepare("SELECT name FROM records WHERE id=1").first("name")).toBe("Synthetic reference");
      await expect(db.prepare("UPDATE records SET name='changed' WHERE id=1").run()).rejects.toThrow();
      await db.exec("PRAGMA query_only=OFF");
      await expect(db.prepare("DELETE FROM records").run()).rejects.toThrow();
      expect(await db.prepare("SELECT COUNT(*) AS n FROM records").first("n")).toBe(1);
    } finally { rmSync(directory,{recursive:true,force:true}); }
  });
});

describe("R111 canonical synthetic calendar", () => {
  it("obeys the actual Nowruz boundary and preserves partial dates", () => {
    expect(resolveBreedingSeason("2026-03-20",1404)).toBe(1404);
    expect(resolveBreedingSeason("2026-03-21",1405)).toBe(1405);
    expect(resolveBreedingSeason("2020-05-12",1399)).toBe(1399);
    expect(resolveBreedingSeason(null,1405)).toBe(1405);
    expect(() => resolveBreedingSeason("2026-03-20",1405)).toThrow();
    expect(() => resolveBreedingSeason("2026-03",1404)).toThrow();
    expect(() => resolveBreedingSeason(null,null)).toThrow();
    const partial=parseRegistryDate({value:"2026-03",precision:"month",calendar:"gregorian"},2200);
    expect(partial.ok).toBe(true);
    if (partial.ok) expect(seasonRangeForPartialDate(partial.date)).toMatchObject({min:1404,max:1405});
  });
});
