import { describe, expect, it } from "vitest";
import { parseSearchQuery, toFtsExpression } from "../../src/search/query";
import { candidateMatchesStructuredFields } from "../../src/search/service";
import { compileRegistryQuery, d1ContainsLikePattern, parseBoundedIntegerParam } from "../../src/registry/query";
import { HttpError } from "../../src/api/http";

describe("unified query parser", () => {
  it("preserves field hints while accepting free mixed tokens", () => {
    const parsed = parseSearchQuery('nova owner:"morgan reed" year:2000 springfield');
    expect(parsed.freeTokens).toEqual(["nova", "springfield"]);
    expect(parsed.fields.owner).toEqual(["morgan reed"]);
    expect(parsed.fields.year).toEqual(["2000"]);
  });
  it("builds constrained FTS clauses without requiring syntax for free terms", () => {
    const expr = toFtsExpression(parseSearchQuery("owner:reed arabian"));
    expect(expr).toContain("owners:");
    expect(expr).toContain("all_text:");
  });
});



  it("treats structured search fields as constraints rather than score-only hints", () => {
    const row = { id: 123, name_latin: "NOVA STAR", name_native: null, birth_year: 2000, owners: "morgan reed", breeders: "", importers: "", passport_receivers: "", father_name_search: "north star", mother_name_search: "silver lilac", places_search: "tehran", breed_search: "arabian", color_desc: "grey", main_strain_desc: "asil", sub_strain_desc: null, imported_from_search: "iran" } as any;
    expect(candidateMatchesStructuredFields(row, parseSearchQuery("year:2000 owner:reed"))).toBe(true);
    expect(candidateMatchesStructuredFields(row, parseSearchQuery("year:2001 owner:reed"))).toBe(false);
    expect(candidateMatchesStructuredFields(row, parseSearchQuery("id:124"))).toBe(false);
  });

describe("registry query safety", () => {
  it("rejects inherited sort keys rather than resolving Object prototype properties", () => {
    const plan = compileRegistryQuery(new URL("https://example.test/api/horses?sort=constructor"));
    expect(plan.requestedSort).toBe("id");
    expect(plan.sortSql).toBe("h.id");
  });

  it("rejects fractional integer parameters with a structured client error", () => {
    expect(() => parseBoundedIntegerParam("1.5", 24, 1, 100, "limit")).toThrow(HttpError);
    try { parseBoundedIntegerParam("1.5", 24, 1, 100, "limit"); } catch (error) {
      expect(error).toMatchObject({ status: 400, code: "invalid_query_parameter" });
    }
  });


  it("keeps exact registry horse-id filters on the primary-key path", () => {
    const plan = compileRegistryQuery(new URL("https://example.test/api/horses?id=%231234"));
    expect(plan.where).toContain("h.id=?");
    expect(plan.where).not.toContain("CAST(h.id AS TEXT)");
    expect(plan.bindings).toContain(1234);
  });

  it("uses FTS candidates and rechecks free terms against current public facts", () => {
    const plan = compileRegistryQuery(new URL("https://example.test/api/horses?q=nova%20arabian"));
    expect(plan.where).toContain("horse_search_fts MATCH ?");
    expect(plan.where).not.toContain("h.name_latin LIKE");
    expect(plan.bindings).toEqual([
      toFtsExpression(parseSearchQuery("nova arabian")),
      ...Array(7).fill("%nova%"), ...Array(7).fill("%arabian%"),
    ]);
    expect(plan.where).toContain("visible_alias.alias_normalized LIKE ?");
    expect(plan.where).toContain("visible_parent.deleted_at IS NULL AND visible_parent.is_active=1");
    expect(plan.where).not.toContain("microchip_no");
    expect(plan.where).not.toContain("uel_no");
    expect(plan.where.match(/\?/g)?.length).toBe(plan.bindings.length);
  });


  it("compiles PostgreSQL registry free text through native FTS without SQLite FTS tables", () => {
    const plan = compileRegistryQuery(new URL("https://example.test/api/horses?q=nova%20arabian"), {}, "postgres");
    expect(plan.where).toContain("to_tsvector('simple',all_text)");
    expect(plan.where).toContain("to_tsquery('simple', ?)");
    expect(plan.where).not.toContain("horse_search_fts");
    expect(plan.bindings).toEqual(["nova:* & arabian:*", ...Array(7).fill("%nova%"), ...Array(7).fill("%arabian%")]);
    expect(plan.where).toContain("visible_alias.alias_normalized LIKE ?");
    expect(plan.where).toContain("visible_parent.deleted_at IS NULL AND visible_parent.is_active=1");
    expect(plan.where).not.toContain("microchip_no");
    expect(plan.where).not.toContain("uel_no");
    expect(plan.where.match(/\?/g)?.length).toBe(plan.bindings.length);
  });

  it("uses canonical role EXISTS without SQLite role FTS in PostgreSQL mode", () => {
    const plan = compileRegistryQuery(new URL("https://example.test/api/horses?owner=morgan%20reed"), {}, "postgres");
    expect(plan.hasRoleTrigramFilter).toBe(false);
    expect(plan.where).not.toContain("horse_role_search_trigram");
    expect(plan.where).toContain("EXISTS(SELECT 1 FROM horse_people");
    expect(plan.bindings).toContain("%morgan reed%");
  });

  it("keeps structured filter field scope and ORs repeated values in PostgreSQL mode", () => {
    const plan = compileRegistryQuery(new URL("https://example.test/api/horses?filter=owner:ali%20owner:reza"), {}, "postgres");
    expect(plan.where).toContain("hp_filter.role='owner'");
    expect(plan.where).toContain("p_filter.name_latin");
    expect(plan.bindings[0]).toContain(" | ");
    expect(plan.bindings).toContain("%ali%");
    expect(plan.bindings).toContain("%reza%");
  });

  it("compiles structured id and year filters as indexed numeric predicates instead of false", () => {
    const sqlite = compileRegistryQuery(new URL("https://example.test/api/horses?filter=id:123%20year:2020"));
    const postgres = compileRegistryQuery(new URL("https://example.test/api/horses?filter=id:123%20year:2020"), {}, "postgres");
    for (const plan of [sqlite, postgres]) {
      expect(plan.where).toContain("h.id IN (?)");
      expect(plan.where).toContain("h.birth_year IN (?)");
      expect(plan.where).not.toContain("0=1");
      expect(plan.bindings).toEqual([123, 2020]);
    }
  });

  it("tracks whether count queries need parent joins without changing filter semantics", () => {
    const plain = compileRegistryQuery(new URL("https://example.test/api/horses?limit=50"));
    expect(plain.hasFilters).toBe(false);
    expect(plain.countJoinsSql).toBe("");

    const sire = compileRegistryQuery(new URL("https://example.test/api/horses?sire=chabock"));
    expect(sire.hasFilters).toBe(true);
    expect(sire.countJoinsSql).toContain("LEFT JOIN horses f");
    expect(sire.countJoinsSql).not.toContain("LEFT JOIN horses m");

    const dam = compileRegistryQuery(new URL("https://example.test/api/horses?dam=mare"));
    expect(dam.countJoinsSql).toContain("LEFT JOIN horses m");
    expect(dam.countJoinsSql).not.toContain("LEFT JOIN horses f");
  });


  it("uses the offline role trigram only as a fresh-state candidate prefilter", () => {
    const plan = compileRegistryQuery(new URL("https://example.test/api/horses?owner=morgan%20reed"));
    expect(plan.hasRoleTrigramFilter).toBe(true);
    expect(plan.where).toContain("horse_role_search_trigram");
    expect(plan.where).toContain("analytics_stale");
    expect(plan.where).toContain("EXISTS(SELECT 1 FROM horse_people");
    expect(plan.bindings).toContain('"morgan reed"');
    expect(plan.bindings).toContain("%morgan reed%");

    const short = compileRegistryQuery(new URL("https://example.test/api/horses?owner=al"));
    expect(short.hasRoleTrigramFilter).toBe(false);
    expect(short.where).not.toContain("horse_role_search_trigram");
    expect(short.where).toContain("EXISTS(SELECT 1 FROM horse_people");
  });


  it("exposes a precomputed total only for one exact showcase filter", () => {
    const breed = compileRegistryQuery(new URL("https://example.test/api/horses?breed=Arabian"));
    expect(breed.precomputedCountLookup).toEqual({ key: "breed", value: "Arabian" });

    const imported = compileRegistryQuery(new URL("https://example.test/api/horses?isImported=true"));
    expect(imported.precomputedCountLookup).toEqual({ key: "isImported", value: "1" });

    const combined = compileRegistryQuery(new URL("https://example.test/api/horses?breed=Arabian&sex=Filly"));
    expect(combined.precomputedCountLookup).toBeNull();

    const substring = compileRegistryQuery(new URL("https://example.test/api/horses?place=Tehran"));
    expect(substring.precomputedCountLookup).toBeNull();
  });

  it("enforces the D1 LIKE pattern limit in UTF-8 bytes", () => {
    expect(d1ContainsLikePattern("a".repeat(48))).toHaveLength(50);
    expect(() => d1ContainsLikePattern("a".repeat(49), "name")).toThrow(HttpError);
    expect(() => d1ContainsLikePattern("اسب".repeat(9), "name")).toThrow(HttpError);
  });

  it("sorts names with a Latin-first key that no longer lumps empty Latin names at the head", () => {
    const plan = compileRegistryQuery(new URL("https://example.test/api/horses?sort=name"));
    expect(plan.requestedSort).toBe("name");
    expect(plan.sortKeyLocale).toBe("latin");
    expect(plan.sortSql).toContain("COALESCE(NULLIF(h.name_latin,''),h.name_native)");
    expect(plan.sortSql).toContain("lower(");
    // Leading-noise hygiene: punctuation-prefixed names sort by their first
    // real character; nameless records sort LAST, not first.
    expect(plan.sortSql).toContain("LTRIM(");
    expect(plan.sortSql).toContain("'~'");
    // The collation key must compare in BINARY codepoint order. SQLite already
    // is binary by default; PostgreSQL gets an explicit COLLATE "C" pin because
    // locale collations re-weight punctuation and would break the key grammar.
    expect(plan.sortSql).not.toContain('COLLATE "C"');
    const postgres = compileRegistryQuery(new URL("https://example.test/api/horses?sort=name"), {}, "postgres");
    expect(postgres.sortSql.endsWith(' COLLATE "C"')).toBe(true);
    const postgresPersian = compileRegistryQuery(new URL("https://example.test/api/horses?sort=name&lang=fa"), {}, "postgres");
    expect(postgresPersian.sortSql.endsWith(' COLLATE "C"')).toBe(true);
  });

  it("builds the Persian collation key for Farsi/Arabic viewers so آ sorts first", () => {
    for (const lang of ["fa", "ar"]) {
      const plan = compileRegistryQuery(new URL(`https://example.test/api/horses?sort=name&lang=${lang}`));
      expect(plan.sortKeyLocale).toBe("persian");
      // Native names lead; Latin names are the fallback.
      expect(plan.sortSql).toContain("COALESCE(NULLIF(h.name_native,''),h.name_latin)");
      // The Persian alphabet mapping must cover the letters that plain Unicode
      // codepoint order would misplace (پ چ ژ) plus the Arabic variants.
      expect(plan.sortSql).toContain("REPLACE(");
      expect(plan.sortSql).toContain("'آ','01'");
      expect(plan.sortSql).toContain("'ا','02'");
      expect(plan.sortSql).toContain("'ب','03'");
      expect(plan.sortSql).toContain("'پ','04'");
      expect(plan.sortSql).toContain("'چ','08'");
      expect(plan.sortSql).toContain("'ی','21'");
      expect(plan.sortSql).toContain("'ي','21'");
      expect(plan.sortSql).toContain("'ك','1a'");
    }
    // An unknown or absent locale stays on the Latin key.
    expect(compileRegistryQuery(new URL("https://example.test/api/horses?sort=name&lang=fr")).sortKeyLocale).toBe("latin");
    expect(compileRegistryQuery(new URL("https://example.test/api/horses?sort=name&lang=<script>")).sortKeyLocale).toBe("latin");
    // Non-name sorts are untouched by the locale.
    expect(compileRegistryQuery(new URL("https://example.test/api/horses?sort=year&lang=fa")).sortSql).toBe("h.birth_year");
  });
});
