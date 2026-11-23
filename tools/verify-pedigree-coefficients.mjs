import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(new URL("..", import.meta.url).pathname);
const out = mkdtempSync(join(tmpdir(), "horse-pedigree-reference-"));
const tsc = process.platform === "win32" ? "tsc.cmd" : "tsc";

function horse(id, father_id = null, mother_id = null) {
  return {
    id,
    name_latin: `Horse ${id}`,
    name_native: null,
    father_id,
    mother_id,
    birth_year: null,
    breed_desc: null,
    sex_desc: null,
    color_desc: null,
    main_strain_desc: null,
  };
}

function assertClose(name, actual, expected, tolerance = 1e-10) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${name}: expected ${expected}, received ${actual}`);
  }
  console.log(`${name}: ${actual} (expected ${expected}) PASS`);
}

try {
  writeFileSync(join(out, "package.json"), '{"type":"commonjs"}\n');
  execFileSync(tsc, [
    "--target", "ES2022",
    "--module", "CommonJS",
    "--moduleResolution", "Node",
    "--outDir", out,
    "--skipLibCheck",
    "tests/types/d1-stub.d.ts",
    "src/db/types.ts",
    "src/pedigree/engine.ts",
    "src/pedigree/coefficients.ts",
  ], { cwd: root, stdio: "inherit" });

  const require = createRequire(import.meta.url);
  const { buildRelationshipMatrix } = require(join(out, "pedigree", "coefficients.js"));
  const coefficient = (matrix, left, right) => {
    const i = matrix.indexById.get(left);
    const j = matrix.indexById.get(right);
    if (i === undefined || j === undefined) throw new Error("fixture horse missing from relationship matrix");
    return matrix.values[i * matrix.ids.length + j];
  };
  const matrix = (rows) => buildRelationshipMatrix(new Map(rows.map((row) => [row.id, row])));

  // Unrelated founders -> zero relationship.
  let m = matrix([horse(1), horse(2)]);
  assertClose("unrelated founders", coefficient(m, 1, 2), 0);

  // Full siblings from unrelated founders have A_ij=0.5; their offspring has F=0.25.
  m = matrix([horse(2), horse(3), horse(4, 2, 3), horse(5, 2, 3), horse(6, 4, 5)]);
  assertClose("full-sibling additive relationship", coefficient(m, 4, 5), 0.5);
  assertClose("full-sibling mating offspring COI", coefficient(m, 6, 6) - 1, 0.25);

  // Half siblings share one unrelated founder parent; A_ij=0.25 and offspring F=0.125.
  m = matrix([horse(2), horse(3), horse(7), horse(4, 2, 3), horse(5, 2, 7), horse(6, 4, 5)]);
  assertClose("half-sibling additive relationship", coefficient(m, 4, 5), 0.25);
  assertClose("half-sibling mating offspring COI", coefficient(m, 6, 6) - 1, 0.125);

  // ---------------------------------------------------------------
  // R88 agent plan P07: extended reference families — parent-offspring,
  // repeated ancestors, inbred common ancestor, missing parents / founder
  // assumption, cycles and depth truncation. These use the FULL metric
  // path (calculatePedigreeCoefficientFromGraph) so completeness, integrity
  // flags, founder assumptions and statuses are pinned alongside the numbers.
  // ---------------------------------------------------------------
  const { calculatePedigreeCoefficientFromGraph } = require(join(out, "pedigree", "coefficients.js"));
  const graph = (rows, rootId, depth, extras = {}) => ({
    rootId,
    depth,
    horses: new Map(rows.map((row) => [row.id, row])),
    missingParentIds: new Set(extras.missing ?? []),
    unloadedParentIds: new Set(),
    cycleNodeIds: new Set(extras.cycles ?? []),
    truncated: Boolean(extras.truncated),
  });
  const coi = (rows, rootId, depth, extras) => calculatePedigreeCoefficientFromGraph(graph(rows, rootId, depth, extras));

  // Parent-offspring: founder 1 x founder 2 -> child 3. A(1,3)=0.5; kinship
  // (what a parent x offspring mating implies for the foal) = 0.25.
  m = matrix([horse(1), horse(2), horse(3, 1, 2)]);
  assertClose("parent-offspring additive relationship", coefficient(m, 1, 3), 0.5);
  assertClose("parent-offspring mating offspring COI (kinship = A/2)", coefficient(m, 1, 3) / 2, 0.25);

  // Repeated ancestor: sire 4 and dam 5 share founder 1 as their father ->
  // founder 1 is the paternal AND maternal grandsire of offspring 6.
  // F6 = (1/2)^(1+1+1) = 0.125.
  m = matrix([horse(1), horse(2), horse(3), horse(4, 1, 2), horse(5, 1, 3), horse(6, 4, 5)]);
  assertClose("repeated-grandsire offspring COI", coefficient(m, 6, 6) - 1, 0.125);
  let metrics = coi([horse(1), horse(2), horse(3), horse(4, 1, 2), horse(5, 1, 3), horse(6, 4, 5)], 6, 2);
  assertClose("repeated-grandsire metrics COI", metrics.inbreedingCoefficient, 0.125);
  if (metrics.status !== "ok" || metrics.pedigreeCompletenessPercent !== 100) throw new Error(`repeated-grandsire status/completeness: ${metrics.status}/${metrics.pedigreeCompletenessPercent}`);
  console.log("repeated-grandsire metrics: status=ok completeness=100% PASS");

  // Inbred common ancestor: 4 and 5 are full siblings (F=0.25 offspring 6);
  // 6 is the shared grandsire of 7 and 8; offspring 9 has
  // F = (1/2)^(1+1+1) * (1 + F6) = 0.125 * 1.25 = 0.15625.
  const inbredRows = [
    horse(1), horse(2), horse(3), horse(4, 1, 2), horse(5, 1, 2), horse(6, 4, 5),
    horse(10), horse(11), horse(7, 6, 10), horse(8, 6, 11), horse(9, 7, 8),
  ];
  m = matrix(inbredRows);
  assertClose("inbred-common-ancestor offspring COI", coefficient(m, 9, 9) - 1, 0.15625);
  metrics = coi(inbredRows, 9, 3);
  assertClose("inbred-common-ancestor metrics COI", metrics.inbreedingCoefficient, 0.15625);

  // Missing parents / founder assumption: with the grandparents unloaded, the
  // same repeated-grandsire pedigree reports F=0 under the documented founder
  // assumption — and HONESTLY reports reduced completeness. A missing
  // ancestor can never increase displayed certainty.
  metrics = coi([horse(4), horse(5), horse(6, 4, 5)], 6, 2);
  assertClose("missing-grandparents COI is zero (founder assumption)", metrics.inbreedingCoefficient, 0);
  if (metrics.pedigreeCompletenessPercent >= 100) throw new Error("missing grandparents must reduce completeness");
  if (metrics.assumedFounderNodes !== 2) throw new Error(`the two parentless parents are the assumed founders, got ${metrics.assumedFounderNodes}`);
  console.log(`missing-grandparents: F=0 with completeness ${metrics.pedigreeCompletenessPercent}% and ${metrics.assumedFounderNodes} assumed founders PASS`);
  if (!metrics.zeroWithinIncompleteAncestry) throw new Error("zero COI with incomplete ancestry must carry the honest P07 label flag");
  // ...and a fully-known zero must NOT carry it (no false hedging either).
  metrics = coi([horse(1), horse(2), horse(3, 1, 2)], 3, 1);
  if (metrics.zeroWithinIncompleteAncestry) throw new Error("complete-ancestry zero must not be hedged");
  console.log("P07 zero-labeling: incomplete-ancestry zero flagged, complete-ancestry zero not flagged PASS");

  // A referenced-but-unloaded parent is a boundary reference, still founder-assumed.
  // 4 references parents 1,2 and 5 references 1,3 — none of 1,2,3 are loaded:
  // four dangling references, all founder-assumed at the boundary.
  metrics = coi([horse(4, 1, 2), horse(5, 1, 3), horse(6, 4, 5)], 6, 2, { missing: [1, 2, 3] });
  if (metrics.boundaryParentReferences < 2) throw new Error(`expected boundary parent references, got ${metrics.boundaryParentReferences}`);
  console.log(`boundary-parent references: ${metrics.boundaryParentReferences} PASS`);

  // Cycle: a corrupt graph never hangs and never produces a number —
  // status=cycle_detected, coefficient=null, bounded output.
  metrics = coi([horse(1, 2, null), horse(2, 1, null)], 1, 4, { cycles: [1, 2] });
  if (metrics.status !== "cycle_detected" || metrics.inbreedingCoefficient !== null) {
    throw new Error(`cyclic graph must be cycle_detected/null, got ${metrics.status}/${metrics.inbreedingCoefficient}`);
  }
  console.log("cyclic graph: status=cycle_detected, coefficient=null (bounded, no hang) PASS");

  // Depth truncation, honest form: the same pedigree at depth 1 (parents
  // loaded, their shared parentage NOT) yields F=0 — the number is only valid
  // for the stated depth (metrics.depth=1), and the two parents are honestly
  // reported as assumed founders rather than as proven unrelated.
  metrics = coi([horse(4), horse(5), horse(6, 4, 5)], 6, 1);
  assertClose("depth-1 truncated COI", metrics.inbreedingCoefficient, 0);
  if (metrics.depth !== 1) throw new Error(`depth must be stated in the metrics, got ${metrics.depth}`);
  if (metrics.assumedFounderNodes !== 2) throw new Error(`depth-1 parents must be reported as assumed founders, got ${metrics.assumedFounderNodes}`);
  if (metrics.pedigreeCompletenessPercent !== 100) throw new Error(`depth-1 view is complete FOR ITS DEPTH, got ${metrics.pedigreeCompletenessPercent}%`);
  console.log("depth-1 truncation: F=0, depth=1 stated, parents=assumed founders (100% complete for its depth) PASS");

  // Node-cap truncation (wide pedigree beyond the matrix limit): status
  // 'truncated' with a NULL coefficient — a bounded partial-evidence state,
  // never a fabricated number and never a hang.
  const wide = [];
  for (let id = 1; id <= 1200; id += 1) wide.push(horse(id, id + 1200, id + 2400)); // all dangling -> founders, cap exceeded by count
  metrics = coi(wide, 1, 8, { truncated: true });
  if (metrics.status !== "truncated" || metrics.inbreedingCoefficient !== null) {
    throw new Error(`node-cap graph must be truncated/null, got ${metrics.status}/${metrics.inbreedingCoefficient}`);
  }
  console.log("node-cap truncation: status=truncated, coefficient=null (bounded) PASS");

  console.log("Pedigree coefficient reference fixtures passed.");
} finally {
  rmSync(out, { recursive: true, force: true });
}
