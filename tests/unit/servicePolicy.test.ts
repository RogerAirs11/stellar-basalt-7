import { describe, expect, it } from "vitest";
import {
  SERVICE_ACTORS,
  SERVICE_STATES,
  SERVICE_TERMINAL_STATES,
  SERVICE_TRANSITION_MATRIX,
  serviceActorsPermitting,
  serviceRouteTransitions,
  serviceTransitionsFor,
  serviceTransitionAllowed,
} from "../../src/services/policy";
import { transitionServiceStatements } from "../../src/services/commands";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

/**
 * R95-N11 acceptance: generated tests for EVERY state x actor pair. The
 * matrix is the single source of transition truth — the route metadata and
 * the pure command must agree with it on all 6 states x 3 actors x 6
 * targets = 108 pairs, with zero hand-copied facts.
 */

describe("N11 the ONE transition matrix", () => {
  it("pins every state x actor cell exactly (the graph IS the machine)", () => {
    expect(SERVICE_TRANSITION_MATRIX.new).toEqual({
      requester: ["closed", "withdrawn"],
      provider: ["acknowledged", "closed", "spam"],
      moderator: [],
    });
    expect(SERVICE_TRANSITION_MATRIX.acknowledged).toEqual({
      requester: ["closed", "withdrawn"],
      provider: ["discussing", "closed", "spam"],
      moderator: [],
    });
    expect(SERVICE_TRANSITION_MATRIX.discussing).toEqual({
      requester: ["closed", "withdrawn"],
      provider: ["closed", "spam"],
      moderator: [],
    });
    expect(SERVICE_TRANSITION_MATRIX.closed).toEqual({ requester: [], provider: [], moderator: [] });
    expect(SERVICE_TRANSITION_MATRIX.withdrawn).toEqual({ requester: [], provider: [], moderator: [] });
    expect(SERVICE_TRANSITION_MATRIX.spam).toEqual({ requester: [], provider: [], moderator: [] });
  });

  it("no paid/booked/confirmed state exists anywhere (a lead, never an appointment)", () => {
    expect([...SERVICE_STATES]).toEqual(["new", "acknowledged", "discussing", "closed", "withdrawn", "spam"]);
    for (const state of SERVICE_STATES) {
      for (const actor of SERVICE_ACTORS) {
        for (const target of SERVICE_TRANSITION_MATRIX[state][actor]) {
          expect(["booked", "paid", "confirmed"]).not.toContain(target);
        }
      }
    }
  });

  it("terminal states are terminal for EVERY actor", () => {
    for (const state of SERVICE_TERMINAL_STATES) {
      for (const actor of SERVICE_ACTORS) {
        expect(SERVICE_TRANSITION_MATRIX[state][actor]).toEqual([]);
        expect(serviceTransitionsFor(state, actor)).toEqual([]);
      }
    }
  });

  it("the moderator axis is defined but empty (no blanket staff access; N14 will define it)", () => {
    for (const state of SERVICE_STATES) {
      expect(SERVICE_TRANSITION_MATRIX[state].moderator).toEqual([]);
    }
  });
});

describe("N11 generated agreement: route metadata, permission fn and command", () => {
  const route = serviceRouteTransitions();
  // Fake db: records every prepare() call and returns a chainable stub —
  // proves the RangeError for prohibited pairs fires BEFORE any SQL is built.
  const makeDb = () => {
    const prepared: string[] = [];
    const db = {
      prepare(sql: string) {
        prepared.push(sql);
        const statement = { sql } as unknown as D1PreparedStatement;
        return Object.assign(statement, { bind: () => statement });
      },
      __prepared: prepared,
    };
    return db as unknown as D1Database & { __prepared: string[] };
  };

  it("route metadata agrees with the matrix for every state x actor pair", () => {
    for (const state of SERVICE_STATES) {
      // `by` = exactly the actors with at least one permitted move.
      expect([...route[state].by]).toEqual(
        SERVICE_ACTORS.filter((actor) => SERVICE_TRANSITION_MATRIX[state][actor].length > 0),
      );
      // `to` = the union of permitted targets across actors.
      expect([...route[state].to]).toEqual([
        ...new Set(SERVICE_ACTORS.flatMap((actor) => SERVICE_TRANSITION_MATRIX[state][actor])),
      ]);
    }
  });

  it("serviceTransitionAllowed agrees with the matrix for every (from, to, actor) pair", () => {
    for (const from of SERVICE_STATES) {
      for (const to of SERVICE_STATES) {
        for (const actor of SERVICE_ACTORS) {
          expect(serviceTransitionAllowed(from, to, actor)).toBe(SERVICE_TRANSITION_MATRIX[from][actor].includes(to));
        }
      }
    }
  });

  it("serviceActorsPermitting agrees with the matrix for every pair", () => {
    for (const from of SERVICE_STATES) {
      for (const to of SERVICE_STATES) {
        expect([...serviceActorsPermitting(from, to)]).toEqual(
          SERVICE_ACTORS.filter((actor) => SERVICE_TRANSITION_MATRIX[from][actor].includes(to)),
        );
      }
    }
  });

  it("the command rejects EVERY prohibited (from, to, actor) pair before any SQL", () => {
    let prohibited = 0;
    for (const from of SERVICE_STATES) {
      for (const to of SERVICE_STATES) {
        for (const actor of SERVICE_ACTORS) {
          const allowed = SERVICE_TRANSITION_MATRIX[from][actor].includes(to);
          if (allowed) continue;
          prohibited += 1;
          const db = makeDb();
          expect(() =>
            transitionServiceStatements(db, { requestId: 1, expectedVersion: 1, from, to, actor, actorUserId: "user-1", operationId: "op-1" }),
          ).toThrow(RangeError);
          expect(db.__prepared).toEqual([]); // no SQL was ever constructed
        }
      }
    }
    // 108 pairs total; every one was classified, and the prohibited majority
    // all throw. (The exact count is derived, not hand-maintained.)
    expect(SERVICE_STATES.length * SERVICE_STATES.length * SERVICE_ACTORS.length).toBe(108);
    expect(prohibited).toBeGreaterThan(60);
  });

  it("the command builds statements for EVERY permitted pair (no false rejections)", () => {
    let permitted = 0;
    for (const from of SERVICE_STATES) {
      for (const to of SERVICE_STATES) {
        for (const actor of SERVICE_ACTORS) {
          if (!SERVICE_TRANSITION_MATRIX[from][actor].includes(to)) continue;
          permitted += 1;
          const db = makeDb();
          expect(() =>
            transitionServiceStatements(db, { requestId: 1, expectedVersion: 1, from, to, actor, actorUserId: "user-1", operationId: "op-1" }),
          ).not.toThrow();
          // update + audit + outbox; a withdrawal additionally appends the
          // N12 marker-gated notice-suppression statement.
          expect(db.__prepared.length).toBe(to === "withdrawn" ? 4 : 3);
        }
      }
    }
    expect(permitted).toBe(14); // requester: 2 moves x 3 live states; provider: 3+3+2
  });
});
