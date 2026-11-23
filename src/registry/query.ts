import type { RegistrySort, RegistrySortDirection } from "../contracts/platform";
import { HttpError } from "../api/http";
import { parseSearchQuery, toFtsExpression } from "../search/query";
import { normalizeText } from "../search/normalize";
import { publicMediaPredicate } from "../api/modules/mediaPolicy";

export type RegistrySqlDialect = "sqlite" | "postgres";

/** Locales whose alphabets need the Persian collation key for name sorting. */
export type RegistrySortKeyLocale = "latin" | "persian";

export interface RegistryQueryLimits {
  defaultLimit?: number;
  maxLimit?: number;
  maxOffset?: number;
}

export interface RegistryQueryPlan {
  where: string;
  bindings: Array<string | number>;
  requestedSort: RegistrySort;
  sortSql: string;
  /** Which name-collation family the sort key uses (latin vs persian). */
  sortKeyLocale: RegistrySortKeyLocale;
  direction: RegistrySortDirection;
  directionSql: "ASC" | "DESC";
  filter: string;
  limit: number;
  offset: number;
  /** True when any registry constraint beyond deleted_at is active. */
  hasFilters: boolean;
  /** Only the parent joins actually referenced by the count predicate. */
  countJoinsSql: string;
  /** True when a role-name substring is long enough to use the offline trigram prefilter. */
  hasRoleTrigramFilter: boolean;
  /** Exact precomputed total available only for one supported simple filter. */
  precomputedCountLookup: { key: string; value: string } | null;
}

const SORT_COLUMNS: Record<RegistrySort, string> = {
  id: "h.id",
  name: "h.name_latin COLLATE NOCASE",
  year: "h.birth_year",
  breed: "h.breed_desc COLLATE NOCASE",
  sex: "h.sex_desc COLLATE NOCASE",
  place: "h.birth_place_desc COLLATE NOCASE",
  /* R135 significance ranking, portable SQL (identical on SQLite + PostgreSQL):
     photographed champions (the curated top-100) first, then biographed
     records, foundation stallions, sport-card holders, sport records,
     imports, and finally registered serials — ties fall back to h.id so the
     order is deterministic on every engine. */
  importance: `(CASE WHEN h.profile_image_url IS NOT NULL THEN 64 ELSE 0 END
    + CASE WHEN h.description IS NOT NULL AND h.description <> '' THEN 32 ELSE 0 END
    + CASE WHEN h.is_stallion = 1 THEN 16 ELSE 0 END
    + CASE WHEN h.has_sport_card = 1 THEN 8 ELSE 0 END
    + CASE WHEN h.is_sport = 1 THEN 4 ELSE 0 END
    + CASE WHEN h.is_imported = 1 THEN 2 ELSE 0 END
    + CASE WHEN h.register_no IS NOT NULL AND h.register_no <> '' THEN 1 ELSE 0 END)`,
};

/*
 * R128 — locale-aware alphabetical name sorting.
 *
 * The dataset keeps Farsi names in `name_native` while `name_latin` is empty
 * for a large share of records, and Persian letters sort incorrectly under
 * both SQLite BINARY and PostgreSQL default collations (پ/چ/ژ land after ی).
 * The fix is a deterministic collation key computed inline with nested
 * REPLACE() calls — pure SQL that behaves identically on both dialects:
 *
 *  1. Every Persian/Arabic letter maps to a fixed two-character hex code in
 *     true Persian alphabet order (آ ا ب پ ت ث ج چ ح خ د ذ ر ز ژ س ش ص ض ط ظ
 *     ع غ ف ق ک گ ل م ن و ه ی), so آ sorts first exactly as a Farsi reader
 *     expects. Arabic codepoint variants (ي ك أ إ ٱ ة) fold into the same
 *     slot as their Persian counterparts.
 *  2. Persian (U+06F0–) and Arabic-Indic (U+0660–) digits fold to ASCII digits.
 *  3. Zero-width joiners (ZWNJ/ZWJ/BOM) are stripped so concatenated names
 *     compare as written.
 *  4. Unknown characters pass through, so mixed Latin/Persian names still get
 *     a stable, total order.
 */
const PERSIAN_ALPHABET_COLLATION: ReadonlyArray<{ readonly chars: string; readonly key: string }> = Object.freeze([
  { chars: "\u0622\u0623\u0625\u0671", key: "01" }, // آ أ إ ٱ → alef-madda slot
  { chars: "\u0627", key: "02" },                      // ا
  { chars: "\u0628", key: "03" },                      // ب
  { chars: "\u067E", key: "04" },                      // پ
  { chars: "\u062A", key: "05" },                      // ت
  { chars: "\u062B", key: "06" },                      // ث
  { chars: "\u062C", key: "07" },                      // ج
  { chars: "\u0686", key: "08" },                      // چ
  { chars: "\u062D", key: "09" },                      // ح
  { chars: "\u062E", key: "0a" },                      // خ
  { chars: "\u062F", key: "0b" },                      // د
  { chars: "\u0630", key: "0c" },                      // ذ
  { chars: "\u0631", key: "0d" },                      // ر
  { chars: "\u0632", key: "0e" },                      // ز
  { chars: "\u0698", key: "0f" },                      // ژ
  { chars: "\u0633", key: "10" },                      // س
  { chars: "\u0634", key: "11" },                      // ش
  { chars: "\u0635", key: "12" },                      // ص
  { chars: "\u0636", key: "13" },                      // ض
  { chars: "\u0637", key: "14" },                      // ط
  { chars: "\u0638", key: "15" },                      // ظ
  { chars: "\u0639", key: "16" },                      // ع
  { chars: "\u063A", key: "17" },                      // غ
  { chars: "\u0641", key: "18" },                      // ف
  { chars: "\u0642", key: "19" },                      // ق
  { chars: "\u0643\u06A9", key: "1a" },               // ك ک
  { chars: "\u06AF", key: "1b" },                      // گ
  { chars: "\u0644", key: "1c" },                      // ل
  { chars: "\u0645", key: "1d" },                      // م
  { chars: "\u0646", key: "1e" },                      // ن
  { chars: "\u0629\u0647\u06C0", key: "1f" },        // ة ه ۀ
  { chars: "\u0648", key: "20" },                      // و
  { chars: "\u064A\u06CC\u0649\u0626", key: "21" }, // ي ی ى ئ
]);

const PERSIAN_DIGITS = "\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9";
const ARABIC_DIGITS = "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669";
const ASCII_DIGITS = "0123456789";

/*
 * Source-data hygiene for the collation key: the studbook contains names that
 * begin with punctuation runs (".حمداني …", "-----", "(GOLDICA) …") or stray
 * leading spaces. Dictionaries ignore that noise, so the key strips any
 * leading run of it (two-argument LTRIM — identical semantics on SQLite and
 * PostgreSQL), and a key that is empty afterwards (nameless or noise-only
 * records) sorts LAST via the '~' sentinel instead of squatting at the head
 * of the alphabet.
 */
const SORT_KEY_LEADING_NOISE = " \u00B7\u2010\u2011\u2013\u2014_(/\\)\u060C\u061B\u061F.,;:!?*&+#<>=[]{}|^~`\u2018\u2019\u201C\u201D-";

/** Wraps a finished key expression with the leading-noise strip + empty-last sentinel. */
function sortKeyHygieneSql(keyExpression: string): string {
  return `COALESCE(NULLIF(LTRIM(${keyExpression},'${SORT_KEY_LEADING_NOISE}'),''),'~')`;
}

/** Build the nested REPLACE() collation-key SQL for one text expression. */
function persianCollationKeySql(expression: string): string {
  let sql = expression;
  // Fold the case of pass-through Latin text first; the Persian slots below
  // only ever emit ASCII hex codes, so later steps cannot corrupt earlier ones.
  sql = `lower(${sql})`;
  for (const digitFold of [PERSIAN_DIGITS, ARABIC_DIGITS]) {
    for (let index = 0; index < 10; index += 1) {
      sql = `REPLACE(${sql},'${digitFold[index]}','${ASCII_DIGITS[index]}')`;
    }
  }
  for (const letter of PERSIAN_ALPHABET_COLLATION) {
    for (const char of letter.chars) {
      sql = `REPLACE(${sql},'${char}','${letter.key}')`;
    }
  }
  // Strip zero-width joiners and directional marks so concatenations compare
  // exactly as the name reads.
  // Arabic diacritics (fatha/kasra/damma/shadda/sukun/superscript-alef) and
  // tatweel carry no alphabetical identity — strip them so diacritic-marked
  // names sort with their plain form instead of falling off the end.
  const diacritics = "\u064B\u064C\u064D\u064E\u064F\u0650\u0651\u0652\u0670\u0640";
  for (const mark of ["\u200C", "\u200D", "\u200E", "\u200F", "\uFEFF", ...diacritics]) {
    sql = `REPLACE(${sql},'${mark}','')`;
  }
  return sortKeyHygieneSql(sql);
}

/** Resolve the requested name-sort collation family from the URL. */
function parseSortKeyLocale(url: URL): RegistrySortKeyLocale {
  const requested = (url.searchParams.get("lang") ?? url.searchParams.get("locale") ?? "").trim().toLowerCase();
  return requested === "fa" || requested === "ar" || requested === "persian" ? "persian" : "latin";
}

function nameSortSql(locale: RegistrySortKeyLocale, dialect: RegistrySqlDialect): string {
  // Native-first for Persian readers, Latin-first for everyone else; the
  // fallback keeps records with one missing name form fully ordered instead
  // of lumping every empty name at the head of the list. Both families get
  // the same leading-noise strip + empty-last sentinel.
  //
  // The key is designed for BINARY (codepoint) comparison: the '~' sentinel
  // and the two-char hex slots only keep their meaning under codepoint order.
  // SQLite's default collation is already binary; PostgreSQL locale
  // collations re-weight punctuation (the sentinel landed at the HEAD of the
  // list under the production locale), so the expression pins COLLATE "C".
  const binaryCollation = dialect === "postgres" ? ' COLLATE "C"' : "";
  if (locale === "persian") {
    return `${persianCollationKeySql("COALESCE(NULLIF(h.name_native,''),h.name_latin)")}${binaryCollation}`;
  }
  // lower() + binary comparison == the old COLLATE NOCASE semantics, without
  // depending on the database actually providing a NOCASE collation.
  return `${sortKeyHygieneSql("lower(COALESCE(NULLIF(h.name_latin,''),h.name_native))")}${binaryCollation}`;
}

/**
 * Canonical server-side registry query compiler.
 *
 * Browse, export and any future registry projections must consume this helper
 * rather than reimplementing filter semantics. That keeps the public SDK,
 * facets, explorer UIs and export output aligned as the contract grows.
 */
export function compileRegistryQuery(url: URL, limits: RegistryQueryLimits = {}, dialect: RegistrySqlDialect = "sqlite"): RegistryQueryPlan {
  const defaultLimit = positiveBound(limits.defaultLimit ?? 50, 1, limits.maxLimit ?? 100);
  const maxLimit = positiveBound(limits.maxLimit ?? 100, 1, 50_000);
  const maxOffset = positiveBound(limits.maxOffset ?? 1_000_000, 0, 10_000_000);
  const limit = parseBoundedIntegerParam(url.searchParams.get("limit"), defaultLimit, 1, maxLimit, "limit");
  const offset = parseBoundedIntegerParam(url.searchParams.get("offset"), 0, 0, maxOffset, "offset");
  const requested = url.searchParams.get("sort") as RegistrySort | null;
  const requestedSort: RegistrySort = requested && Object.hasOwn(SORT_COLUMNS, requested) ? requested : "id";
  const direction: RegistrySortDirection = url.searchParams.get("dir") === "desc" ? "desc" : "asc";
  const directionSql = direction === "desc" ? "DESC" : "ASC";
  const filter = safeFilter(url.searchParams.get("filter") ?? url.searchParams.get("q") ?? "", 80);

  const breed = safeText(url.searchParams.get("breed"), 120);
  const sex = safeText(url.searchParams.get("sex"), 80);
  const place = safeText(url.searchParams.get("place"), 200);
  const color = safeText(url.searchParams.get("color"), 120);
  const mainStrain = safeText(url.searchParams.get("mainStrain"), 120);
  const importedFrom = safeText(url.searchParams.get("importedFrom"), 160);
  const lifecycle = url.searchParams.get("status") ?? url.searchParams.get("lifecycle") ?? "";
  const yearFrom = parseOptionalSafeIntegerParam(url.searchParams.get("yearFrom"), "yearFrom");
  const yearTo = parseOptionalSafeIntegerParam(url.searchParams.get("yearTo"), "yearTo");
  const ownerId = parseOptionalSafeIntegerParam(url.searchParams.get("ownerId"), "ownerId");
  const breederId = parseOptionalSafeIntegerParam(url.searchParams.get("breederId"), "breederId");
  const nameFilter = safeFilter(url.searchParams.get("name") ?? "", 120);
  const idFilter = safeText((url.searchParams.get("id") ?? "").replace(/^#/, ""), 24);
  const registerFilter = safeFilter(url.searchParams.get("register") ?? "", 120);
  const ownerFilter = safeFilter(url.searchParams.get("owner") ?? "", 120);
  const breederFilter = safeFilter(url.searchParams.get("breeder") ?? "", 120);
  const importerFilter = safeFilter(url.searchParams.get("importer") ?? "", 120);
  const passportReceiverFilter = safeFilter(url.searchParams.get("passportReceiver") ?? "", 120);
  const sireFilter = safeFilter(url.searchParams.get("sire") ?? "", 120);
  const damFilter = safeFilter(url.searchParams.get("dam") ?? "", 120);

  let where = "h.deleted_at IS NULL";
  const bindings: Array<string | number> = [];
  const countCandidates: Array<{ key: string; value: string }> = [];
  let precomputedCountDisqualified = false;
  const addCountCandidate = (key: string, value: string) => countCandidates.push({ key, value });
  const sortKeyLocale = parseSortKeyLocale(url);

  if (filter) {
    precomputedCountDisqualified = true;
    const parsedFilter = parseSearchQuery(filter);
    if (dialect === "postgres") {
      const postgresTerms = postgresRegistrySearchTerms(parsedFilter);
      if (postgresTerms) {
        where += " AND h.id IN (SELECT horse_id FROM horse_search_source WHERE to_tsvector('simple',all_text) @@ to_tsquery('simple', ?))";
        bindings.push(postgresTerms);
      }
    } else {
      const ftsExpression = toFtsExpression(parsedFilter);
      if (ftsExpression) {
        where += " AND h.id IN (SELECT rowid FROM horse_search_fts WHERE horse_search_fts MATCH ?)";
        bindings.push(ftsExpression);
      }
    }

    // FTS is only a bounded candidate accelerator. Structured fields are also
    // applied as authoritative predicates so SQLite and PostgreSQL cannot
    // silently change field scope or repeated-field OR semantics. Numeric
    // fields never depend on FTS and therefore retain indexed primary/year
    // predicates even for filters such as `id:123 year:2020`.
    const structuredClauses = compileStructuredSearchPredicates(parsedFilter);
    if (structuredClauses.clauses.length) {
      where += ` AND ${structuredClauses.clauses.join(" AND ")}`;
      bindings.push(...structuredClauses.bindings);
    }

    const hasSearchableText = Boolean(
      parsedFilter.freeTokens.length ||
      Object.entries(parsedFilter.fields).some(([field, values]) => field !== "id" && field !== "year" && Boolean(values?.length)),
    );
    if (hasSearchableText && !(dialect === "postgres" ? postgresRegistrySearchTerms(parsedFilter) : toFtsExpression(parsedFilter))) {
      // Never turn unsupported text into a leading-wildcard full-registry scan.
      where += " AND 0=1";
    }
  }
  if (breed) { where += " AND h.breed_desc=? COLLATE NOCASE"; bindings.push(breed); addCountCandidate("breed", breed); }
  if (sex) { where += " AND h.sex_desc=? COLLATE NOCASE"; bindings.push(sex); addCountCandidate("sex", sex); }
  if (place) { precomputedCountDisqualified = true; appendHorseTrigramPrefilter(place); where += " AND h.birth_place_desc LIKE ? COLLATE NOCASE"; bindings.push(d1ContainsLikePattern(place, "place")); }
  if (color) { where += " AND h.color_desc=? COLLATE NOCASE"; bindings.push(color); addCountCandidate("color", color); }
  if (mainStrain) { where += " AND h.main_strain_desc=? COLLATE NOCASE"; bindings.push(mainStrain); addCountCandidate("mainStrain", mainStrain); }
  if (importedFrom) { where += " AND h.imported_from_desc=? COLLATE NOCASE"; bindings.push(importedFrom); addCountCandidate("importedFrom", importedFrom); }

  for (const [param, column] of [
    ["isImported", "h.is_imported"],
    ["isSport", "h.is_sport"],
    ["isStallion", "h.is_stallion"],
    ["hasSportCard", "h.has_sport_card"],
  ] as const) {
    applyBooleanFilter(url.searchParams.get(param), column, (clause, positive) => { where += clause; addCountCandidate(param, positive ? "1" : "0"); });
  }

  if (yearFrom !== null && yearFrom >= 1500) { precomputedCountDisqualified = true; where += " AND h.birth_year>=?"; bindings.push(yearFrom); }
  if (yearTo !== null && yearTo >= 1500) { precomputedCountDisqualified = true; where += " AND h.birth_year<=?"; bindings.push(yearTo); }
  if (lifecycle === "active") { where += " AND h.is_active=1 AND h.is_dead=0"; addCountCandidate("lifecycle", "active"); }
  else if (lifecycle === "inactive") { where += " AND h.is_active=0 AND h.is_dead=0"; addCountCandidate("lifecycle", "inactive"); }
  else if (lifecycle === "deceased") { where += " AND h.is_dead=1"; addCountCandidate("lifecycle", "deceased"); }

  if (nameFilter) { precomputedCountDisqualified = true; appendHorseTrigramPrefilter(nameFilter); where += " AND (h.name_latin LIKE ? COLLATE NOCASE OR h.name_native LIKE ?)"; const like=d1ContainsLikePattern(nameFilter, "name"); bindings.push(like, like); }
  if (idFilter) {
    precomputedCountDisqualified = true;
    if (/^\d+$/.test(idFilter)) {
      const numericId = Number(idFilter);
      if (Number.isSafeInteger(numericId) && numericId > 0) { where += " AND h.id=?"; bindings.push(numericId); }
      else where += " AND 0=1";
    } else where += " AND 0=1";
  }
  if (registerFilter) { precomputedCountDisqualified = true; appendHorseTrigramPrefilter(registerFilter); where += " AND h.register_no LIKE ? COLLATE NOCASE"; bindings.push(d1ContainsLikePattern(registerFilter, "register")); }
  const roleFilters = [
    ["owner", ownerFilter, "owner"],
    ["breeder", breederFilter, "breeder"],
    ["importer", importerFilter, "importer"],
    ["passport_receiver", passportReceiverFilter, "passportReceiver"],
  ] as const;
  let hasRoleTrigramFilter = false;
  for (const [role, value, fieldName] of roleFilters) {
    if (!value) continue;
    precomputedCountDisqualified = true;
    const trigramEligible = Array.from(value).length >= 3;
    if (trigramEligible && dialect === "sqlite") {
      hasRoleTrigramFilter = true;
      // SQLite/D1 uses the derived role FTS accelerator. PostgreSQL instead
      // relies on native pg_trgm people-name indexes plus a covering
      // (person_id,role,horse_id) relationship index; the exact EXISTS below is
      // authoritative for both dialects.
      where += ` AND ((SELECT COALESCE(analytics_stale,1) FROM registry_state WHERE id=1)<>0 OR h.id IN (SELECT rowid FROM horse_role_search_trigram WHERE ${role} MATCH ?))`;
      bindings.push(fts5QuotedLiteral(value));
    }
    where += ` AND EXISTS(SELECT 1 FROM horse_people hp_role JOIN people p_role ON p_role.id=hp_role.person_id WHERE hp_role.horse_id=h.id AND hp_role.role=? AND p_role.deleted_at IS NULL AND (p_role.name_latin LIKE ? COLLATE NOCASE OR p_role.name_native LIKE ?))`;
    const like = d1ContainsLikePattern(value, fieldName);
    bindings.push(role, like, like);
  }
  if (sireFilter) { precomputedCountDisqualified = true; appendHorseTrigramPrefilter(sireFilter); where += " AND (f.name_latin LIKE ? COLLATE NOCASE OR f.name_native LIKE ?)"; const like=d1ContainsLikePattern(sireFilter, "sire"); bindings.push(like, like); }
  if (damFilter) { precomputedCountDisqualified = true; appendHorseTrigramPrefilter(damFilter); where += " AND (m.name_latin LIKE ? COLLATE NOCASE OR m.name_native LIKE ?)"; const like=d1ContainsLikePattern(damFilter, "dam"); bindings.push(like, like); }
  if (ownerId !== null && ownerId > 0) { precomputedCountDisqualified = true; where += " AND EXISTS(SELECT 1 FROM horse_people hpo WHERE hpo.horse_id=h.id AND hpo.person_id=? AND hpo.role='owner')"; bindings.push(ownerId); }
  if (breederId !== null && breederId > 0) { precomputedCountDisqualified = true; where += " AND EXISTS(SELECT 1 FROM horse_people hpb WHERE hpb.horse_id=h.id AND hpb.person_id=? AND hpb.role='breeder')"; bindings.push(breederId); }

  const visibleSire = "EXISTS(SELECT 1 FROM horses visible_sire WHERE visible_sire.id=h.father_id AND visible_sire.deleted_at IS NULL AND visible_sire.is_active=1)";
  const visibleDam = "EXISTS(SELECT 1 FROM horses visible_dam WHERE visible_dam.id=h.mother_id AND visible_dam.deleted_at IS NULL AND visible_dam.is_active=1)";
  applyBooleanFilter(url.searchParams.get("hasSire"), visibleSire, (_clause, positive) => { where += positive ? ` AND ${visibleSire}` : ` AND NOT ${visibleSire}`; precomputedCountDisqualified = true; });
  applyBooleanFilter(url.searchParams.get("hasDam"), visibleDam, (_clause, positive) => { where += positive ? ` AND ${visibleDam}` : ` AND NOT ${visibleDam}`; precomputedCountDisqualified = true; });

  // R145-C05 (Master-AI plan): permission-aware evidence facets. Public-safe
  // by construction — the predicates count only what is already publicly
  // servable (shared_public photos / platform-verified DOCUMENTS via the
  // marketplace chip), never private evidence presence. Counts derive from
  // the same predicate as the rows, so totals always reconcile.
  const evidenceFacet = (param: string, predicate: string, key: string) => {
    const raw = url.searchParams.get(param);
    if (raw !== "1" && raw !== "true" && raw !== "0" && raw !== "false") return;
    const positive = raw === "1" || raw === "true";
    precomputedCountDisqualified = true;
    where += positive ? ` AND EXISTS(SELECT 1 FROM horse_media hf WHERE hf.horse_id=h.id AND ${predicate})` : " AND NOT EXISTS(SELECT 1 FROM horse_media hf WHERE hf.horse_id=h.id AND " + predicate + ")";
    addCountCandidate(key, positive ? "1" : "0");
  };
  evidenceFacet("hasPhoto", publicMediaPredicate("hf"), "hasPhoto");
  // Documents are private under the media policy. A public presence filter
  // cannot expose them even when staff reviewed the underlying document.
  evidenceFacet("hasVerifiedDoc", "0=1", "hasVerifiedDoc");
  const parentageRaw = url.searchParams.get("parentageKnown");
  if (parentageRaw === "1" || parentageRaw === "true" || parentageRaw === "0" || parentageRaw === "false") {
    const positive = parentageRaw === "1" || parentageRaw === "true";
    precomputedCountDisqualified = true;
    where += positive ? ` AND ${visibleSire} AND ${visibleDam}` : ` AND (NOT ${visibleSire} OR NOT ${visibleDam})`;
    addCountCandidate("parentageKnown", positive ? "1" : "0");
  }

  function appendHorseTrigramPrefilter(value: string): void {
    if (dialect === "postgres") return;
    const normalized = normalizeText(value);
    if (Array.from(normalized).length < 3) return;
    // horse_search_trigram is maintained by the canonical search-reindex queue.
    // If any queued refresh exists, bypass the candidate index entirely; the
    // original exact field predicate below remains authoritative.
    where += " AND (EXISTS(SELECT 1 FROM horse_search_reindex_queue LIMIT 1) OR h.id IN (SELECT rowid FROM horse_search_trigram WHERE horse_search_trigram MATCH ?))";
    bindings.push(fts5QuotedLiteral(normalized));
  }

  const countJoinsSql = `${sireFilter ? " LEFT JOIN horses f ON f.id=h.father_id AND f.deleted_at IS NULL AND f.is_active=1" : ""}${damFilter ? " LEFT JOIN horses m ON m.id=h.mother_id AND m.deleted_at IS NULL AND m.is_active=1" : ""}`;
  const hasFilters = where !== "h.deleted_at IS NULL";
  const precomputedCountLookup = !precomputedCountDisqualified && countCandidates.length === 1 ? countCandidates[0] : null;

  return {
    where,
    bindings,
    requestedSort,
    sortSql: requestedSort === "name" ? nameSortSql(sortKeyLocale, dialect) : SORT_COLUMNS[requestedSort],
    sortKeyLocale,
    direction,
    directionSql,
    filter,
    limit,
    offset,
    hasFilters,
    countJoinsSql,
    hasRoleTrigramFilter,
    precomputedCountLookup,
  };
}

function postgresRegistrySearchTerms(parsed: ReturnType<typeof parseSearchQuery>): string | null {
  const searchableFields = ["name", "father", "mother", "owner", "breeder", "importer", "passportReceiver", "breed", "place", "color", "strain", "imported"] as const;
  const phrase = (value: string) => normalizeText(value).split(" ").filter(Boolean).map((token) => `${token}:*`).join(" & ");
  const clauses = parsed.freeTokens.map(phrase).filter(Boolean);
  for (const field of searchableFields) {
    const alternatives = (parsed.fields[field] ?? []).map(phrase).filter(Boolean);
    if (alternatives.length) clauses.push(`(${alternatives.map((value) => `(${value})`).join(" | ")})`);
  }
  // PostgreSQL searches all_text only as a candidate superset. The canonical
  // field predicate below restores exact field scope. Repeated values within a
  // field are alternatives; distinct fields/free terms remain conjunctive.
  return clauses.length ? clauses.join(" & ") : null;
}

function compileStructuredSearchPredicates(parsed: ReturnType<typeof parseSearchQuery>): { clauses: string[]; bindings: Array<string | number> } {
  const clauses: string[] = [];
  const bindings: Array<string | number> = [];
  const containsAlternatives = (expression: string, values: string[] | undefined) => {
    if (!values?.length) return;
    const alternatives = values.map((value) => { bindings.push(`%${normalizeText(value)}%`); return `${expression} LIKE ?`; });
    clauses.push(`(${alternatives.join(" OR ")})`);
  };
  const searchSourceAlternatives = (columns: string[], values: string[] | undefined) => {
    if (!values?.length) return;
    const alternatives: string[] = [];
    for (const value of values) {
      const pattern = `%${normalizeText(value)}%`;
      alternatives.push(`(${columns.map((column) => `s_filter.${column} LIKE ?`).join(" OR ")})`);
      for (let n = 0; n < columns.length; n++) bindings.push(pattern);
    }
    clauses.push(`EXISTS(SELECT 1 FROM horse_search_source s_filter WHERE s_filter.horse_id=h.id AND (${alternatives.join(" OR ")}))`);
  };
  const roleAlternatives = (role: string, values: string[] | undefined) => {
    if (!values?.length) return;
    const alternatives: string[] = [];
    for (const value of values) {
      const pattern = `%${normalizeText(value)}%`;
      alternatives.push("(LOWER(COALESCE(p_filter.name_latin,'')) LIKE ? OR COALESCE(p_filter.name_native,'') LIKE ?)");
      bindings.push(pattern, pattern);
    }
    clauses.push(`EXISTS(SELECT 1 FROM horse_people hp_filter JOIN people p_filter ON p_filter.id=hp_filter.person_id WHERE hp_filter.horse_id=h.id AND hp_filter.role='${role}' AND p_filter.deleted_at IS NULL AND (${alternatives.join(" OR ")}))`);
  };
  const publicParentMatch = (side: "father" | "mother") => `EXISTS(SELECT 1 FROM horses visible_parent
    LEFT JOIN horse_search_source parent_search ON parent_search.horse_id=visible_parent.id
    WHERE visible_parent.id=h.${side}_id AND visible_parent.deleted_at IS NULL AND visible_parent.is_active=1
      AND (LOWER(COALESCE(visible_parent.name_latin,'') || ' ' || COALESCE(visible_parent.name_native,'')) LIKE ?
        OR (COALESCE(parent_search.name_latin,'') || ' ' || COALESCE(parent_search.name_native,'')) LIKE ?))`;
  for (const side of ["father", "mother"] as const) {
    const values = parsed.fields[side];
    if (!values?.length) continue;
    clauses.push(`(${values.map(value => { const pattern = `%${normalizeText(value)}%`; bindings.push(pattern, pattern); return publicParentMatch(side); }).join(" OR ")})`);
  }
  // An old FTS row may still contain a withdrawn parent or private identifier.
  // Every free term must also match facts that the current public view exposes.
  for (const value of parsed.freeTokens) {
    const pattern = `%${normalizeText(value)}%`;
    clauses.push(`(LOWER(COALESCE(h.name_latin,'') || ' ' || COALESCE(h.name_native,'') || ' ' || COALESCE(h.register_no,'') || ' ' || COALESCE(h.birth_place_desc,'') || ' ' || COALESCE(h.breed_desc,'') || ' ' || COALESCE(h.sex_desc,'') || ' ' || COALESCE(h.color_desc,'') || ' ' || COALESCE(h.birth_year,0)) LIKE ?
      OR EXISTS(SELECT 1 FROM horse_search_source public_search WHERE public_search.horse_id=h.id AND
        (COALESCE(public_search.name_latin,'') || ' ' || COALESCE(public_search.name_native,'') || ' ' || COALESCE(public_search.owners,'') || ' ' || COALESCE(public_search.breeders,'') || ' ' || COALESCE(public_search.places,'') || ' ' || COALESCE(public_search.breed,'')) LIKE ?)
      OR EXISTS(SELECT 1 FROM horse_aliases visible_alias WHERE visible_alias.horse_id=h.id AND visible_alias.alias_normalized LIKE ?)
      OR ${publicParentMatch("father")} OR ${publicParentMatch("mother")})`);
    bindings.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }

  if (parsed.fields.id?.length) {
    const ids = parsed.fields.id.map((value) => Number(value)).filter((value) => Number.isSafeInteger(value) && value > 0);
    if (ids.length !== parsed.fields.id.length) clauses.push("0=1");
    else { clauses.push(`h.id IN (${ids.map(() => "?").join(",")})`); bindings.push(...ids); }
  }
  if (parsed.fields.year?.length) {
    const years = parsed.fields.year.map((value) => Number(value)).filter((value) => Number.isSafeInteger(value) && value >= 1500 && value <= 9999);
    if (years.length !== parsed.fields.year.length) clauses.push("0=1");
    else { clauses.push(`h.birth_year IN (${years.map(() => "?").join(",")})`); bindings.push(...years); }
  }

  searchSourceAlternatives(["name_latin", "name_native"], parsed.fields.name);
  searchSourceAlternatives(["breed"], parsed.fields.breed);
  searchSourceAlternatives(["places"], parsed.fields.place);
  roleAlternatives("owner", parsed.fields.owner);
  roleAlternatives("breeder", parsed.fields.breeder);
  roleAlternatives("importer", parsed.fields.importer);
  roleAlternatives("passport_receiver", parsed.fields.passportReceiver);
  containsAlternatives("LOWER(COALESCE(h.color_desc,''))", parsed.fields.color);
  if (parsed.fields.strain?.length) containsAlternatives("LOWER(COALESCE(h.main_strain_desc,'') || ' ' || COALESCE(h.sub_strain_desc,''))", parsed.fields.strain);
  containsAlternatives("LOWER(COALESCE(h.imported_from_desc,''))", parsed.fields.imported);

  return { clauses, bindings };
}

function fts5QuotedLiteral(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function applyBooleanFilter(raw: string | null, column: string, append: (clause: string, positive: boolean) => void): void {
  if (raw === "1" || raw === "true") append(` AND ${column}=1`, true);
  else if (raw === "0" || raw === "false") append(` AND ${column}=0`, false);
}

function safeFilter(value: string, maxBytes: number): string {
  return safeText(value.replace(/[%_]/g, " "), maxBytes);
}

function safeText(value: string | null, maxBytes: number): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= maxBytes) return text;
  let out = "";
  for (const char of text) {
    if (encoder.encode(out + char).byteLength > maxBytes) break;
    out += char;
  }
  return out;
}

/** D1 limits LIKE/GLOB patterns to 50 UTF-8 bytes. Reserve 2 bytes for surrounding `%` wildcards. */
export function d1ContainsLikePattern(value: string, fieldName = "filter"): string {
  const clean = value.trim().replace(/[%_]/g, " ");
  const bytes = new TextEncoder().encode(clean).byteLength;
  if (bytes > 48) {
    throw new HttpError(400, "filter_too_long", `${fieldName} is too long for a substring filter`, {
      field: fieldName,
      maxUtf8Bytes: 48,
      actualUtf8Bytes: bytes,
    });
  }
  return `%${clean}%`;
}

export function parseBoundedIntegerParam(raw: string | null, fallback: number, min: number, max: number, fieldName: string): number {
  if (raw === null || raw.trim() === "") return fallback;
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new HttpError(400, "invalid_query_parameter", `${fieldName} must be an integer`, { field: fieldName });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new HttpError(400, "invalid_query_parameter", `${fieldName} is outside the supported range`, { field: fieldName, min, max });
  }
  return value;
}

function parseOptionalSafeIntegerParam(raw: string | null, fieldName: string): number | null {
  if (raw === null || raw.trim() === "") return null;
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new HttpError(400, "invalid_query_parameter", `${fieldName} must be an integer`, { field: fieldName });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new HttpError(400, "invalid_query_parameter", `${fieldName} must be a safe integer`, { field: fieldName });
  }
  return value;
}

function positiveBound(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(Math.trunc(value), max));
}
