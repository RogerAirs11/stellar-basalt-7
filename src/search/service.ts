import type { SearchHorseRow } from "../db/types";
import { SEARCH_HORSE_COLUMNS_H } from "../db/types";
import { normalizePublicHorseRecord } from "../db/publicProjection";
import { parseSearchQuery, toFtsExpression, type ParsedQuery } from "./query";
import { fuzzySimilarity, buildFuzzyTrigramExpression } from "./fuzzy";
import { normalizeText, tokens, compactText } from "./normalize";
import { isSupabaseD1Database } from "../db/supabaseCompat";

export interface SearchResult extends SearchHorseRow {
  father_name?: string | null;
  father_name_native?: string | null;
  mother_name?: string | null;
  mother_name_native?: string | null;
  score: number;
  matched_by: string[];
}

export type Candidate = SearchHorseRow & {
  search_text?: string | null;
  public_aliases?: string | null;
  identifiers?: string | null;
  owners?: string | null;
  breeders?: string | null;
  importers?: string | null;
  passport_receivers?: string | null;
  father_name_search?: string | null;
  mother_name_search?: string | null;
  places_search?: string | null;
  breed_search?: string | null;
  imported_from_search?: string | null;
  father_name?: string | null;
  father_name_native?: string | null;
  mother_name?: string | null;
  mother_name_native?: string | null;
};

export async function searchHorses(db: D1Database, query: string, limit = 25): Promise<SearchResult[]> {
  const parsed = parseSearchQuery(query);
  if (!parsed.normalized) return [];
  const postgres = isSupabaseD1Database(db);
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 25, 50));
  const candidateIds = new Set<number>();

  // Strong structured identifiers.
  for (const value of [...(parsed.fields.id ?? []), ...(parsed.freeTokens.length === 1 ? parsed.freeTokens : [])]) {
    if (/^\d+$/.test(value)) {
      const numeric = Number(value);
      if (Number.isSafeInteger(numeric)) candidateIds.add(numeric);
    }
  }
  // An explicit ID constraint already defines the complete candidate set.
  // Keep hydration, every other field predicate, scoring and limits below;
  // only skip the discovery work that cannot add an eligible ID.
  if (!parsed.fields.id?.length) {
    // R159 speed pass: the discovery statements below are independent (each is
    // a bounded, indexed read that only ADDs candidates). Issuing them
    // sequentially serialized 3-6 database round trips per search; running
    // each wave concurrently cuts the search path to roughly one round trip
    // plus the slowest statement. Admission/ordering/scoring semantics are
    // unchanged — Set insertion order still favors the earlier sources.
    // Every discovery statement is billed as a candidate source, so a failure
    // here is NOT benign: when all of them fail (e.g. the D1 daily row-read
    // limit) the candidate set stays empty and the caller gets `results: []`
    // — indistinguishable from a genuine "no such horse". That silently reports
    // a database outage as a wrong answer. Count the failures and let the
    // caller see one instead of an empty result.
    let discoveryFailures = 0;
    let firstDiscoveryError: unknown = null;
    const collect = (task: Promise<{ results: { id: number }[] }>): Promise<void> =>
      task.then((rows) => rows.results.forEach((r) => candidateIds.add(r.id))).catch((error) => {
        // Optional accelerators (FTS/trigram) and even exact/prefix paths may
        // fail on staged deployments; remaining sources still cover the query.
        // Individually survivable — tracked so a total outage is not silent.
        discoveryFailures += 1;
        firstDiscoveryError ??= error;
      });

    const wave1: Promise<void>[] = [];
    for (const year of parsed.fields.year ?? []) {
      if (/^\d{4}$/.test(year)) {
        wave1.push(collect(db.prepare("SELECT id FROM horses WHERE birth_year=? AND deleted_at IS NULL LIMIT 150").bind(Number(year)).all<{ id: number }>()));
      }
    }

    const exactRaw = query.trim();
    wave1.push(collect(db.prepare(`
      SELECT id FROM horses WHERE deleted_at IS NULL AND name_latin = ? COLLATE NOCASE
      UNION
      SELECT id FROM horses WHERE deleted_at IS NULL AND register_no = ? COLLATE NOCASE
      ORDER BY id ASC LIMIT 25
    `).bind(exactRaw, exactRaw).all<{ id: number }>()));

    const ftsExpression = toFtsExpression(parsed);
    if (postgres) {
      const pgFtsExpression = postgresPrefixTsQuery(parsed);
      if (pgFtsExpression) {
        wave1.push(collect(db.prepare(`SELECT horse_id AS id FROM horse_search_source WHERE to_tsvector('simple',all_text) @@ to_tsquery('simple', ?) ORDER BY horse_id LIMIT 160`)
          .bind(pgFtsExpression).all<{ id: number }>()));
      }
    } else if (ftsExpression) {
      wave1.push(collect(db.prepare(`SELECT rowid AS id FROM horse_search_fts WHERE horse_search_fts MATCH ? ORDER BY rank LIMIT 160`)
        .bind(ftsExpression).all<{ id: number }>()));
    }

    if (parsed.normalized.length >= 3) {
      if (postgres) {
        wave1.push(collect(db.prepare(`SELECT horse_id AS id FROM horse_search_source WHERE name_latin % ? OR name_native % ? ORDER BY GREATEST(similarity(COALESCE(name_latin,''), ?), similarity(COALESCE(name_native,''), ?)) DESC, horse_id LIMIT 120`)
          .bind(parsed.normalized, parsed.normalized, parsed.normalized, parsed.normalized).all<{ id: number }>()));
      } else {
        wave1.push(collect(db.prepare(`SELECT rowid AS id FROM horse_search_trigram WHERE horse_search_trigram MATCH ? ORDER BY rank LIMIT 120`)
          .bind(parsed.normalized).all<{ id: number }>()));
      }
    }
    await Promise.allSettled(wave1);

    if (candidateIds.size < 30 && parsed.freeTokens.length) {
      // C4-1 bounded fuzzy candidate generation: typos that break exact/prefix/
      // trigram-phrase matching (e.g. adjacent transpositions share zero
      // trigrams) would otherwise return zero results before the fuzzy scorer
      // ever runs. One extra deterministic, LIMIT-bounded trigram OR-relaxation
      // statement widens recall; admission is still controlled solely by the
      // >= 0.65 Damerau-Levenshtein name scoring below.
      // R151: the same relaxation now runs per free token (bounded to the three
      // longest tokens) for MIXED queries — "rag nar pejman" must still find
      // the horse when only one word carries a typo. Admission is unchanged.
      // R159: wave 2 (prefix + fuzzy + OR-relaxed probes) also runs
      // concurrently — same bounded statements, one round-trip budget.
      const fuzzyTokens = [...parsed.freeTokens]
        .filter((token) => token.length >= 3)
        .sort((a, b) => b.length - a.length)
        .slice(0, 3);
      const wave2: Promise<void>[] = [];
      const first = truncateUtf8(parsed.freeTokens[0]!, 48);
      wave2.push(collect(db.prepare(`SELECT id FROM horses WHERE deleted_at IS NULL AND name_latin LIKE ? COLLATE NOCASE LIMIT 100`)
        .bind(`${first}%`).all<{ id: number }>()));

      for (const token of fuzzyTokens) {
        const first2 = truncateUtf8(token, 48);
        const fuzzyExpression = buildFuzzyTrigramExpression(first2);
        if (!fuzzyExpression && !postgres) continue;
        // LIMIT 260 mirrors the overall candidate ceiling: strong exact/FTS/
        // prefix candidates keep their insertion-order priority, and the
        // fuzzy pool only fills what remains. Bounded statements.
        // R151: on Postgres the owners column is trigram-indexed too
        // (idx_horse_search_owners_trgm), so a typo inside the OWNER part of
        // a mixed query is discoverable, not just name typos.
        if (postgres) {
          wave2.push(collect(db.prepare(`SELECT horse_id AS id FROM horse_search_source WHERE name_latin % ? OR name_native % ? OR owners % ? ORDER BY GREATEST(similarity(COALESCE(name_latin,''), ?), similarity(COALESCE(name_native,''), ?), similarity(COALESCE(owners,''), ?)) DESC, horse_id LIMIT 260`)
            .bind(first2, first2, first2, first2, first2, first2).all<{ id: number }>()));
        } else {
          wave2.push(collect(db.prepare(`SELECT rowid AS id FROM horse_search_trigram WHERE horse_search_trigram MATCH ? ORDER BY rank LIMIT 260`)
            .bind(fuzzyExpression!).all<{ id: number }>()));
        }
      }

      // R151 OR-relaxed recall: the FTS path is conjunctive, so a query that
      // mixes a horse name with an owner name (or drops a middle name) can
      // match no candidate even though every individual word is findable.
      // When the conjunctive + fuzzy paths came up short, probe the SAME
      // indexed columns per token (bounded to the three longest tokens) and
      // let the scorer rank partial readings below complete ones.
      if (parsed.freeTokens.length >= 2) {
        for (const token of fuzzyTokens) {
          const first2 = truncateUtf8(token, 48);
          if (postgres) {
            wave2.push(collect(db.prepare(`SELECT horse_id AS id FROM horse_search_source WHERE to_tsvector('simple',all_text) @@ to_tsquery('simple', ?) ORDER BY horse_id LIMIT 120`)
              .bind(`${first2}:*`).all<{ id: number }>()));
          } else {
            wave2.push(collect(db.prepare(`SELECT rowid AS id FROM horse_search_fts WHERE horse_search_fts MATCH ? ORDER BY rank LIMIT 120`)
              .bind(`all_text:"${first2}"*`).all<{ id: number }>()));
          }
        }
      }
      await Promise.allSettled(wave2);
    }

    // Only an EMPTY result is suspicious. If some sources succeeded, an empty
    // candidate set is a legitimate "no match" and stays a 200 with [].
    if (!candidateIds.size) {
      if (discoveryFailures > 0) {
        const detail = firstDiscoveryError instanceof Error ? firstDiscoveryError.message : String(firstDiscoveryError);
        throw new Error(`search_unavailable: every candidate source failed (${discoveryFailures} errors); first: ${detail}`);
      }
      return [];
    }
  }
  const ids = [...candidateIds].slice(0, 260);
  const candidates: Candidate[] = [];
  // D1 enforces a relatively small SQL variable ceiling. Keep candidate hydration
  // comfortably below it rather than building one large IN (...) statement.
  // R159: hydration batches also run concurrently (typically 1-3 statements).
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += 90) batches.push(ids.slice(start, start + 90).map(String));
  const hydrated = await Promise.all(batches.map((batch) => db.prepare(`
      SELECT ${SEARCH_HORSE_COLUMNS_H.replace("h.father_id", "f.id AS father_id").replace("h.mother_id", "m.id AS mother_id")},
        f.name_latin AS father_name, f.name_native AS father_name_native, m.name_latin AS mother_name, m.name_native AS mother_name_native,
        s.all_text AS search_text, s.identifiers, s.owners, s.breeders,
        ${postgres ? `(SELECT string_agg(a.alias_normalized,' ') FROM horse_aliases a WHERE a.horse_id=h.id)` : `(SELECT group_concat(a.alias_normalized,' ') FROM horse_aliases a WHERE a.horse_id=h.id)`} AS public_aliases,
        (SELECT p.name_latin FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='owner' AND hp.is_current=1 AND p.deleted_at IS NULL ORDER BY lower(p.name_latin) NULLS LAST, p.id LIMIT 1) AS owner_name,
        (SELECT p.name_native FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='owner' AND hp.is_current=1 AND p.deleted_at IS NULL ORDER BY lower(p.name_latin) NULLS LAST, p.id LIMIT 1) AS owner_name_native,
        (SELECT p.name_latin FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='breeder' AND hp.is_current=1 AND p.deleted_at IS NULL ORDER BY lower(p.name_latin) NULLS LAST, p.id LIMIT 1) AS breeder_name,
        (SELECT p.name_native FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='breeder' AND hp.is_current=1 AND p.deleted_at IS NULL ORDER BY lower(p.name_latin) NULLS LAST, p.id LIMIT 1) AS breeder_name_native,
        ${postgres ? `COALESCE((SELECT string_agg(trim(COALESCE(p.name_latin,'') || ' ' || COALESCE(p.name_native,'')),' ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='importer' AND p.deleted_at IS NULL),'')` : `(SELECT group_concat(trim(COALESCE(p.name_latin,'') || ' ' || COALESCE(p.name_native,'')),' ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='importer' AND p.deleted_at IS NULL)`} AS importers,
        ${postgres ? `COALESCE((SELECT string_agg(trim(COALESCE(p.name_latin,'') || ' ' || COALESCE(p.name_native,'')),' ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='passport_receiver' AND p.deleted_at IS NULL),'')` : `(SELECT group_concat(trim(COALESCE(p.name_latin,'') || ' ' || COALESCE(p.name_native,'')),' ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='passport_receiver' AND p.deleted_at IS NULL)`} AS passport_receivers,
        trim(COALESCE(f.name_latin,'') || ' ' || COALESCE(f.name_native,'')) AS father_name_search, trim(COALESCE(m.name_latin,'') || ' ' || COALESCE(m.name_native,'')) AS mother_name_search,
        s.places AS places_search, s.breed AS breed_search, h.imported_from_desc AS imported_from_search
      FROM horses h
      LEFT JOIN horses f ON f.id=h.father_id AND f.deleted_at IS NULL AND f.is_active=1
      LEFT JOIN horses m ON m.id=h.mother_id AND m.deleted_at IS NULL AND m.is_active=1
      LEFT JOIN horse_search_source s ON s.horse_id=h.id
      WHERE h.id IN (${batch.map(() => "?").join(",")}) AND h.deleted_at IS NULL AND h.is_active=1
    `).bind(...batch).all<Candidate>().then((rows) => {
      for (const row of rows.results) {
        // Stale search indexes are candidate accelerators, never authorization.
        // Re-score only public facts: private parent names and full chip/passport
        // namespaces must not leak via matching, ranking or a result's presence.
        row.identifiers = row.register_no ?? "";
        row.search_text = [row.id, row.name_latin, row.name_native, row.register_no, row.birth_year,
          row.father_name_search, row.mother_name_search, row.owners, row.breeders, row.importers,
          row.passport_receivers, row.birth_place_desc, row.breed_desc, row.sex_desc, row.color_desc,
          row.main_strain_desc, row.sub_strain_desc, row.imported_from_search, row.public_aliases].filter(value => value != null).join(" ");
        candidates.push(row);
      }
      return rows;
    })));


  return candidates
    .map((row) => scoreCandidate(row, parsed))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.name_latin.localeCompare(b.name_latin))
    .slice(0, safeLimit);
}


export function postgresPrefixTsQuery(parsed: ParsedQuery): string | null {
  const searchableFields = ["name", "father", "mother", "owner", "breeder", "importer", "passportReceiver", "breed", "place", "color", "strain", "imported"] as const;
  const phrase = (value: string) => tokens(value).map(token => `${token}:*`).join(" & ");
  const clauses = parsed.freeTokens.map(phrase).filter(Boolean);
  for (const field of searchableFields) {
    const alternatives = (parsed.fields[field] ?? []).map(phrase).filter(Boolean);
    if (alternatives.length) clauses.push(`(${alternatives.map(value => `(${value})`).join(" | ")})`);
  }
  return clauses.length ? clauses.join(" & ") : null;
}

function scoreCandidate(row: Candidate, parsed: ParsedQuery): SearchResult {
  if (!candidateMatchesStructuredFields(row, parsed)) return { ...publicHorse(row), score: 0, matched_by: [] };
  const qTokens = parsed.freeTokens;
  const name = normalizeText(row.name_latin);
  const native = normalizeText(row.name_native);
  const haystack = normalizeText(row.search_text ?? [row.name_latin, row.name_native, row.birth_place_desc].join(" "));
  // R151: compact form erases word boundaries, so dropped spaces, merged
  // words and pasted labels ("peiman amanzadeh", "ragnar IR126187") still meet
  // their record. Bounded to the already-normalized text.
  const compactHay = compactText(haystack);
  const hayTokens = new Set(tokens(haystack));
  let score = 0;
  const matched: string[] = [];

  const normalizedFree = normalizeText(qTokens.join(" "));
  if (normalizedFree && (name === normalizedFree || native === normalizedFree)) { score += 120; matched.push("exact-name"); }
  if (normalizedFree && name.startsWith(normalizedFree)) { score += 70; matched.push("name-prefix"); }
  if (normalizedFree && haystack.includes(normalizedFree)) { score += 28; matched.push("phrase"); }
  if (normalizedFree && compactHay.includes(compactText(normalizedFree))) { score += 30; matched.push("compact-phrase"); }

  const fieldTokenSets = [tokens(row.owners), tokens(row.breeders), tokens(row.places_search), tokens(row.father_name_search), tokens(row.mother_name_search)];
  let tokensMatched = 0;
  for (const token of qTokens) {
    if (hayTokens.has(token)) { score += 18; tokensMatched += 1; continue; }
    if (token.length >= 4 && compactHay.includes(token)) { score += 12; tokensMatched += 1; matched.push("compact-token"); continue; }
    const nameScore = Math.max(...[...tokens(name), ...tokens(native)].map((candidate) => fuzzySimilarity(token, candidate)), 0);
    if (nameScore >= 0.65) { score += 18 * nameScore; tokensMatched += 1; matched.push("fuzzy-name"); continue; }
    // R151: a typo inside any other recorded field (owner, breeder, place,
    // parents) no longer zeroes the token — bounded in-memory fuzzy against
    // those field token sets keeps mixed queries on the right horse.
    const fieldScoreValue = Math.max(...fieldTokenSets.flatMap((set) => set.map((candidate) => fuzzySimilarity(token, candidate))), 0);
    if (fieldScoreValue >= 0.7) { score += 14 * fieldScoreValue; tokensMatched += 1; matched.push("fuzzy-field"); continue; }
    if (haystack.includes(token)) { score += 5; tokensMatched += 1; }
  }
  // R151: every query word found its home (any field, fuzzy or compact) —
  // reward the complete reading so half-typed mixed queries rank the true
  // record above partial look-alikes.
  if (qTokens.length >= 2 && tokensMatched === qTokens.length) { score += 24; matched.push("all-words"); }

  for (const value of parsed.fields.name ?? []) {
    const v = normalizeText(value); if (name.includes(v) || native.includes(v)) { score += 65; matched.push("name-field"); }
  }
  score += fieldScore(row.owners, parsed.fields.owner, 34, "owner", matched);
  score += fieldScore(row.breeders, parsed.fields.breeder, 34, "breeder", matched);
  score += fieldScore(row.importers, parsed.fields.importer, 34, "importer", matched);
  score += fieldScore(row.passport_receivers, parsed.fields.passportReceiver, 34, "passport-receiver", matched);
  score += fieldScore(row.father_name_search, parsed.fields.father, 42, "father", matched);
  score += fieldScore(row.mother_name_search, parsed.fields.mother, 42, "mother", matched);
  score += fieldScore(row.places_search, parsed.fields.place, 24, "place", matched);
  score += fieldScore(row.breed_search, parsed.fields.breed, 24, "breed", matched);
  score += fieldScore(row.color_desc, parsed.fields.color, 26, "color", matched);
  score += fieldScore([row.main_strain_desc, row.sub_strain_desc].filter(Boolean).join(" "), parsed.fields.strain, 28, "strain", matched);
  score += fieldScore(row.imported_from_search, parsed.fields.imported, 28, "import-origin", matched);

  const idValues = parsed.fields.id ?? [];
  if (idValues.includes(String(row.id)) || (qTokens.length === 1 && qTokens[0] === String(row.id))) { score += 150; matched.push("horse-id"); }
  const exactInput = parsed.raw.trim().toLowerCase();
  if (String(row.register_no ?? "").toLowerCase() === exactInput) { score += 140; matched.push("register-no"); }
  // R151: pasted or spacing-mangled register values still hit — "ir 126 187"
  // and "ir126187" are the same serial once word boundaries are erased.
  if (row.register_no && exactInput && compactText(row.register_no) === compactText(exactInput)) { score += 130; matched.push("register-no"); }
  if (exactInput && normalizeText(row.identifiers).includes(normalizeText(exactInput))) { score += 120; matched.push("identifier"); }
  if (row.birth_year && (parsed.fields.year ?? []).includes(String(row.birth_year))) { score += 35; matched.push("birth-year"); }
  else if (row.birth_year && qTokens.includes(String(row.birth_year))) { score += 20; matched.push("birth-year"); }

  return { ...publicHorse(row), father_name: row.father_name ?? null, father_name_native: row.father_name_native ?? null, mother_name: row.mother_name ?? null, mother_name_native: row.mother_name_native ?? null, score: Math.round(score * 100) / 100, matched_by: [...new Set(matched)] };
}


export function candidateMatchesStructuredFields(row: Candidate, parsed: ParsedQuery): boolean {
  const anyContains = (haystack: string | null | undefined, values: string[] | undefined) => {
    if (!values?.length) return true;
    const hay = normalizeText(haystack);
    return values.some((value) => { const needle = normalizeText(value); return Boolean(needle) && hay.includes(needle); });
  };
  const exactAny = (actual: string | number | null | undefined, values: string[] | undefined) =>
    !values?.length || values.some((value) => String(actual ?? "") === String(value));

  if (!exactAny(row.id, parsed.fields.id)) return false;
  if (!exactAny(row.birth_year, parsed.fields.year)) return false;
  if (parsed.fields.name?.length && !parsed.fields.name.some((value) => {
    const needle = normalizeText(value);
    return normalizeText(row.name_latin).includes(needle) || normalizeText(row.name_native).includes(needle);
  })) return false;
  if (!anyContains(row.owners, parsed.fields.owner)) return false;
  if (!anyContains(row.breeders, parsed.fields.breeder)) return false;
  if (!anyContains(row.importers, parsed.fields.importer)) return false;
  if (!anyContains(row.passport_receivers, parsed.fields.passportReceiver)) return false;
  if (!anyContains(row.father_name_search, parsed.fields.father)) return false;
  if (!anyContains(row.mother_name_search, parsed.fields.mother)) return false;
  if (!anyContains(row.places_search, parsed.fields.place)) return false;
  if (!anyContains(row.breed_search, parsed.fields.breed)) return false;
  if (!anyContains(row.color_desc, parsed.fields.color)) return false;
  if (!anyContains([row.main_strain_desc, row.sub_strain_desc].filter(Boolean).join(" "), parsed.fields.strain)) return false;
  if (!anyContains(row.imported_from_search, parsed.fields.imported)) return false;
  return true;
}

function fieldScore(hay: string | null | undefined, needles: string[] | undefined, weight: number, label: string, matched: string[]): number {
  if (!hay || !needles?.length) return 0;
  const h = normalizeText(hay);
  let score = 0;
  for (const value of needles) {
    const v = normalizeText(value);
    if (v && h.includes(v)) { score += weight; matched.push(label); }
  }
  return score;
}

function publicHorse(row: Candidate): SearchHorseRow {
  return normalizePublicHorseRecord({
    id: row.id, register_no: row.register_no, microchip_no: row.microchip_no ?? null, name_latin: row.name_latin, name_native: row.name_native,
    father_id: row.father_id, mother_id: row.mother_id, birth_year: row.birth_year, birth_place_desc: row.birth_place_desc,
    breed_desc: row.breed_desc, sex_desc: row.sex_desc, color_desc: row.color_desc, main_strain_desc: row.main_strain_desc,
    sub_strain_desc: row.sub_strain_desc, is_active: row.is_active, is_dead: row.is_dead,
    owner_name: row.owner_name ?? null, owner_name_native: row.owner_name_native ?? null,
    breeder_name: row.breeder_name ?? null, breeder_name_native: row.breeder_name_native ?? null,
  });
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let out = "";
  for (const char of value) {
    if (encoder.encode(out + char).length > maxBytes) break;
    out += char;
  }
  return out;
}
