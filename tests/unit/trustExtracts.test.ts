import { describe, expect, it } from "vitest";
import {
  buildExtractSnapshot,
  diffExtractPayloads,
  EXTRACT_LEGAL_NOTE_EN,
  EXTRACT_LEGAL_NOTE_FA,
  EXTRACT_TEMPLATE_VERSION,
  generateExtractCode,
  isExtractCodeShape,
  stableStringify,
  verifyExtractCore,
  type ExtractSourceRow,
} from "../../src/trust/extracts";
import type { D1Database } from "@cloudflare/workers-types";
import { sha256Hex } from "../../src/trust/attestations";

/**
 * Master-Ai plan T06 (finding F04): certificates were mutable — the digest
 * hashed horseId+language+code, and rendering read LIVE facts. Registry
 * extracts pin the fix: the payload itself is hashed, snapshots are immutable,
 * every issuance gets its own secure code, and verification replays stored
 * facts with revocation and change notices.
 */

const sourceRow: ExtractSourceRow = {
  id: 7,
  register_no: "REG-2024-0007",
  ueln_no: "IR00000007",
  name_latin: "Shahriar",
  name_native: "شهریار",
  breed_desc: "Arabian",
  sex_desc: "stallion",
  color_desc: "grey",
  birth_year: 2018,
  birth_place_desc: "Tehran",
  main_strain_desc: "Kuhailan",
  sub_strain_desc: null,
  sire_id: 3,
  sire_latin: "Qatar Al Shaqab",
  sire_native: null,
  dam_id: 4,
  dam_latin: "Noura",
  dam_native: "نورا",
  breeder: "Reza Karimi رضا کریمی",
  owner: "Ali Mohammadi علی محمدی",
};

function buildSnapshot(overrides: Partial<ExtractSourceRow> = {}, issuedAt = "2026-10-03T10:00:00.000Z") {
  return buildExtractSnapshot({
    horse: { ...sourceRow, ...overrides },
    attestations: [{ issuer_slug: "lab-tejarat", issuer_name: "Lab Tejarat", record_kind: "genetic_test", field_scope: ["result"], issued_at: "2026-09-01", expires_at: null, status: "active" }],
    language: "en",
    issuedAt,
  });
}

describe("canonical serialization", () => {
  it("is stable across key insertion order", () => {
    const a = stableStringify({ horse: { name: "Shahriar", id: 7 }, people: ["Ali"] });
    const b = stableStringify({ people: ["Ali"], horse: { id: 7, name: "Shahriar" } });
    expect(a).toBe(b);
  });

  it("serializes nested arrays and null deterministically", () => {
    expect(stableStringify([null, { b: 1, a: 2 }])).toBe('[null,{"a":2,"b":1}]');
  });
});

describe("extract snapshot payload (T06 step 2)", () => {
  it("carries only public facts — private evidence never enters", () => {
    const payload = buildSnapshot();
    const serialized = stableStringify(payload);
    for (const forbidden of ["lab_accession", "notes", "result_interpretation", "phone", "address", "password"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
    expect(payload.horse.name_latin).toBe("Shahriar");
    expect(payload.pedigree.sire).toEqual({ id: 3, name_latin: "Qatar Al Shaqab", name_native: null });
    expect(payload.people.owner).toEqual(["Ali Mohammadi علی محمدی"]);
  });

  it("embeds legal status and template version metadata", () => {
    const payload = buildSnapshot();
    expect(payload.meta.legal_status).toBe("informational_extract");
    expect(payload.meta.legal_status_note_en).toBe(EXTRACT_LEGAL_NOTE_EN);
    expect(payload.meta.legal_status_note_fa).toBe(EXTRACT_LEGAL_NOTE_FA);
    expect(payload.meta.template_version).toBe(EXTRACT_TEMPLATE_VERSION);
  });

  it("references attestations without embedding their private evidence", () => {
    const payload = buildSnapshot();
    expect(payload.attestations).toHaveLength(1);
    expect(payload.attestations[0]).toMatchObject({ issuer_slug: "lab-tejarat", record_kind: "genetic_test" });
    expect(stableStringify(payload.attestations[0]).includes("statement")).toBe(false);
  });
});

describe("secure public codes (T06 step 5)", () => {
  it("generates unambiguous, correctly-shaped codes", () => {
    for (let index = 0; index < 50; index += 1) {
      const code = generateExtractCode();
      expect(isExtractCodeShape(code)).toBe(true);
      expect(code).not.toMatch(/[ILOU01]/); // no ambiguous glyphs
    }
  });

  it("never repeats across many draws", () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateExtractCode()));
    expect(codes.size).toBe(500);
  });
});

describe("snapshot diff (change notice)", () => {
  it("reports the exact changed horse fields, excluding issuance time", () => {
    const issued = buildSnapshot();
    const current = buildSnapshot({ name_latin: "Shahriar II" }, "2026-12-01T00:00:00.000Z");
    const changed = diffExtractPayloads(issued, current);
    expect(changed).toEqual(["horse.name_latin"]);
  });

  it("reports people and pedigree changes at section level", () => {
    const issued = buildSnapshot();
    expect(diffExtractPayloads(issued, buildSnapshot({ owner: "New Owner" }))).toEqual(["people"]);
    expect(diffExtractPayloads(issued, buildSnapshot({ sire_id: null, sire_latin: null, sire_native: null }))).toEqual(["pedigree"]);
  });

  it("reports no changes for identical facts", () => {
    expect(diffExtractPayloads(buildSnapshot(), buildSnapshot())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// verifyExtractCore with a scripted D1 fake.

interface ExtractRow {
  id: string;
  horse_id: number;
  extract_code: string;
  language: "fa" | "en";
  template_version: string;
  payload: string;
  payload_digest: string;
  issued_at: string;
  status: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

function makeExtractDb(stored: ExtractRow | null, currentHorse: ExtractSourceRow | null) {
  const currentPayload = currentHorse
    ? buildExtractSnapshot({ horse: currentHorse, attestations: [], language: "en", issuedAt: "" })
    : null;
  const db = {
    prepare(sql: string) {
      const bind = (args: unknown[]) => ({
        async first<T>(): Promise<T | null> {
          if (sql.includes("SELECT COUNT(*) AS count FROM horses WHERE id IN")) return args.length as unknown as T;
          if (sql.includes("FROM registry_extracts WHERE extract_code=?")) return (stored as unknown as T) ?? null;
          if (sql.includes("FROM horses h")) return (currentHorse as unknown as T) ?? null;
          if (sql.includes("FROM attestations a JOIN issuers")) return { results: [] } as unknown as T;
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (sql.includes("FROM attestations a JOIN issuers")) return { results: [] as T[] };
          return { results: [] as T[] };
        },
        async run() {
          return { meta: { last_row_id: 0 } };
        },
      });
      return { bind: (...args: unknown[]) => bind(args) };
    },
  };
  return { db: db as unknown as D1Database, currentPayload };
}

async function storedRowFor(horse: ExtractSourceRow, overrides: Partial<ExtractRow> = {}): Promise<ExtractRow> {
  const payload = buildExtractSnapshot({ horse, attestations: [], language: "en", issuedAt: "2026-10-01T00:00:00.000Z" });
  return {
    id: "ext-1",
    horse_id: horse.id,
    extract_code: "RX-ABCDE-FGHJK-MNPQR-STUVW",
    language: "en",
    template_version: payload.meta.template_version,
    payload: stableStringify(payload),
    payload_digest: await sha256Hex(stableStringify(payload)),
    issued_at: "2026-10-01T00:00:00.000Z",
    status: "active",
    revoked_at: null,
    revoked_reason: null,
    ...overrides,
  };
}

describe("verifyExtractCore (T06 steps 3-4)", () => {
  it("replays STORED facts even after the registry changed (immutability)", async () => {
    const stored = await storedRowFor(sourceRow);
    const renamedHorse = { ...sourceRow, name_latin: "Shahriar II" };
    const { db } = makeExtractDb(stored, renamedHorse);
    const result = await verifyExtractCore(db, stored.extract_code);
    expect(result.valid).toBe(true);
    expect(result.extract!.payload.horse.name_latin).toBe("Shahriar"); // historical fact
    expect(result.extract!.changed_since_issuance).toBe(true);
    expect(result.extract!.changed_fields).toEqual(["horse.name_latin"]);
  });

  it("flags unchanged data with no change notice", async () => {
    const stored = await storedRowFor(sourceRow);
    const { db } = makeExtractDb(stored, sourceRow);
    const result = await verifyExtractCore(db, stored.extract_code);
    expect(result.extract!.changed_since_issuance).toBe(false);
    expect(result.extract!.changed_fields).toEqual([]);
  });

  it("fails closed on a tampered payload digest", async () => {
    const stored = await storedRowFor(sourceRow, { payload_digest: "0".repeat(64) });
    const { db } = makeExtractDb(stored, sourceRow);
    const result = await verifyExtractCore(db, stored.extract_code);
    expect(result).toEqual({ valid: false, reason: "payload_tampered" });
  });

  it("reports revoked extracts with their reason", async () => {
    const stored = await storedRowFor(sourceRow, { status: "revoked", revoked_at: "2026-10-02T00:00:00.000Z", revoked_reason: "issued in error" });
    const { db } = makeExtractDb(stored, sourceRow);
    const result = await verifyExtractCore(db, stored.extract_code);
    expect(result.valid).toBe(true);
    expect(result.extract!.status).toBe("revoked");
    expect(result.extract!.revoked_reason).toBe("issued in error");
  });

  it("rejects unknown codes gracefully", async () => {
    const { db } = makeExtractDb(null, sourceRow);
    expect(await verifyExtractCore(db, "RX-XXXXX-XXXXX-XXXXX-XXXXX")).toEqual({ valid: false, reason: "unknown_code" });
  });

  it("withdraws public payload access when its horse is archived or private", async () => {
    const stored = await storedRowFor(sourceRow);
    const { db } = makeExtractDb(stored, null); // horse no longer loadable (archived/deleted)
    const result = await verifyExtractCore(db, stored.extract_code);
    expect(result).toEqual({ valid: false, reason: "subject_unavailable" });
  });

  it("each code maps to its own snapshot (old code never shows newer issuance)", async () => {
    const first = await storedRowFor(sourceRow);
    const renamedHorse = { ...sourceRow, name_latin: "Shahriar II" };
    const second = await storedRowFor(renamedHorse, {
      id: "ext-2",
      extract_code: "RX-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ",
      issued_at: "2026-10-03T00:00:00.000Z",
    });
    const verifyFirst = await verifyExtractCore(makeExtractDb(first, renamedHorse).db, first.extract_code);
    const verifySecond = await verifyExtractCore(makeExtractDb(second, renamedHorse).db, second.extract_code);
    expect(verifyFirst.extract!.payload.horse.name_latin).toBe("Shahriar");
    expect(verifySecond.extract!.payload.horse.name_latin).toBe("Shahriar II");
  });
});
