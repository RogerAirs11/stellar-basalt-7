import { PUBLIC_HORSE_PROFILE_COLUMNS_H, PUBLIC_HORSE_PROFILE_FIELDS, type PublicHorseProfileRow } from "../db/types";
import { normalizePublicHorseRecord, normalizePublicText } from "../db/publicProjection";

type ParentSummary = { id: number; name_latin: string | null; name_native: string | null };
type PersonSummary = { role: string; is_current: number; id: number; name_latin: string | null; name_native: string | null };
export interface CanonicalHorseProfile {
  horse: PublicHorseProfileRow;
  father: ParentSummary | null;
  mother: ParentSummary | null;
  people: PersonSummary[];
  people_truncated: boolean;
}
type JoinedProfile = PublicHorseProfileRow & {
  visible_father_id: number | null; father_name: string | null; father_name_native: string | null;
  visible_mother_id: number | null; mother_name: string | null; mother_name_native: string | null;
};

/** Shared public/AI projection. Withheld parents contribute neither labels nor
 * identifiers to this projection; canonical pointers remain in storage. */
export async function loadCanonicalHorseProfile(db: D1Database, id: number): Promise<CanonicalHorseProfile | null> {
  const row = await db.prepare(`SELECT ${PUBLIC_HORSE_PROFILE_COLUMNS_H},
    f.id visible_father_id,f.name_latin father_name,f.name_native father_name_native,
    m.id visible_mother_id,m.name_latin mother_name,m.name_native mother_name_native
    FROM horses h
    LEFT JOIN horses f ON f.id=h.father_id AND f.deleted_at IS NULL AND f.is_active=1
    LEFT JOIN horses m ON m.id=h.mother_id AND m.deleted_at IS NULL AND m.is_active=1
    WHERE h.id=? AND h.deleted_at IS NULL AND h.is_active=1`).bind(id).first<JoinedProfile>();
  if (!row) return null;
  const people = await db.prepare(`SELECT hp.role,hp.is_current,p.id,p.name_latin,p.name_native
    FROM horse_people hp JOIN people p ON p.id=hp.person_id
    WHERE hp.horse_id=? AND p.deleted_at IS NULL ORDER BY hp.role,p.name_latin,p.id LIMIT 101`)
    .bind(id).all<PersonSummary>();
  const publicValues = Object.fromEntries(PUBLIC_HORSE_PROFILE_FIELDS.map(field => [field, row[field]]));
  const horse = normalizePublicHorseRecord({...publicValues,father_id:row.visible_father_id??null,mother_id:row.visible_mother_id??null}) as PublicHorseProfileRow;
  return {
    horse,
    father: row.visible_father_id == null ? null : { id: row.visible_father_id, name_latin: normalizePublicText(row.father_name), name_native: normalizePublicText(row.father_name_native) },
    mother: row.visible_mother_id == null ? null : { id: row.visible_mother_id, name_latin: normalizePublicText(row.mother_name), name_native: normalizePublicText(row.mother_name_native) },
    people: people.results.slice(0, 100),
    people_truncated: people.results.length > 100,
  };
}
