import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canViewPrivateGeneticEvidence,
  projectBreedingRecord,
  projectGeneticTests,
  type PrivacyViewer,
} from "../../src/privacy/projections";
import { normalizePublicHorseRecord } from "../../src/db/publicProjection";
import {
  ADMIN_HORSE_DETAIL_FIELDS,
  PUBLIC_HORSE_FIELDS,
  PUBLIC_HORSE_PROFILE_FIELDS,
  SEARCH_HORSE_FIELDS,
} from "../../src/db/types";

/**
 * R88 agent plan P04: one sentinel-laden fixture, every public output path.
 * Distinctive sentinel strings are planted in EVERY private field class
 * (unpublished genotype, lab accession, staff notes, editorial interpretation,
 * exact location, chip/file/passport identifiers, raw provenance notes), then
 * every anonymous/ordinary public projection is scanned for ALL sentinels at
 * once. A sentinel leaking into any anonymous output fails the matrix.
 *
 * This is the runtime half of the matrix. The source half pins that every
 * public SQL surface is allowlisted (PUBLIC_HORSE_PROFILE_COLUMNS_H /
 * SEARCH_HORSE_FIELDS / projectGeneticTests) — no local field deletion.
 */

const S = {
  preciseAddress: "SENTINEL-PRIVATE-ADDRESS-7QK",
  microchip: "SENTINEL-CHIP-985-MATRIX",
  fileNumber: "SENTINEL-FILE-0042",
  passportNo: "SENTINEL-PASSPORT-9X",
  ueln: "SENTINEL-PRIVATE-UELN-42",
  labNo: "SENTINEL-LAB-31",
  description: "SENTINEL-DESCRIPTION-TEXT",
  birthDateSource: "SENTINEL-BIRTH-SOURCE-NOTE",
  labAccession: "SENTINEL-ACCESSION-LAB-77",
  notes: "SENTINEL-STAFF-NOTE-55",
  interpretation: "SENTINEL-INTERPRETATION-TEXT",
  breedingNotes: "SENTINEL-BREEDING-NOTE-13",
  unpublishedResult: "SENTINEL-UNPUBLISHED-GENOTYPE",
} as const;

const anonymous = null;
const plainViewer: PrivacyViewer = { user: { id: "u-plain", role: "user" } };
const editorViewer: PrivacyViewer = { user: { id: "u-edit", role: "editor" } };
const evidenceViewer: PrivacyViewer = { user: { id: "u-evidence", role: "user" }, geneticScope: { horseId: 1, evidenceRead: true, verifiedHealthRead: false } };

/** The full private row, exactly as privileged storage would hold it. */
const privateHorseRow: Record<string, unknown> = {
  id: 1,
  register_no: "IR-1",
  name_latin: "SENTINEL-FREE-NAME",
  name_native: null,
  father_id: null,
  mother_id: null,
  birth_year: 2015,
  microchip_no: S.microchip,
  file_number: S.fileNumber,
  passport_no: S.passportNo,
  lab_no: S.labNo,
  description: S.description,
  precise_address: S.preciseAddress,
  birth_date_source: S.birthDateSource,
  birth_city: "Sentinelville",
  birth_province: "Sentinelstan",
};

const verifiedGeneticRow = {
  id: 11,
  horse_id: 1,
  test_type: "SCID",
  test_category: "disease",
  result: "N/SCID",
  result_interpretation: S.interpretation,
  lab_name: "Lab Tejarat",
  lab_accession: S.labAccession,
  tested_at: "2026-01-15",
  verified: 1,
  provenance: "user",
  notes: S.notes,
  // R140-A: verified disease rows are private-by-default; this fixture carries
  // the explicit publication decision so anonymous projections see exactly one
  // row (the undisclosed + unverified variants are asserted absent below).
  public_disclosed: 1,
};

const undisclosedDiseaseRow = {
  ...verifiedGeneticRow,
  id: 13,
  public_disclosed: 0,
};

const unpublishedGeneticRow = {
  ...verifiedGeneticRow,
  id: 12,
  result: S.unpublishedResult,
  verified: 0,
};

const breedingRow = {
  id: 21,
  horse_id: 1,
  stallion_id: 2,
  mare_id: 1,
  breeding_date: "2026-02-01",
  notes: S.breedingNotes,
};

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const routesSource = readFileSync(join(root, "src/api/routes.ts"), "utf8");
const marketplaceSource = readFileSync(join(root, "src/api/modules/marketplace.ts"), "utf8");

/** Scan any serialized output for every private sentinel at once. */
function leakedSentinels(output: unknown): string[] {
  const text = JSON.stringify(output);
  return Object.entries(S)
    .filter(([, sentinel]) => typeof sentinel === "string" && text.includes(sentinel))
    .map(([name]) => name);
}

describe("P04 privacy matrix — anonymous and ordinary viewers", () => {
  it("the public horse profile projection leaks no private sentinel", () => {
    // Simulate the real getHorse path: allowlist columns only, then presentation cleanup.
    const projectedRow: Record<string, unknown> = {};
    for (const field of PUBLIC_HORSE_PROFILE_FIELDS) projectedRow[field] = privateHorseRow[field] ?? null;
    const output = normalizePublicHorseRecord(projectedRow);
    // R151: the microchip sentinel is APPROVED public data now; every other
    // sentinel (file no, passport no, lab no, description, address, source
    // note) must stay absent.
    const leaks = leakedSentinels(output).filter((name) => name !== "microchip");
    expect(leaks).toEqual([]);
    expect(output.microchip_no).toBe(S.microchip);
  });

  it("the search/browse projection shares the public allowlist (no private columns)", () => {
    expect([...SEARCH_HORSE_FIELDS]).toEqual([...PUBLIC_HORSE_FIELDS]);
    const projectedRow: Record<string, unknown> = {};
    for (const field of SEARCH_HORSE_FIELDS) projectedRow[field] = privateHorseRow[field] ?? null;
    // R151: microchip is the one approved identifier sentinel here.
    const leaks = leakedSentinels(projectedRow).filter((name) => name !== "microchip");
    expect(leaks).toEqual([]);
  });

  it("genetics projection for anonymous and plain viewers: no sentinels, unpublished and undisclosed tests entirely absent", () => {
    for (const viewer of [anonymous, plainViewer, editorViewer]) {
      const output = projectGeneticTests([verifiedGeneticRow, unpublishedGeneticRow, undisclosedDiseaseRow], viewer);
      expect(leakedSentinels(output)).toEqual([]);
      // R140-A: only the disclosed verified row crosses; unverified (12) and
      // undisclosed-disease (13) rows are dropped for public viewers.
      expect(output.map((row) => row.id)).toEqual([11]);
    }
  });

  it("breeding projection nulls private notes for ordinary viewers", () => {
    const output = projectBreedingRecord({ ...breedingRow }, plainViewer);
    expect(leakedSentinels(output)).toEqual([]);
  });

  it("exact-horse evidence viewers see private evidence while editorial roles stay public", () => {
    expect(canViewPrivateGeneticEvidence(editorViewer,1)).toBe(false);
    expect(canViewPrivateGeneticEvidence(evidenceViewer,1)).toBe(true);
    const output = projectGeneticTests([verifiedGeneticRow, unpublishedGeneticRow, undisclosedDiseaseRow], evidenceViewer);
    const leaks = leakedSentinels(output);
    expect(leaks).toContain("labAccession");
    expect(leaks).toContain("notes");
    expect(leaks).toContain("interpretation");
    expect(leaks).toContain("unpublishedResult");
  });
});

describe("P04 privacy matrix — source-level allowlist wiring", () => {
  it("public column lists exclude every private field class", () => {
    // R151 owner directive: microchip_no is an approved public column now
    // (heritage browse ships it hidden by default); the other private field
    // classes stay excluded.
    for (const list of [PUBLIC_HORSE_FIELDS, PUBLIC_HORSE_PROFILE_FIELDS, SEARCH_HORSE_FIELDS]) {
      expect(list).toContain("microchip_no");
      expect(list).not.toContain("precise_address");
      expect(list).not.toContain("birth_date_source");
      expect(list).not.toContain("file_number");
      expect(list).not.toContain("passport_no");
      expect(list).not.toContain("lab_no");
      expect(list).not.toContain("description");
      expect(list).not.toContain("data_origin");
    }
  });

  it("the admin detail allowlist is the only list carrying the private fields", () => {
    expect(ADMIN_HORSE_DETAIL_FIELDS).toContain("precise_address");
    expect(ADMIN_HORSE_DETAIL_FIELDS).toContain("birth_date_source");
    expect(ADMIN_HORSE_DETAIL_FIELDS).toContain("microchip_no");
    expect(ADMIN_HORSE_DETAIL_FIELDS).toContain("data_origin");
  });

  it("getHorse selects through the public allowlist constant (no local field lists)", () => {
    expect(routesSource).toContain("SELECT ${PUBLIC_HORSE_PROFILE_COLUMNS_H.replace(");
    expect(routesSource).toContain('"h.father_id", "f.id AS father_id"');
    expect(routesSource).toContain('"h.mother_id", "m.id AS mother_id"');
  });

  it("marketplace genetics go through the shared projection, not a local SELECT dump (R88 FIX-01 stays wired)", () => {
    expect(marketplaceSource).toContain("readHorseGenetics(db, horseId, auth, 30)");
    const readsSource = readFileSync(join(root,"src/privacy/geneticReads.ts"),"utf8");
    expect(readsSource).toContain("projectGeneticTest(row, resolved)");
    expect(readsSource).toContain("geneticActionPredicate");
    expect(readsSource).toContain("CASE WHEN s.can_evidence=1 THEN g.lab_accession ELSE NULL END");
  });
});

// ---------------------------------------------------------------------------
// P04 extension (R91): exports/extracts, AI tool responses, inquiry contact
// fields, and cache variants — the four surfaces the runtime matrix had not
// yet covered.
// ---------------------------------------------------------------------------

import { buildExtractSnapshot, type ExtractSourceRow } from "../../src/trust/extracts";
import { executeInquiryCreate, executeInquiryStatus } from "../../src/marketplace/commands";

const extractsSource = readFileSync(join(root, "src/trust/extracts.ts"), "utf8");
const brokerSource = readFileSync(join(root, "src/ai/domain/horseRegistry/broker.ts"), "utf8");
const httpSource = readFileSync(join(root, "src/api/http.ts"), "utf8");

const extractRow: ExtractSourceRow = {
  id: 1,
  register_no: "IR-1",
  ueln_no: null,
  name_latin: "SENTINEL-FREE-NAME",
  name_native: null,
  breed_desc: "Arabian",
  sex_desc: "stallion",
  color_desc: "grey",
  birth_year: 2015,
  birth_place_desc: "Sentinelville",
  main_strain_desc: null,
  sub_strain_desc: null,
  sire_id: null,
  sire_latin: null,
  sire_native: null,
  dam_id: null,
  dam_latin: null,
  dam_native: null,
  breeder: "Breeder One",
  owner: "Owner One",
};

describe("P04 privacy matrix — exports and registry extracts", () => {
  it("the extract snapshot SELECT reads only the public column allowlist", () => {
    const match = extractsSource.match(/SELECT h\.id,h\.register_no[\s\S]*?FROM horses h/);
    expect(match).toBeTruthy();
    for (const forbidden of ["microchip_no", "file_number", "passport_no", "lab_no", "precise_address", "description", "birth_date_source", "notes"]) {
      expect(match?.[0], forbidden).not.toContain(forbidden);
    }
  });

  it("buildExtractSnapshot is a whitelist builder: extra private fields on the input row are ignored", () => {
    const tainted = { ...extractRow, ueln_no: S.ueln, microchip_no: S.microchip, precise_address: S.preciseAddress, lab_no: S.labNo } as ExtractSourceRow & Record<string, unknown>;
    const payload = buildExtractSnapshot({ horse: tainted, attestations: [], language: "en", issuedAt: "2026-10-03T12:00:00.000Z" });
    const serialized = JSON.stringify(payload);
    for (const sentinel of [S.ueln, S.microchip, S.preciseAddress, S.labNo, S.fileNumber, S.passportNo]) {
      expect(serialized, sentinel).not.toContain(sentinel);
    }
    // The horse section carries exactly the public extract fields — nothing else.
    expect(Object.keys(payload.horse).sort()).toEqual([
      "id", "register_no", "name_latin", "name_native", "breed_desc",
      "sex_desc", "color_desc", "birth_year", "birth_place_desc", "main_strain_desc", "sub_strain_desc",
    ].sort());
  });

  it("attestations embedded in an extract carry no lab accession or notes sentinels", () => {
    const payload = buildExtractSnapshot({
      horse: extractRow,
      attestations: [{ record_kind: "breed", field_scope: "breed", issued_at: "2026-01-01", expires_at: null, status: "active", issuer_slug: "demo", issuer_name: "Demo", lab_accession: S.labAccession, notes: S.notes }],
      language: "en",
      issuedAt: "2026-10-03T12:00:00.000Z",
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(S.labAccession);
    expect(serialized).not.toContain(S.notes);
  });
});

describe("P04 privacy matrix — AI assistant tool responses", () => {
  it("the horse-search AI tool selects through the shared public allowlist constant", () => {
    expect(brokerSource).toContain("PUBLIC_HORSE_COLUMNS_H");
    expect(brokerSource).toContain("SELECT ${PUBLIC_HORSE_COLUMNS_H}");
    // No AI tool statement reads a private field class directly.
    for (const forbidden of ["microchip_no", "file_number", "passport_no", "precise_address", "birth_date_source", "lab_accession", "data_origin"]) {
      expect(brokerSource, forbidden).not.toContain(`h.${forbidden}`);
      expect(brokerSource, forbidden).not.toContain(`p.${forbidden}`);
    }
  });

  it("the public AI runtime registers read-only tools only (mutation tools are refused)", () => {
    expect(brokerSource).not.toMatch(/schemaTool\([^)]*"mutation/s);
    const registryTest = readFileSync(join(root, "src/ai/tools/registry.ts"), "utf8");
    expect(registryTest).toContain("Public AI runtime refused mutation tool");
  });
});

// ---------------------------------------------------------------------------
// Inquiry contact fields: buyers submit a contact string; it may surface ONLY
// to the authorized seller inbox. Command responses and public endpoints must
// never echo it.
// ---------------------------------------------------------------------------

const BUYER_CONTACT_SENTINEL = "SENTINEL-BUYER-CONTACT-CHANNEL";

function inquiryDb() {
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  interface Builder {
    sql: string;
    args: unknown[];
    bind: (...nextArgs: unknown[]) => Builder;
    first: () => Promise<unknown>;
    all: () => Promise<{ results: unknown[] }>;
    run: () => Promise<{ meta: { changes: number } }>;
  }
  const makeBuilder = (sql: string, args: unknown[]): Builder => ({
    sql,
    args,
    bind: (...nextArgs: unknown[]) => makeBuilder(sql, nextArgs),
    first: async () => (sql.includes("FROM command_receipts") ? null : { id: "inquiry-1", row_version: 1, status: "new" }),
    all: async () => ({ results: [] }),
    run: async () => { writes.push({ sql, args }); return { meta: { changes: 1 } }; },
  });
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      for (const statement of statements) writes.push({ sql: statement.sql, args: statement.args });
      return statements.map(() => ({ results: [], success: true, meta: { changes: 1 } }));
    },
  };
  return Object.assign(db as unknown as D1Database, { __writes: writes });
}

describe("P04 privacy matrix — inquiry contact fields", () => {
  it("the inquiry-create command response never echoes the buyer contact", async () => {
    const db = inquiryDb();
    const outcome = await executeInquiryCreate(db, {
      inquiryId: "inquiry-9",
      listingId: "listing-1",
      buyerUserId: null,
      buyerName: "BUYER",
      buyerContact: BUYER_CONTACT_SENTINEL,
      message: null,
    }, null);
    expect(outcome.statusCode).toBe(201);
    expect(JSON.stringify(outcome.body)).not.toContain(BUYER_CONTACT_SENTINEL);
    // The contact IS persisted (the seller inbox needs it) — in the write binds only.
    expect(JSON.stringify(db.__writes)).toContain(BUYER_CONTACT_SENTINEL);
  });

  it("the inquiry-status command response carries no contact fields", async () => {
    const db = inquiryDb();
    const outcome = await executeInquiryStatus(db, { user: { id: "seller" } }, {
      inquiryId: "inquiry-1",
      expectedVersion: 1,
      currentStatus: "new",
      nextStatus: "contacted",
      isStaff: false,
      now: new Date("2026-10-03T12:00:00.000Z"),
    }, null);
    expect(JSON.stringify(outcome.body)).not.toContain(BUYER_CONTACT_SENTINEL);
    expect(JSON.stringify(outcome.body)).not.toContain("buyer_contact");
    expect(JSON.stringify(outcome.body)).not.toContain("buyer_name");
  });

  it("buyer_contact appears in the marketplace module only in the input schema, the create binds and the authorized seller inbox", () => {
    const lines = marketplaceSource.split("\n");
    const hits = lines.map((line, index) => ({ line: line.trim(), index })).filter((entry) => entry.line.includes("buyer_contact"));
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      const allowed =
        hit.line.startsWith("buyer_contact:") // InquirySchema input validation + conversation response typing
        || hit.line.includes("buyerContact") // bind plumbing
        || hit.line.includes("i.buyer_contact") // the seller-inbox/conversation SELECTs (participant/staff-dispute gated)
        || (hit.line.includes(".first<{") && hit.line.includes("buyer_contact: string")) // R98-N12: the conversation row READER type (the value is participant-gated before serialization)
        || hit.line.startsWith("*");
      expect(allowed, `unexpected buyer_contact use: ${hit.line}`).toBe(true);
    }
  });
});

describe("P04 privacy matrix — cache variants", () => {
  it("every API JSON response defaults to private no-store + no-referrer unless explicitly overridden", () => {
    // R96-N07: `private` added — shared/proxy caches are refused alongside
    // no-store, and the referrer never carries the API URL to third parties.
    expect(httpSource).toContain('if (!headers.has("cache-control")) headers.set("cache-control", "private, no-store")');
    expect(httpSource).toContain('if (!headers.has("referrer-policy")) headers.set("referrer-policy", "no-referrer")');
  });

  it("aggregate responses and private media refuse persistent caching", () => {
    const snapshotPolicy = routesSource.slice(routesSource.indexOf("function publicSnapshotResponseInit("), routesSource.indexOf("function meaningfulSourceTextSql("));
    expect(snapshotPolicy).toContain('"cache-control": "private, no-store"');
    expect(snapshotPolicy).not.toContain("s-maxage");
    // The media module (private documents) explicitly refuses public caching.
    const mediaSource = readFileSync(join(root, "src/api/modules/media.ts"), "utf8");
    expect(mediaSource).toContain('"private, no-store"');
    expect(mediaSource).not.toContain('"public');
  });

  it("the public media proxy caches only allowlisted external images, never registry data", () => {
    const proxySource = readFileSync(join(root, "src/api/mediaProxy.ts"), "utf8");
    expect(proxySource).toContain("public, max-age=");
    // Host validation + per-hop re-validation come from the shared contracts
    // module; the proxy itself carries no registry data into cached responses.
    expect(proxySource).toContain("parseProxyableImageUrl");
    expect(proxySource).toContain("media_proxy_redirect_off_allowlist");
  });
});
