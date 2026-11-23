import { materializePendingMutationSearchWork } from "../audit/mutationJournal";
import { normalizeText } from "./normalize";
import { isSupabaseD1Database } from "../db/supabaseCompat";

type SearchSource = {
  id: number; name_latin: string; name_native: string | null;
  register_no: string | null; uel_no: string | null; life_number: string | null;
  birth_place_desc: string | null; imported_from_desc: string | null; birth_year: number | null;
  sex_desc: string | null; color_desc: string | null; breed_desc: string | null;
  main_strain_desc: string | null; sub_strain_desc: string | null;
  father_name: string | null; mother_name: string | null; owners: string | null; breeders: string | null;
  importers: string | null; passport_receivers: string | null; aliases: string | null;
};

export async function refreshHorseSearch(db: D1Database, horseId: number): Promise<void> {
  const row = await db.prepare(`
    SELECT h.id,h.name_latin,h.name_native,h.register_no,h.uel_no,h.life_number,
           h.birth_place_desc,h.imported_from_desc,h.birth_year,h.sex_desc,h.color_desc,h.breed_desc,h.main_strain_desc,h.sub_strain_desc,
           trim(COALESCE(f.name_latin,'') || ' ' || COALESCE(f.name_native,'')) AS father_name,
           trim(COALESCE(m.name_latin,'') || ' ' || COALESCE(m.name_native,'')) AS mother_name,
           (SELECT group_concat(trim(COALESCE(p.name_latin,'') || ' ' || COALESCE(p.name_native,'')),' ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='owner' AND p.deleted_at IS NULL) AS owners,
           (SELECT group_concat(trim(COALESCE(p.name_latin,'') || ' ' || COALESCE(p.name_native,'')),' ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='breeder' AND p.deleted_at IS NULL) AS breeders,
           (SELECT group_concat(trim(COALESCE(p.name_latin,'') || ' ' || COALESCE(p.name_native,'')),' ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='importer' AND p.deleted_at IS NULL) AS importers,
           (SELECT group_concat(trim(COALESCE(p.name_latin,'') || ' ' || COALESCE(p.name_native,'')),' ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='passport_receiver' AND p.deleted_at IS NULL) AS passport_receivers,
           (SELECT group_concat(a.alias,' ') FROM horse_aliases a WHERE a.horse_id=h.id) AS aliases
    FROM horses h LEFT JOIN horses f ON f.id=h.father_id AND f.deleted_at IS NULL AND f.is_active=1 LEFT JOIN horses m ON m.id=h.mother_id AND m.deleted_at IS NULL AND m.is_active=1
    WHERE h.id=? AND h.deleted_at IS NULL AND h.is_active=1
  `).bind(horseId).first<SearchSource>();

  // Delete the FTS rows before their external-content source row. This ordering
  // is valid for the original standalone FTS layout and is required by the
  // optimized D1 serving layout, where both indexes use horse_search_source as
  // external content. Deleting the source first can leave stale FTS postings.
  // Postgres (Supabase) has no FTS5 shadow tables — search is served from
  // horse_search_source via tsvector + pg_trgm — so only the source row is
  // refreshed there.
  if (isSupabaseD1Database(db)) {
    await db.batch([
      db.prepare("DELETE FROM horse_search_source WHERE horse_id=?").bind(horseId),
    ]);
  } else {
    await db.batch([
      db.prepare("DELETE FROM horse_search_fts WHERE rowid=?").bind(horseId),
      db.prepare("DELETE FROM horse_search_trigram WHERE rowid=?").bind(horseId),
      db.prepare("DELETE FROM horse_search_source WHERE horse_id=?").bind(horseId),
    ]);
  }
  if (!row) return;

  const nameLatin = normalizeText(row.name_latin);
  const nameNative = normalizeText(row.name_native);
  const identifiers = normalizeText([row.register_no].filter(Boolean).join(" "));
  const owners = normalizeText(row.owners);
  const breeders = normalizeText(row.breeders);
  const importers = normalizeText(row.importers);
  const passportReceivers = normalizeText(row.passport_receivers);
  const aliases = normalizeText(row.aliases);
  const fatherName = normalizeText(row.father_name);
  const motherName = normalizeText(row.mother_name);
  const places = normalizeText([row.birth_place_desc,row.imported_from_desc].filter(Boolean).join(" "));
  const breed = normalizeText([row.breed_desc,row.main_strain_desc,row.sub_strain_desc].filter(Boolean).join(" "));
  const allText = normalizeText([row.id,nameLatin,nameNative,identifiers,owners,breeders,importers,passportReceivers,aliases,fatherName,motherName,places,breed,row.birth_year,row.sex_desc,row.color_desc].filter((v) => v !== null && v !== undefined).join(" "));

  if (isSupabaseD1Database(db)) {
    await db.batch([
      db.prepare(`INSERT INTO horse_search_source(horse_id,name_latin,name_native,identifiers,owners,breeders,father_name,mother_name,places,breed,all_text)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(row.id,nameLatin,nameNative,identifiers,owners,breeders,fatherName,motherName,places,breed,allText),
    ]);
  } else {
    await db.batch([
      db.prepare(`INSERT INTO horse_search_source(horse_id,name_latin,name_native,identifiers,owners,breeders,father_name,mother_name,places,breed,all_text)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(row.id,nameLatin,nameNative,identifiers,owners,breeders,fatherName,motherName,places,breed,allText),
      db.prepare(`INSERT INTO horse_search_fts(rowid,name_latin,name_native,identifiers,owners,breeders,father_name,mother_name,places,breed,all_text)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(row.id,nameLatin,nameNative,identifiers,owners,breeders,fatherName,motherName,places,breed,allText),
      db.prepare("INSERT INTO horse_search_trigram(rowid,all_text) VALUES(?,?)").bind(row.id,allText),
    ]);
  }
}

export async function queueChildSearchRefresh(db: D1Database, parentId: number, reason = "parent_name_changed"): Promise<number> {
  const result = await db.prepare(`
    INSERT OR IGNORE INTO horse_search_reindex_queue(horse_id,reason)
    SELECT id,? FROM horses WHERE deleted_at IS NULL AND (father_id=? OR mother_id=?)
  `).bind(reason,parentId,parentId).run();
  return Number(result.meta.changes ?? 0);
}

export async function processSearchReindexQueue(db: D1Database, limit = 3): Promise<{ processed: number; failed: number; remaining: number }> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 3)) : 3;
  await materializePendingMutationSearchWork(db, safeLimit);
  const jobs = await db.prepare("SELECT horse_id FROM horse_search_reindex_queue ORDER BY queued_at LIMIT ?").bind(safeLimit).all<{ horse_id: number }>();
  let processed = 0; let failed = 0;
  for (const job of jobs.results) {
    try {
      await refreshHorseSearch(db, job.horse_id);
      await db.batch([
        db.prepare("DELETE FROM horse_search_reindex_queue WHERE horse_id=?").bind(job.horse_id),
        db.prepare(`UPDATE canonical_mutation_log SET search_status='complete',updated_at=CURRENT_TIMESTAMP WHERE entity_type='horse' AND search_status='pending' AND (CAST(entity_id AS INTEGER)=? OR id=(SELECT last_mutation_id FROM horses WHERE id=?))`).bind(job.horse_id,job.horse_id),
      ]);
      processed++;
    } catch (cause) {
      failed++;
      const message = cause instanceof Error ? cause.message.slice(0,500) : "unknown reindex error";
      await db.prepare("UPDATE horse_search_reindex_queue SET attempts=attempts+1,last_error=? WHERE horse_id=?").bind(message,job.horse_id).run();
    }
  }
  const row = await db.prepare("SELECT COUNT(*) AS count FROM horse_search_reindex_queue").first<{ count: number }>();
  return { processed, failed, remaining: Number(row?.count ?? 0) };
}
