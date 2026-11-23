import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceRuntime } from "./r88-test-runtime.mjs";
const runtime = sourceRuntime();
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
try {
  const { timestampMillis, isExpiredTimestamp } = runtime.load("src/security/timestamps.ts");
  const { framePolicyForPath } = runtime.load("src/security/framePolicy.ts");
  const { requireSameOriginMutation } = runtime.load("src/security/origin.ts");
  const { assertListingTransition, assertInquiryTransition, isActiveListingConflict } = runtime.load("src/marketplace/policy.ts");
  const { grantValidity, activeGrantActions, horseIdsWithAction } = runtime.load("src/access/horseAccess.ts");
  const { projectGeneticTests } = runtime.load("src/privacy/projections.ts");
  const now = Date.parse("2026-10-03T12:00:00Z");
  await test("SQL timestamps are UTC, not machine-local", () => assert.equal(timestampMillis("2026-10-03 12:00:00"), now));
  await test("ISO offset represents the same instant", () => assert.equal(timestampMillis("2026-10-03T15:30:00+03:30"), now));
  for (const value of ["", "garbage", "2026-02-30T00:00:00Z", "2026-13-01 00:00:00", "2026-10-03T25:00:00Z", "2026-10-03T12:00:00+25:00"])
    await test(`malformed timestamp fails closed: ${value}`, () => { assert.equal(timestampMillis(value), null); assert.equal(isExpiredTimestamp(value, now), true); });
  await test("expiry is exclusive and null is unbounded", () => { assert.equal(isExpiredTimestamp("2026-10-03T12:00:00Z", now), true); assert.equal(isExpiredTimestamp(null, now), false); });
  for (const route of ["/", "/api/auth/me", "/classic-registry-evil/", "/f/classic-registry", "/evil/classic-registry/"])
    await test(`frame denied on ${route}`, () => assert.deepEqual(framePolicyForPath(route), { xFrameOptions: "DENY", frameAncestors: "'none'" }));
  for (const route of ["/classic-registry", "/classic-registry/", "/classic-registry/index.html"])
    await test(`Classic same-origin frame allowed on ${route}`, () => assert.deepEqual(framePolicyForPath(route), { xFrameOptions: "SAMEORIGIN", frameAncestors: "'self'" }));
  await test("cross-origin public mutation rejected", () => assert.throws(() => requireSameOriginMutation(new Request("https://horse.example/api/x", { method: "POST", headers: { origin: "https://evil.example" } })), /Cross-origin/));
  await test("same-origin public mutation accepted", () => requireSameOriginMutation(new Request("https://horse.example/api/x", { method: "POST", headers: { origin: "https://horse.example" } })));
  await test("fetch metadata rejects cross-site without Origin", () => assert.throws(() => requireSameOriginMutation(new Request("https://horse.example/api/x", { method: "POST", headers: { "sec-fetch-site": "cross-site" } })), /Cross-origin/));
  await test("valid listing transitions", () => { assertListingTransition("draft", "active", null, now); assertListingTransition("active", "pending_sale", null, now); assertListingTransition("pending_sale", "sold", null, now); });
  await test("sold listing is terminal", () => assert.throws(() => assertListingTransition("sold", "active", null, now), /cannot move/));
  await test("expired listing cannot publish", () => assert.throws(() => assertListingTransition("draft", "active", "2026-10-02 12:00:00", now), /expired/));
  await test("malformed expiry cannot publish", () => assert.throws(() => assertListingTransition("draft", "active", "invalid", now), /expired/));
  await test("active unique conflict detection is narrow", () => { assert.equal(isActiveListingConflict(new Error("UNIQUE constraint failed: sales_listings.horse_id")), true); assert.equal(isActiveListingConflict({ constraint: "uq_sales_listings_active_horse" }), true); assert.equal(isActiveListingConflict(new Error("connection lost")), false); });
  await test("inquiry workflow is terminal and validates current state", () => { assertInquiryTransition("new", "contacted"); assertInquiryTransition("contacted", "closed"); assert.throws(() => assertInquiryTransition("closed", "new")); assert.throws(() => assertInquiryTransition("bogus", "new")); });
  const grant = { horse_id: 7, grantee_user_id: "owner", relationship: "owner", actions: "manage_inquiries,create_listing", revoked_at: null, valid_from: "2026-01-01 00:00:00", valid_until: null };
  await test("well-formed grant remains valid", () => assert.equal(grantValidity(grant, new Date(now)), "active"));
  await test("malformed grant dates cannot authorize", () => { for (const g of [{ ...grant, valid_from: "bad" }, { ...grant, valid_until: "bad" }, { ...grant, valid_until: "2025-01-01 00:00:00" }]) { assert.equal(grantValidity(g, new Date(now)), "invalid"); assert.deepEqual(activeGrantActions([g], new Date(now)), []); } });
  await test("revocation takes immediate precedence", () => assert.equal(grantValidity({ ...grant, revoked_at: "2026-01-02 00:00:00" }, new Date(now)), "revoked"));
  await test("bulk inbox authorization strips revoked and unrelated horses", async () => {
    const rows = [grant, { ...grant, horse_id: 8, revoked_at: "2026-10-01 00:00:00" }, { ...grant, horse_id: 9, grantee_user_id: "other" }, { ...grant, horse_id: 999 }];
    let statements = 0;
    const db = { prepare(sql) { assert.match(sql, /IN \(\?,\?,\?\)/); return { bind() { return {}; } }; }, async batch(items) { statements += items.length; return [{ results: rows }]; } };
    assert.deepEqual([...await horseIdsWithAction(db, { userId: "owner", role: "owner" }, [7, 8, 9], "manage_inquiries", new Date(now))], [7]);
    assert.equal(statements, 1);
  });
  const genetic = { id: 1, horse_id: 7, test_type: "SCID", test_category: "disease", result: "N/SCID", result_interpretation: "private", lab_name: "DEMO LAB", lab_accession: "secret", tested_at: "2026-01-01", verified: 0, provenance: "user", notes: "secret" };
  await test("market genetics hides unpublished results from public and owners", () => { assert.deepEqual(projectGeneticTests([genetic], null), []); assert.deepEqual(projectGeneticTests([genetic], { user: { id: "owner", role: "owner" } }), []); });
  await test("published genetics strips private fields", () => { const [row] = projectGeneticTests([{ ...genetic, verified: 1, public_disclosed: 1 }], null); assert.equal(row.notes, null); assert.equal(row.lab_accession, null); assert.equal(row.result_status, "carrier"); });
  await test("an editor role alone never grants private evidence", () => assert.deepEqual(projectGeneticTests([genetic], { user: { id: "staff", role: "editor" } }), []));
  await test("exact resolved horse scope retains private evidence", () => assert.equal(projectGeneticTests([genetic], { user: { id: "reviewer", role: "user" }, geneticScope: { horseId: 7, evidenceRead: true, verifiedHealthRead: false } })[0].lab_accession, "secret"));
  const source = readFileSync("src/api/modules/marketplace.ts", "utf8");
  await test("actual marketplace uses shared genetics projection", () => assert.match(source, /readHorseGenetics\(db, horseId, auth, 30\)/));
  await test("actual marketplace delegates to the command with availability in INSERT", () => {
    assert.match(source, /executeInquiryCreate\(env\.DB/);
    assert.match(readFileSync("src/marketplace/commands.ts", "utf8"), /INSERT INTO sales_inquiries[\s\S]*?SELECT \?,l\.id[\s\S]*?expires_at/);
  });
  await test("actual inquiry path requires authenticated CSRF", () => { assert.match(source, /if \(auth\) requireCsrf\(request, auth\)/); assert.doesNotMatch(source, /catch \{ \/\* public form/); });
  const { calculatePedigreeCoefficientFromGraph } = runtime.load("src/pedigree/coefficients.ts");
  const h = (id, father_id = null, mother_id = null) => ({ id, father_id, mother_id, name_latin: `DEMO ${id}`, name_native: null, birth_year: null, breed_desc: null, sex_desc: null, color_desc: null, main_strain_desc: null });
  const graph = (rows, extra = {}) => ({ rootId: rows[0].id, depth: 4, horses: new Map(rows.map((r) => [r.id, r])), missingParentIds: new Set(), unloadedParentIds: new Set(), cycleNodeIds: new Set(), truncated: false, ...extra });
  await test("pedigree full-sibling mating gives 25 percent under founder assumptions", () => assert.equal(calculatePedigreeCoefficientFromGraph(graph([h(1, 2, 3), h(2, 4, 5), h(3, 4, 5), h(4), h(5)])).inbreedingCoefficient, 0.25));
  await test("pedigree half-sibling mating gives 12.5 percent", () => assert.equal(calculatePedigreeCoefficientFromGraph(graph([h(1, 2, 3), h(2, 4, 5), h(3, 4, 6), h(4), h(5), h(6)])).inbreedingCoefficient, 0.125));
  await test("truncation suppresses a misleading zero COI", () => assert.equal(calculatePedigreeCoefficientFromGraph(graph([h(1)], { truncated: true })).inbreedingCoefficient, null));
  await test("cycles suppress scientific coefficients", () => assert.equal(calculatePedigreeCoefficientFromGraph(graph([h(1, 2), h(2, 1)], { cycleNodeIds: new Set([1, 2]) })).inbreedingCoefficient, null));
  console.log(`\n${passed} R88 checks passed. Runtime/policy + source-boundary checks; not the full Vitest suite or provider integration.`);
} finally { runtime.cleanup(); }
