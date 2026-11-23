import type { D1Database } from "@cloudflare/workers-types";

export async function seedSearchR113Fixture(db: D1Database): Promise<void> {
  await db.prepare(`INSERT INTO horses(id,name_latin,name_native,register_no,birth_year,deleted_at) VALUES
    (1,'Aurora Moon','ماه روشن','R1',2020,NULL),
    (2,'Borealis Sun','خورشید','AURORA MOON',2019,NULL),
    (3,'Aurora Star','ستاره','Aurora Star',2020,NULL),
    (4,'Aurora Ghost',NULL,'DELETED',2020,'2026-01-01 00:00:00'),
    (5,'123',NULL,'000123',2018,NULL),
    (6,'Moon Beam',NULL,'R6',2010,NULL)`).run();
  await db.prepare("UPDATE horses SET father_id=6,mother_id=2 WHERE id=1").run();
  await db.prepare("INSERT INTO people(id,name_latin) VALUES(1,'Alpha'),(2,'Beta'),(3,'Gamma'),(4,'Delta')").run();
  await db.prepare(`INSERT INTO horse_people(horse_id,person_id,role) VALUES
    (1,1,'owner'),(1,3,'breeder'),(2,2,'owner'),(2,3,'breeder'),(3,1,'owner'),(3,4,'breeder')`).run();
}

/** Capture before changing candidate discovery. Full result/score snapshots
 * make a retrieval optimization accountable for its filter and ranking parity. */
export const R113_SEARCH_RECALL_QUERIES = [
  "id:1", "id:1 id:2", "id:۱ id:٢", "id:1 owner:alpha", "id:1 owner:beta",
  "id:1 year:2020", "id:1 year:2019", "id:1 name:aurora", "id:1 name:borealis",
  'id:1 name:"ماه روشن"', "id:1 father:moon", "id:1 mother:borealis",
  "id:1 id:2 owner:alpha", "id:4", "id:999", "id:123", "id:notnumber", "id:1 moon",
  "aurora moon", "AuRoRa MoOn", "Aurora Star", "123", "aurra", "R1", "Moon Beam",
  "name:aurora name:borealis", "owner:alpha owner:beta breeder:gamma", "sire:moon name:aurora",
] as const;
