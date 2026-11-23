#!/usr/bin/env node
/** R117-20 action 4 — extract cohesive route-handler families from src/api/routes.ts.
 * Moves: claims family + change-requests family + shared mutation/audit helpers
 * into src/api/modules/{claims,changeRequests,registryShared}.ts.
 * The routeApi dispatcher and EVERY dispatch line stay in routes.ts (unchanged
 * endpoints, unchanged order, unchanged middleware) per the Master AI audit note.
 * Import headers are derived automatically from routes.ts's own imports.
 * Run once; the result is reviewed via git diff + typecheck + full gates.
 */
import { readFileSync, writeFileSync } from "node:fs";

const ROUTES = "src/api/routes.ts";
const text = readFileSync(ROUTES, "utf8");
const lines = text.split("\n"); // 0-indexed; spans below are 1-indexed inclusive

const span = (a, b) => lines.slice(a - 1, b).join("\n");

// 1-indexed inclusive ranges (verified against the working tree):
const SPANS = {
  schemasSql: [108, 179],      // ClaimCreateSchema .. CHANGE_DECISION_AFTER_UPDATE_SQL (+ trailing blank)
  claims: [1353, 1569],        // createClaim .. reviewClaim end
  changeRequests: [1570, 2088],// createChangeRequest .. normalizeChangeRequestRow end
  parseJson: [2089, 2104],     // parseJsonObject + parseJsonArray
  shared: [2815, 2905],        // assertNoLiveHorseDuplicates doc comment .. audit end
};

const schemasSql = span(...SPANS.schemasSql);
const claimsCode = span(...SPANS.claims);
const crCode = span(...SPANS.changeRequests);
const parseJsonCode = span(...SPANS.parseJson);
const sharedCode = span(...SPANS.shared);

// ---- Split the schema/SQL block into claims-owned vs CR-owned ----
const schemaLines = schemasSql.split("\n");
const claimSchemaStart = schemaLines.findIndex((l) => l.startsWith("const ClaimCreateSchema"));
const crSchemaStart = schemaLines.findIndex((l) => l.startsWith("const ChangeRequestCreateSchema"));
const claimSqlStart = schemaLines.findIndex((l) => l.startsWith("const CLAIM_DECISION_SQL"));
const changeSqlStart = schemaLines.findIndex((l) => l.startsWith("const CHANGE_DECISION_CAS_SQL"));
if (claimSchemaStart < 0 || crSchemaStart < 0 || claimSqlStart < 0 || changeSqlStart < 0) throw new Error("schema split anchors not found");
// Layout order: claim schemas | CR schemas | CLAIM_* SQL | CHANGE_* SQL
const claimSchemas = schemaLines.slice(claimSchemaStart, crSchemaStart).join("\n");
const crSchemas = schemaLines.slice(crSchemaStart, claimSqlStart).join("\n");
const claimSql = schemaLines.slice(claimSqlStart, changeSqlStart).join("\n");
const crSql = schemaLines.slice(changeSqlStart).join("\n");

// ---- Build the import map from routes.ts's own imports ----
const importMap = new Map(); // name -> { source, clause }  (clause: "import" | "import type")
for (const m of text.matchAll(/^import\s+(type\s+)?\{([\s\S]+?)\}\s+from\s+"([^"]+)";/gm)) {
  const isType = Boolean(m[1]);
  for (const raw of m[2].split(",").map((s) => s.trim()).filter(Boolean)) {
    const clean = raw.replace(/^type\s+/, "");
    // Support `Original as Alias` — the code references the ALIAS.
    const aliasMatch = clean.match(/^(\S+)\s+as\s+(\S+)$/);
    const key = aliasMatch ? aliasMatch[2] : clean;
    if (importMap.has(key)) continue; // first import wins (re-exports unlikely)
    importMap.set(key, { source: m[3], isType: isType || raw.startsWith("type "), nameText: clean });
  }
}
for (const m of text.matchAll(/^import\s+(\w+)\s+from\s+"([^"]+)";/gm)) importMap.set(m[1], { source: m[2], isType: false, nameText: m[1] });

// ---- Helpers to derive a module's import header ----
function usedImports(code, extraExports = new Set()) {
  const bySource = new Map();
  for (const [name, info] of importMap) {
    if (extraExports.has(name)) continue;
    if (new RegExp(`\\b${name}\\b`).test(code)) {
      if (!bySource.has(info.source)) bySource.set(info.source, []);
      bySource.get(info.source).push(info.isType ? `type ${info.nameText}` : info.nameText);
    }
  }
  const out = [];
  for (const [source, names] of bySource) {
    if (source === "zod") continue; // every module adds its own zod import explicitly
    // routes.ts lives at src/api/routes.ts; modules live at src/api/modules/.
    const modSource = source.startsWith("./") ? "../" + source.slice(2) : source.startsWith("../") ? "../../" + source.slice(3) : source;
    const nameList = [...new Set(names)].sort().join(", ");
    out.push(`import { ${nameList} } from "${modSource}";`);
  }
  return out.sort().join("\n");
}
function sharedImportsFor(code) {
  const used = sharedExports.filter((n) => new RegExp(`\\b${n}\\b`).test(code));
  return used.length ? `import { ${used.join(", ")} } from "./registryShared";` : "";
}

// ---- registryShared exports (functions the other modules + routes.ts still use) ----
const sharedExports = ["assertNoLiveHorseDuplicates", "assertValidParentAssignment", "throwParentAssignmentIssue", "settleWorkflowMutation", "settleCanonicalHorseMutation", "audit", "parseJsonObject", "parseJsonArray"];

const withExports = (code) => code.replace(/(\n|^)(async )?function /g, (_m, nl, asyncKw) => `${nl}export ${asyncKw ?? ""}function `);

const registrySharedFull = `/** R117-20: shared mutation/audit helpers used by the route-handler modules
 * (claims, changeRequests) and the inline registry handlers in routes.ts.
 * Extracted verbatim from src/api/routes.ts — behavior unchanged.
 */
${usedImports(sharedCode + parseJsonCode)}

${withExports(sharedCode)}

${withExports(parseJsonCode)}
`;

const claimsModule = `/** R117-20: claims + access-grant route handlers, extracted verbatim from
 * src/api/routes.ts (dispatch lines unchanged there; endpoint order and
 * middleware order preserved). Includes the claim zod schemas + decision SQL.
 */
import { z } from "zod";
${usedImports(claimsCode + claimSchemas + claimSql, new Set(sharedExports))}
${sharedImportsFor(claimsCode)}

${claimSchemas}

${claimSql}

${withExports(claimsCode)}
`;

const changeRequestsModule = `/** R117-20: change-request route handlers (create/submit/withdraw/edit/review),
 * extracted verbatim from src/api/routes.ts (dispatch lines unchanged there;
 * endpoint order and middleware order preserved). Includes the change-request
 * zod schemas + decision CAS SQL + the family's SQL/load helpers.
 */
import { z } from "zod";
${usedImports(crCode + crSchemas + crSql, new Set(sharedExports))}
${sharedImportsFor(crCode)}

${crSchemas}

${crSql}

${withExports(crCode)}
`;

writeFileSync("src/api/modules/registryShared.ts", registrySharedFull);
writeFileSync("src/api/modules/claims.ts", claimsModule);
writeFileSync("src/api/modules/changeRequests.ts", changeRequestsModule);

// ---- Rewrite routes.ts: remove the spans, add module imports ----
const remove = new Set();
for (const [a, b] of Object.values(SPANS)) for (let i = a; i <= b; i++) remove.add(i);
const kept = lines.filter((_, idx) => !remove.has(idx + 1));

// Which extracted names does the remaining routes.ts still reference?
const remaining = kept.join("\n");
const stillUsed = sharedExports.filter((n) => new RegExp(`\\b${n}\\b`).test(remaining));
const claimsExports = ["createClaim", "myClaims", "adminClaims", "horseActionsEndpoint", "myGrants", "adminGrants", "adminRevokeGrant", "adminRevokeOrgMembership", "reviewClaim"].filter((n) => new RegExp(`\\b${n}\\b`).test(remaining));
const crExports = ["createChangeRequest", "submitChangeRequest", "withdrawChangeRequest", "editChangeRequest", "myChangeRequests", "adminChangeRequests", "reviewChangeRequest"].filter((n) => new RegExp(`\\b${n}\\b`).test(remaining));

const moduleImports = [
  `import { ${stillUsed.join(", ")} } from "./modules/registryShared";`,
  `import { ${claimsExports.join(", ")} } from "./modules/claims";`,
  `import { ${crExports.join(", ")} } from "./modules/changeRequests";`,
].filter((l) => !l.match(/import \{\s*\} from/));

// Insert after the last existing import line.
let lastImport = 0;
kept.forEach((l, i) => { if (/^import /.test(l)) lastImport = i; });
kept.splice(lastImport + 1, 0, "", "// R117-20: cohesive handler families extracted to modules (dispatch + order unchanged).", ...moduleImports);

writeFileSync(ROUTES, kept.join("\n"));
console.log("routes.ts:", lines.length, "->", kept.length, "lines");
console.log("registryShared exports used by routes.ts:", stillUsed.join(", "));
console.log("claims exports:", claimsExports.join(", "));
console.log("changeRequests exports:", crExports.join(", "));
