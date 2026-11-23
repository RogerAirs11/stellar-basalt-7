import { describe, expect, it } from "vitest";
import {
  CHANGE_REQUEST_ITEMS_MAX,
  PLATFORM_FEATURE_SPECS,
  REGISTRY_EXPORT_ROWS_MAX,
  type PlatformLimits,
} from "../../src/contracts/platform";
import { createPlatformClient } from "../../src/frontend-kit/platformClient";
import { createMockPlatformClient } from "../../src/frontend-kit/mockPlatformClient";
import { PlatformClientError } from "../../src/frontend-kit/errors";

/**
 * Post-package delta regression coverage (D01/D02/D17/D18 + P03 drift guard).
 * Pins the shared Free-tier ceilings across server contract, real client and mock client.
 */
describe("post-package delta contract limits", () => {
  it("pins the shared export and change-request ceilings", () => {
    expect(REGISTRY_EXPORT_ROWS_MAX).toBe(500);
    expect(CHANGE_REQUEST_ITEMS_MAX).toBe(24);
  });

  it("advertises the ceilings in mock platform meta limits", async () => {
    const mock = createMockPlatformClient();
    const limits = (await mock.meta()).limits as PlatformLimits;
    expect(limits.registryExportRowsMax).toBe(500);
    expect(limits.changeRequestItemsMax).toBe(24);
    // P03 drift guard: the mock must not contradict the shared 1,000-node server ceilings.
    expect(limits.pedigreeDescendantMetricsNodesMax).toBe(1000);
    expect(limits.pedigreeDescendantNodesMax).toBe(1000);
  });

  it("bounds real and mock export descriptors to 500 rows", () => {
    const transport = async <T,>(url: string): Promise<T> => ({ ok: true, url }) as T;
    const client = createPlatformClient({ transport });
    const descriptors = [
      client.exports.registry(),
      client.exports.registry({}, "json"),
      createMockPlatformClient().exports.registry(),
      createMockPlatformClient().exports.registry({}, "json"),
    ];
    for (const descriptor of descriptors) {
      expect(descriptor.maxRows).toBe(500);
      expect(descriptor.href).toContain("limit=500");
      expect(descriptor.href).not.toContain("10000");
    }
  });

  it("rejects over-sized change-request submissions client-side before transport", () => {
    const calls: string[] = [];
    const transport = async <T,>(url: string): Promise<T> => {
      calls.push(url);
      return { ok: true } as T;
    };
    const client = createPlatformClient({ transport });
    const items = Array.from({ length: 25 }, (_, index) => ({ field_name: `field_${index}`, proposed_value: index }));
    expect(() => client.changes.create({ request_type: "other", summary: "delta boundary probe", items })).toThrow(PlatformClientError);
    expect(calls).toEqual([]);
    client.changes.create({ request_type: "other", summary: "delta boundary probe", items: items.slice(0, CHANGE_REQUEST_ITEMS_MAX) });
    expect(calls).toEqual(["/api/change-requests"]);
  });

  it("classifies the exports feature as privileged, not public", () => {
    expect(PLATFORM_FEATURE_SPECS.exports.access).toBe("privileged");
  });
});
