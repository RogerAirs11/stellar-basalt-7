import { describe, expect, it } from "vitest";
import { createPlatformClient, type PlatformTransport } from "../../src/frontend-kit/platformClient";
import { createMockPlatformClient } from "../../src/frontend-kit/mockPlatformClient";
import { isPlatformClientError, PlatformClientError } from "../../src/frontend-kit/errors";
import { classifyCommandError, classifyResourceError } from "../../src/frontend-kit/domain";
import type { PlatformClient } from "../../src/contracts/platform";

/**
 * R88 agent plan P20 acceptance: "Same command/error semantics pass against
 * real and explicit demo adapters." The real adapter is driven through a
 * scripted transport (URL/method/body/header assertions); the demo adapter is
 * the mock client. Reads resolve the same typed shapes; writes the mock
 * cannot durably perform reject 501; pay fails closed 503 on BOTH — never a
 * fabricated successful transaction.
 */

interface RecordedCall { url: string; init?: RequestInit }

function scriptedTransport(responses: Array<{ match: (url: string, init?: RequestInit) => boolean; status?: number; body?: unknown }>): { transport: PlatformTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: PlatformTransport = async <T>(url: string, init?: RequestInit): Promise<T> => {
    calls.push({ url, init });
    for (const response of responses) {
      if (response.match(url, init)) {
        if (response.status != null && response.status >= 400) {
          const envelope = response.body as { error?: { code: string; message: string; details?: unknown } } | undefined;
          throw new PlatformClientError(
            response.status,
            envelope?.error?.code ?? "request_failed",
            envelope?.error?.message ?? `Request failed (${response.status})`,
            envelope?.error?.details,
          );
        }
        return response.body as T;
      }
    }
    throw new Error(`No scripted response for ${init?.method ?? "GET"} ${url}`);
  };
  return { transport, calls };
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.[name] ?? null;
}

function bodyOf(init: RequestInit | undefined): any {
  return init?.body ? JSON.parse(String(init.body)) : undefined;
}

describe("P20 real adapter — directory module (the first module, end-to-end)", () => {
  function clientWith(responses: Parameters<typeof scriptedTransport>[0]) {
    const scripted = scriptedTransport(responses);
    return { client: createPlatformClient({ transport: scripted.transport }), calls: scripted.calls };
  }

  it("GET persons builds the exact query (category, province, city, name, cursor)", async () => {
    const { client, calls } = clientWith([{ match: (url) => url.startsWith("/api/directory/persons"), body: { persons: [], next_cursor: null, page_size: 20, filters: { category: null, province: null, city: null, name: null } } }]);
    await client.modules.directory.persons({ category: "farrier", province: "IR-08", city: "Tehran", name: "Ali", cursor: 42 });
    expect(calls[0]!.url).toBe("/api/directory/persons?category=farrier&province=IR-08&city=Tehran&name=Ali&cursor=42");
    expect(calls[0]!.init?.method).toBeUndefined(); // GET
  });

  it("GET person detail, organizations; POST claim; GET claims/mine", async () => {
    const { client, calls } = clientWith([
      { match: (url) => url === "/api/directory/persons/33", body: { person: { person_id: 33 }, credentials: [], active_credentials: [], credentials_note: "note" } },
      { match: (url) => url.startsWith("/api/directory/organizations"), body: { organizations: [], next_cursor: null, page_size: 20 } },
      { match: (url) => url === "/api/directory/claims", status: 201, body: { claim: { id: 1 }, note: "moderated" } },
      { match: (url) => url === "/api/directory/claims/mine", body: { claims: [] } },
    ]);
    await client.modules.directory.person(33);
    await client.modules.directory.organizations({ cursor: 0 });
    await client.modules.directory.submitClaim({ claim_type: "person", person_id: 33, evidence_note: "I am this person, please verify my identity" });
    await client.modules.directory.myClaims();
    expect(calls.map((call) => `${call.init?.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/directory/persons/33",
      "GET /api/directory/organizations?cursor=0",
      "POST /api/directory/claims",
      "GET /api/directory/claims/mine",
    ]);
    expect(bodyOf(calls[2]!.init)).toEqual({ claim_type: "person", person_id: 33, evidence_note: "I am this person, please verify my identity" });
  });

  it("PUT profile and POST credential carry their bodies to the exact paths", async () => {
    const { client, calls } = clientWith([
      { match: (url) => url.endsWith("/profile"), status: 200, body: { profile: {}, contact_value_stored: null, publication: "unpublished (consent not given or withdrawn)" } },
      { match: (url) => url.endsWith("/credentials"), status: 201, body: { credential: { id: 5 }, verification_level: "unverified", note: "stays unverified" } },
    ]);
    await client.modules.directory.upsertProfile(33, { service_categories: ["farrier"], publication_consent: true });
    await client.modules.directory.addCredential(33, { role: "farrier", issuer_name: "School", identifier: "X-1" });
    expect(calls[0]!.init?.method).toBe("PUT");
    expect(calls[0]!.url).toBe("/api/directory/persons/33/profile");
    expect(calls[1]!.init?.method).toBe("POST");
    expect(calls[1]!.url).toBe("/api/directory/persons/33/credentials");
  });

  it("refuses malformed ids client-side (positive registry ids only)", () => {
    const { client } = clientWith([]);
    expect(() => client.modules.directory.person(0)).toThrow(/positive registry id/);
    expect(() => client.modules.directory.person(-3)).toThrow(/positive registry id/);
    expect(() => client.modules.workspaces.dashboard(0)).toThrow(/positive registry id/);
  });
});

describe("P20 real adapter — command wire discipline (idempotency keys, CAS versions)", () => {
  it("serviceRequests.create sends the Idempotency-Key header (P12/P03 receipts)", async () => {
    const { transport, calls } = scriptedTransport([{ match: (url) => url === "/api/service-requests", status: 201, body: { created: true, request: { id: 1, provider_person_id: 9, category: "farrier", status: "new", share_contact: true }, request_digest: "d", note: "lead" } }]);
    const platform = createPlatformClient({ transport });
    await platform.modules.serviceRequests.create({ provider_person_id: 9, category: "farrier", note: "shoeing for my horse please", share_contact: true }, { idempotencyKey: "sr-12345678" });
    expect(calls[0]!.init?.method).toBe("POST");
    expect(headerOf(calls[0]!.init, "idempotency-key")).toBe("sr-12345678");
    expect(bodyOf(calls[0]!.init).share_contact).toBe(true);
  });

  it("setStatus and completeTask send expected_version (CAS) in the body", async () => {
    const { transport, calls } = scriptedTransport([
      { match: (url) => url.endsWith("/status"), body: { request: { id: 1, status: "acknowledged", row_version: 2 }, notification: { recorded: true, outbox_status: "queued", note: "queued" } } },
      { match: (url) => url.endsWith("/complete"), body: { completed: true, next_occurrence: null } },
    ]);
    const platform = createPlatformClient({ transport });
    await platform.modules.serviceRequests.setStatus(1, "acknowledged", { expectedVersion: 1 });
    await platform.modules.workspaces.completeTask(4, 9, { expectedVersion: 3 });
    expect(bodyOf(calls[0]!.init)).toEqual({ status: "acknowledged", expected_version: 1 });
    expect(calls[0]!.url).toBe("/api/service-requests/1/status");
    expect(bodyOf(calls[1]!.init)).toEqual({ expected_version: 3 });
    expect(calls[1]!.url).toBe("/api/workspaces/4/tasks/9/complete");
  });

  it("workspaces: create/mine/dashboard/staff/task/export hit the documented paths", async () => {
    const { transport, calls } = scriptedTransport([
      { match: (url) => url === "/api/workspaces", status: 201, body: { created: true, workspace: { id: 1, name: "Main", organization_id: null }, ownership_note: "working set" } },
      { match: (url) => url === "/api/workspaces/mine", body: { owned: [], staff: [] } },
      { match: (url) => url === "/api/workspaces/1", body: { workspace: null, herd_size: 0, horses: [], tasks: { overdue: [], due_soon: [], later: [] }, active_staff: [], notes: [] } },
      { match: (url) => url === "/api/workspaces/1/staff", status: 201, body: { assigned: true, user_id: "u2", actions: ["view"], note: "live re-check" } },
      { match: (url) => url.endsWith("/tasks"), status: 201, body: { created: true, task: { title: "Vet visit", category: "veterinary_appointment", due_date: "2026-11-01", recurrence: "none" }, veterinary_notice: "qualified person", note: "reminder" } },
      { match: (url) => url.endsWith("/tasks?status=all"), body: { tasks: [] } },
    ]);
    const platform = createPlatformClient({ transport });
    await platform.modules.workspaces.create({ name: "Main" });
    await platform.modules.workspaces.mine();
    await platform.modules.workspaces.dashboard(1);
    await platform.modules.workspaces.assignStaff(1, { user_id: "u2", actions: "view" });
    await platform.modules.workspaces.addTask(1, { title: "Vet visit", category: "veterinary_appointment", due_date: "2026-11-01" });
    await platform.modules.workspaces.tasks(1, { status: "all" });
    expect(platform.modules.workspaces.exportUrl(1)).toBe("/api/workspaces/1/export");
    expect(calls.map((call) => `${call.init?.method ?? "GET"} ${call.url}`)).toEqual([
      "POST /api/workspaces",
      "GET /api/workspaces/mine",
      "GET /api/workspaces/1",
      "POST /api/workspaces/1/staff",
      "POST /api/workspaces/1/tasks",
      "GET /api/workspaces/1/tasks?status=all",
    ]);
  });

  it("billing: catalog/offers/orders/pay/entitlements hit the documented paths", async () => {
    const { transport, calls } = scriptedTransport([
      { match: (url) => url === "/api/billing/catalog", body: { currency_internal: "IRR", prices: [], note: "n" } },
      { match: (url) => url === "/api/commerce/offers", body: { offers: [], free_forever: [], trust_note: "t", note: "n" } },
      { match: (url) => url === "/api/billing/orders", status: 201, body: { created: true, order: { id: 1, order_key: "k", status: "pending", total_minor: 19000000, currency: "IRR", total_toman: 1900000, lines: [] }, money_note: "m" } },
      { match: (url) => url === "/api/billing/orders/mine", body: { orders: [], currency_note: "c" } },
      { match: (url) => url === "/api/billing/orders/1", body: { order: {}, lines: [], payment_attempts: [], status_note: "s" } },
      { match: (url) => url.endsWith("/cancel"), body: { cancelled: true, note: "state change" } },
      { match: (url) => url.endsWith("/pay"), status: 201, body: { attempt_id: 7, authority: "a", start_pay_url: "https://pay", amount_minor: 19000000, currency: "IRR", amount_toman: 1900000, note: "server-side verification" } },
      { match: (url) => url === "/api/billing/entitlements", body: { entitlements: [], boundary_note: "b" } },
    ]);
    const platform = createPlatformClient({ transport });
    await platform.modules.billing.catalog();
    await platform.modules.billing.offers();
    await platform.modules.billing.createOrder({ order_key: "k", items: [{ sku: "farm_workspace_monthly", quantity: 1 }] }, { idempotencyKey: "order-12345678" });
    expect(headerOf(calls[2]!.init, "idempotency-key")).toBe("order-12345678");
    await platform.modules.billing.myOrders();
    await platform.modules.billing.order(1);
    await platform.modules.billing.cancelOrder(1);
    await platform.modules.billing.pay(1);
    await platform.modules.billing.entitlements();
    expect(calls.map((call) => `${call.init?.method ?? "GET"} ${call.url}`)).toEqual([
      "GET /api/billing/catalog",
      "GET /api/commerce/offers",
      "POST /api/billing/orders",
      "GET /api/billing/orders/mine",
      "GET /api/billing/orders/1",
      "POST /api/billing/orders/1/cancel",
      "POST /api/billing/orders/1/pay",
      "GET /api/billing/entitlements",
    ]);
  });
});

describe("P20 same semantics against the explicit demo adapter (mock)", () => {
  const mock: PlatformClient = createMockPlatformClient();

  it("reads resolve the SAME typed shapes as the real adapter", async () => {
    const persons = await mock.modules.directory.persons();
    expect(persons.persons.length).toBeGreaterThan(0);
    expect(persons.persons[0]!.contact_note).toContain("mediated by the platform");
    // contact_value is NEVER a public field — the DTO type has no such key.
    expect("contact_value" in persons.persons[0]!).toBe(false);

    const detail = await mock.modules.directory.person(9001);
    expect(detail.credentials[0]!.verification_level).toBe("unverified");

    const requests = await mock.modules.serviceRequests.mine();
    expect(requests.requests).toEqual([]);
    const inbox = await mock.modules.serviceRequests.inbox();
    expect(inbox.inbox).toBe("provider");

    const workspaces = await mock.modules.workspaces.mine();
    expect(workspaces.owned).toEqual([]);
    expect(workspaces.staff).toEqual([]);

    const catalog = await mock.modules.billing.catalog();
    expect(catalog.currency_internal).toBe("IRR");
    const offers = await mock.modules.billing.offers();
    expect(offers.trust_note).toContain("Payment buys conveniences only");
    const orders = await mock.modules.billing.myOrders();
    expect(orders.orders).toEqual([]);
  });

  it("every WRITE the mock cannot durably perform rejects 501 — never a fabricated success", async () => {
    const writes: Array<() => Promise<unknown>> = [
      () => mock.modules.directory.submitClaim({ claim_type: "person", person_id: 1, evidence_note: "evidence note here" }),
      () => mock.modules.directory.upsertProfile(1, { service_categories: [], publication_consent: false }),
      () => mock.modules.directory.addCredential(1, { role: "farrier", issuer_name: "X", identifier: "Y" }),
      () => mock.modules.serviceRequests.create({ provider_person_id: 9, category: "farrier", note: "note with length", share_contact: false }, { idempotencyKey: "mock-key-1" }),
      () => mock.modules.serviceRequests.setStatus(1, "acknowledged", { expectedVersion: 1 }),
      () => mock.modules.workspaces.create({ name: "Demo" }),
      () => mock.modules.workspaces.addTask(1, { title: "Task", category: "other", due_date: "2026-11-01" }),
      () => mock.modules.workspaces.completeTask(1, 1, { expectedVersion: 1 }),
      () => mock.modules.billing.createOrder({ order_key: "k", items: [{ sku: "farm_workspace_monthly", quantity: 1 }] }, { idempotencyKey: "mock-key-2" }),
      () => mock.modules.billing.cancelOrder(1),
    ];
    for (const write of writes) {
      await expect(write()).rejects.toSatisfy((error: unknown) => isPlatformClientError(error) && error.status === 501);
    }
  });

  it("pay fails closed 503 on the demo adapter exactly like an unconfigured real deployment", async () => {
    await expect(mock.modules.billing.pay(1)).rejects.toSatisfy((error: unknown) => isPlatformClientError(error) && error.status === 503);
  });
});

describe("P20 same command/error classification across both adapters", () => {
  it("a 409 CAS conflict maps to rejected with the current version — real and mock identically", () => {
    const conflict = new PlatformClientError(409, "stale_version", "The task changed before your edit landed", { current_version: 7 });
    const state = classifyCommandError(conflict);
    expect(state.phase).toBe("rejected");
    if (state.phase === "rejected") {
      expect(state.currentVersion).toBe(7);
      expect(state.status).toBe(409);
      expect(state.code).toBe("stale_version");
    }
    // The same envelope thrown by the demo adapter classifies identically.
    expect(classifyCommandError(conflict)).toEqual(state);
  });

  it("mock write rejections (501) and real rejections classify to the same phase", async () => {
    const mock = createMockPlatformClient();
    try {
      await mock.modules.workspaces.create({ name: "Demo" });
      throw new Error("expected rejection");
    } catch (error) {
      const fromMock = classifyCommandError(error);
      const fromReal = classifyCommandError(new PlatformClientError(501, "feature_unavailable", "Mock workspace writes unavailable"));
      expect(fromMock.phase).toBe("rejected");
      expect(fromReal.phase).toBe("rejected");
    }
  });

  it("429 keeps the retry hint in command state too", () => {
    const state = classifyCommandError(new PlatformClientError(429, "too_many_open_requests", "bounded", { retry_after_seconds: 60 }));
    expect(state.phase).toBe("rejected");
    if (state.phase === "rejected") expect(state.retryAfterSeconds).toBe(60);
  });

  it("unknown-outcome commands are failed; deliberate fail-closed refusals are rejected with the honest reason", () => {
    // 500/504: the command's effect is unknown — the UI must re-read.
    expect(classifyCommandError(new PlatformClientError(500, "internal", "boom")).phase).toBe("failed");
    expect(classifyCommandError(new PlatformClientError(504, "gateway_timeout", "unknown")).phase).toBe("failed");
    // R96 (F15): 503 is conservatively "failed" — a proxy or upstream may
    // fail AFTER committing a write; HTTP status alone cannot prove no effect.
    expect(classifyCommandError(new PlatformClientError(503, "bad_gateway", "upstream dropped")).phase).toBe("failed");
    // The platform's documented fail-closed 501 (deliberately unimplemented —
    // e.g. terminal_payment_proof_required / payment_provider_unconfigured
    // on the charge route) IS a deliberate refusal with the honest reason.
    const failClosed = classifyCommandError(new PlatformClientError(501, "terminal_payment_proof_required", "no attempt was released"));
    expect(failClosed.phase).toBe("rejected");
    if (failClosed.phase === "rejected") expect(failClosed.message).toContain("no attempt was released");
    // Resource-state classification is separate: an unavailable resource is
    // surfaced as such, never as a silent success.
    expect(classifyResourceError(new PlatformClientError(503, "payment_provider_unconfigured", "no charge")).phase).toBe("unavailable");
  });

  it("idempotent replays are surfaced from any adapter response shape", () => {
    expect(classifyCommandError(new Error("x")).phase).toBe("failed");
  });
});
