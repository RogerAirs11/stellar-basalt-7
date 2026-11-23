import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { deriveMigrationSchema } from './lib/migration-schema.mjs';

test('table rebuilds replace old columns without counting transient table names',()=>{
  const schema=deriveMigrationSchema(`CREATE TABLE horses(id INTEGER PRIMARY KEY);CREATE TABLE records(id INTEGER,old_column TEXT);CREATE TABLE records_v2(id INTEGER,horse_id INTEGER REFERENCES horses(id),new_column TEXT);DROP TABLE records;ALTER TABLE records_v2 RENAME TO records;`);
  assert.deepEqual([...schema.keys()].sort(),['horses','records']);
  assert.deepEqual([...schema.get('records').columns.keys()],['id','horse_id','new_column']);
  assert.match(schema.get('records').columns.get('horse_id'),/REFERENCES horses/);
});
test('tracks added, renamed, dropped columns and named/table-level horse foreign keys',()=>{
  const schema=deriveMigrationSchema(`CREATE TABLE "horses"(id INTEGER PRIMARY KEY);CREATE TABLE review(id TEXT, subject INTEGER, CONSTRAINT target FOREIGN KEY(subject) REFERENCES "horses"(id));ALTER TABLE review ADD COLUMN IF NOT EXISTS foal_id INTEGER REFERENCES horses(id);ALTER TABLE review ADD COLUMN IF NOT EXISTS foal_id TEXT;ALTER TABLE review RENAME COLUMN foal_id TO related_horse_id;ALTER TABLE review DROP COLUMN id;`);
  assert.deepEqual([...schema.get('review').columns.keys()],['subject','related_horse_id']);
  assert.match(schema.get('review').columns.get('subject'),/REFERENCES horses/);
  assert.match(schema.get('review').columns.get('related_horse_id'),/REFERENCES horses/);
});
test('ignores commented/literal fake DDL and parses nested, same-line declarations',()=>{
  const schema=deriveMigrationSchema(`-- CREATE TABLE fake(horse_id INTEGER);\nCREATE TABLE IF NOT EXISTS actual(id INTEGER, note TEXT DEFAULT 'comma,); -- not SQL REFERENCES horses(id)', value TEXT CHECK(value IN ('a','b')), CONSTRAINT okay UNIQUE(id,value));/* DROP TABLE actual; CREATE TABLE hidden(id INT); */CREATE TABLE IF NOT EXISTS actual(ignored_column TEXT);CREATE VIRTUAL TABLE search USING fts5(note, tokenize='unicode61');`);
  assert.deepEqual([...schema.keys()],['actual','search']);
  assert.deepEqual([...schema.get('actual').columns.keys()],['id','note','value']);
  assert.doesNotMatch(schema.get('actual').columns.get('note'),/REFERENCES horses/);
  assert.equal(schema.get('search').virtual,true);assert.deepEqual([...schema.get('search').columns.keys()],['note']);
});
test('fails closed on unsupported table-changing syntax',()=>{
  assert.throws(()=>deriveMigrationSchema('CREATE TABLE copied AS SELECT * FROM horses;'),/Unsupported CREATE TABLE/);
  assert.throws(()=>deriveMigrationSchema('CREATE TABLE x(id INT);ALTER TABLE x ALTER COLUMN id TYPE TEXT;'),/Unsupported ALTER TABLE/);
  assert.throws(()=>deriveMigrationSchema('CREATE TABLE x(id INT);ALTER TABLE x ADD CONSTRAINT unique_id UNIQUE(id);'),/Unsupported ALTER TABLE/);
});
test('final tables and columns match a real SQLite execution of the complete migration chain',()=>{
  const root=fileURLToPath(new URL('..',import.meta.url)),dir=join(root,'migrations');
  const sources=readdirSync(dir).filter(name=>/^\d+.*\.sql$/.test(name)).sort().map(name=>readFileSync(join(dir,name),'utf8'));
  const schema=deriveMigrationSchema(sources),db=new DatabaseSync(':memory:');
  try {
    for(const sql of sources)db.exec(sql.replace(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+/gi,'ADD COLUMN '));
    const live=db.prepare('PRAGMA table_list').all().filter(row=>row.schema==='main'&&row.type!=='shadow'&&!row.name.startsWith('sqlite_'));
    assert.deepEqual([...schema].filter(([,t])=>!t.temporary).map(([name])=>name).sort(),live.map(row=>row.name).sort());
    for(const row of live){
      const quoted=row.name.replaceAll('"','""');
      const columns=db.prepare(`PRAGMA table_info("${quoted}")`).all().map(column=>column.name).sort();
      assert.deepEqual([...schema.get(row.name).columns.keys()].sort(),columns,`Column drift for ${row.name}`);
      for(const reference of db.prepare(`PRAGMA foreign_key_list("${quoted}")`).all().filter(key=>key.table==='horses')){
        assert.match(schema.get(row.name).columns.get(reference.from),/REFERENCES horses/,`Missing actual horse reference ${row.name}.${reference.from}`);
      }
    }
  }finally{db.close();}
});
