import { describe, expect, it } from "vitest";
import { reconcilePendingMutationAudits } from "../../src/audit/mutationJournal";

/**
 * D-REC-1 regression: one corrupt journal row (invalid actor FK, only reachable
 * via direct DB tampering because every product path binds actor_user_id from
 * the authenticated session) must quarantine that row through the existing
 * state machine instead of crashing the whole reconciliation batch. Valid
 * intents in the same batch must still reconcile.
 */

interface PendingRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  resolved_entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  requested_json: string | null;
  request_id: string | null;
  status: string;
}

interface BoundStatement {
  sql: string;
  args: unknown[];
}

function makeDb(pending: PendingRow[], opts: { corruptActors?: string[] } = {}) {
  const corruptActors = new Set(opts.corruptActors ?? []);
  const calls: string[] = [];
  const quarantineUpdates: Array<{ id: string; last_error: string | null; sql: string }> = [];

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const builder = {
        sql,
        get _bound(): BoundStatement {
          return { sql, args };
        },
        bind(...bindArgs: unknown[]) {
          args = bindArgs;
          return builder;
        },
        all<T>() {
          calls.push("select-pending");
          return Promise.resolve({ results: pending as unknown as T[] });
        },
        first<T>() {
          calls.push("count-remaining");
          return Promise.resolve({ count: 0 } as unknown as T);
        },
        run() {
          calls.push("quarantine-update");
          quarantineUpdates.push({ id: String(args[1]), last_error: args[0] as string | null, sql });
          return Promise.resolve({ meta: { changes: 1 } });
        },
      };
      return builder;
    },
    batch(statements: unknown[]) {
      const first = statements[0] as unknown as { _bound?: BoundStatement };
      const actor = first?._bound?.args?.[0];
      if (typeof actor === "string" && corruptActors.has(actor)) {
        return Promise.reject(new Error("FOREIGN KEY constraint failed"));
      }
      calls.push("batch-reconcile");
      return Promise.resolve([]);
    },
  } as unknown as D1Database;

  return { db, calls, quarantineUpdates };
}

function row(overrides: Partial<PendingRow>): PendingRow {
  return {
    id: "mut-x",
    actor_user_id: "user-1",
    action: "horse.update",
    entity_type: "horse",
    resolved_entity_id: "12",
    before_json: null,
    after_json: '{"name":"A"}',
    requested_json: null,
    request_id: "req-1",
    status: "committed",
    ...overrides,
  };
}

describe("reconcilePendingMutationAudits (D-REC-1 corrupt-row quarantine)", () => {
  it("processes valid intents and quarantines the corrupt row without throwing", async () => {
    const { db, calls, quarantineUpdates } = makeDb(
      [
        row({ id: "mut-valid-1", actor_user_id: "user-1", resolved_entity_id: "12" }),
        row({ id: "mut-corrupt", actor_user_id: "ghost-user", resolved_entity_id: "13", after_json: null, requested_json: '{"name":"B"}' }),
        row({ id: "mut-valid-2", actor_user_id: "user-1", resolved_entity_id: "14" }),
      ],
      { corruptActors: ["ghost-user"] },
    );

    const result = await reconcilePendingMutationAudits(db, 4);

    expect(result.processed).toBe(2);
    expect(result.quarantined).toBe(1);
    expect(result.remaining).toBe(0);
    expect(calls).toContain("batch-reconcile");
    expect(quarantineUpdates).toHaveLength(1);
    expect(quarantineUpdates[0]!.id).toBe("mut-corrupt");
    expect(quarantineUpdates[0]!.last_error).toContain("reconcile_quarantine:");
    expect(quarantineUpdates[0]!.last_error).toContain("FOREIGN KEY constraint failed");
  });

  it("quarantine records the failure without discarding the intent silently", async () => {
    const { db, quarantineUpdates } = makeDb(
      [row({ id: "mut-corrupt", actor_user_id: "ghost-user", after_json: null, requested_json: "{}", status: "committed" })],
      { corruptActors: ["ghost-user"] },
    );

    const result = await reconcilePendingMutationAudits(db, 4);

    expect(result.processed).toBe(0);
    expect(result.quarantined).toBe(1);
    // The quarantine UPDATE must keep `status` truthful: it only sets
    // audit_status='not_applicable' + last_error, never status='aborted',
    // so the durably-committed canonical change is not mislabeled and the
    // row remains operator-visible in last_error.
    expect(quarantineUpdates[0]!.sql).not.toContain("status='aborted'");
    expect(quarantineUpdates[0]!.sql).toContain("audit_status='not_applicable'");
    expect(quarantineUpdates[0]!.last_error).toContain("reconcile_quarantine:");
  });
});
