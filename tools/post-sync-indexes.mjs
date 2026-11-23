// Post-sync: rebuild FTS/trigram search indexes + verify + checkpoint.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOCAL = path.join(HERE, 'data/generated/horse-registry.sqlite');
const local = new DatabaseSync(LOCAL);
local.exec('PRAGMA journal_mode=WAL');

console.log('Rebuilding horse_search_fts from horse_search_source...');
local.exec('DELETE FROM horse_search_fts');
local.exec(`INSERT INTO horse_search_fts(rowid,name_latin,name_native,identifiers,owners,breeders,father_name,mother_name,places,breed,all_text)
  SELECT horse_id,name_latin,name_native,identifiers,owners,breeders,father_name,mother_name,places,breed,all_text FROM horse_search_source`);
console.log('Rebuilding horse_search_trigram...');
local.exec('DELETE FROM horse_search_trigram');
local.exec('INSERT INTO horse_search_trigram(rowid,all_text) SELECT horse_id,all_text FROM horse_search_source');
console.log('Rebuilding horse_role_search_trigram...');
local.exec('DELETE FROM horse_role_search_trigram');
local.exec(`WITH role_text AS (
    SELECT hp.horse_id,hp.role,
      GROUP_CONCAT(TRIM(COALESCE(p.name_latin,'') || CHAR(31) || COALESCE(p.name_native,'')), CHAR(30)) AS text_value
      FROM horse_people hp JOIN people p ON p.id=hp.person_id
      WHERE p.deleted_at IS NULL AND hp.role IN ('owner','breeder','importer','passport_receiver')
      GROUP BY hp.horse_id,hp.role
  ), pivoted AS (
    SELECT h.id AS horse_id,
      COALESCE(MAX(CASE WHEN rt.role='owner' THEN rt.text_value END),'') AS owner,
      COALESCE(MAX(CASE WHEN rt.role='breeder' THEN rt.text_value END),'') AS breeder,
      COALESCE(MAX(CASE WHEN rt.role='importer' THEN rt.text_value END),'') AS importer,
      COALESCE(MAX(CASE WHEN rt.role='passport_receiver' THEN rt.text_value END),'') AS passport_receiver
      FROM horses h LEFT JOIN role_text rt ON rt.horse_id=h.id
      WHERE h.deleted_at IS NULL GROUP BY h.id
  )
  INSERT INTO horse_role_search_trigram(rowid,owner,breeder,importer,passport_receiver)
  SELECT horse_id,owner,breeder,importer,passport_receiver FROM pivoted`);

console.log('FINAL COUNTS:');
for (const t of ['horses', 'people', 'horse_people', 'horse_search_fts', 'horse_search_trigram', 'horse_role_search_trigram', 'analytics_snapshots', 'registry_filter_counts']) {
  const n = local.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
  console.log(`  ${t}: ${n}`);
}
const probe = local.prepare("SELECT h.id, h.name_latin FROM horses h JOIN horse_search_fts f ON f.rowid=h.id WHERE horse_search_fts MATCH ? LIMIT 3").all('name_latin:^mar*');
console.log('SEARCH PROBE:', JSON.stringify(probe));
local.exec('PRAGMA wal_checkpoint(TRUNCATE)');
local.close();
console.log('POST_SYNC_DONE');
