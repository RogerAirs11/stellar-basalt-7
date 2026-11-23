require('./lib/register-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sql = require('../src/db/sqlLex.ts');
const { sqliteSqlToPostgres: pg, stripLeadingComments, appendSqlClause } = require('../src/db/sqliteSqlToPostgres.ts');
const { openLocalSqlite } = require('../src/db/localSqlite.ts');
const source = "SELECT 'LIKE CURRENT_TIMESTAMP IFNULL(?)' AS txt, \"CURRENT_TIMESTAMP\" AS name, ? AS bound -- ? LIKE CURRENT_TIMESTAMP\n/* ? JSON(?) */";
test('R98 translation preserves string/identifier/comment content and only real bind positions', () => { const out = pg(source); assert.ok(out.includes("'LIKE CURRENT_TIMESTAMP IFNULL(?)'")); assert.ok(out.includes('"CURRENT_TIMESTAMP"')); assert.ok(out.includes('$1 AS bound')); assert.ok(out.includes('-- ? LIKE CURRENT_TIMESTAMP')); assert.ok(out.includes('/* ? JSON(?) */')); assert.equal(sql.sqlParameters(source).length, 1); });
test('R98 doubled quotes and commas in nested JSON are not syntax', () => { const out = pg("SELECT json_object('LIKE,?','it''s (CURRENT_TIMESTAMP)', 'nested',json(json_object('x',?)))"); assert.ok(out.includes("'LIKE,?'")); assert.ok(out.includes("'it''s (CURRENT_TIMESTAMP)'")); assert.equal((out.match(/\$1/g) || []).length, 1); assert.ok(out.includes('jsonb_build_object')); });
test('R98 quoted literal before COLLATE survives', () => { assert.equal(pg("SELECT x FROM t WHERE x LIKE 'CURRENT_TIMESTAMP' COLLATE NOCASE"), "SELECT x FROM t WHERE x ILIKE 'CURRENT_TIMESTAMP'"); });
test('R98 comments and whitespace are stripped repeatedly', () => assert.equal(stripLeadingComments(' \n -- a\n /* b */ \n SELECT 1'), 'SELECT 1'));
test('R98 ordered and anonymous bind indexes follow SQLite slots', () => { assert.equal(pg('SELECT ?2, ?1, ?, ?2'), 'SELECT $2, $1, $3, $2'); assert.deepEqual(sql.anonymousBindings('SELECT ?2, ?1, ?, ?2', ['a', 'b', 'c']), { sql: 'SELECT ?, ?, ?, ?', values: ['b', 'a', 'c', 'b'] }); });
test('R98 native SQLite rejects missing values instead of silent NULL', async () => { const db = openLocalSqlite(':memory:'); await assert.rejects(db.prepare('SELECT ?, ?').bind(1).first(), /expected 2, received 1/); await assert.rejects(db.prepare('SELECT ?').bind(1, 2).first(), /expected 1, received 2/); });
test('R98 native ordered binding correctly repeats and ignores comment placeholders', async () => { const db = openLocalSqlite(':memory:'); assert.deepEqual({ ...await db.prepare('SELECT ?2 AS a, ?1 AS b, ? AS c, ?2 AS d -- ?').bind('one', 'two', 'three').first() }, { a: 'two', b: 'one', c: 'three', d: 'two' }); });
test('R98 missing binding in batch rolls back earlier write', async () => { const db = openLocalSqlite(':memory:'); await db.exec('CREATE TABLE sample(id INTEGER)'); await assert.rejects(db.batch([db.prepare('INSERT INTO sample VALUES(?)').bind(1), db.prepare('INSERT INTO sample VALUES(?)')]), /binding count mismatch/); assert.equal((await db.prepare('SELECT count(*) AS n FROM sample').first()).n, 0); });
for (const q of ['WITH changed AS (DELETE FROM horses RETURNING *) SELECT * FROM changed', 'SELECT 1; DELETE FROM horses', 'EXPLAIN ANALYZE UPDATE horses SET name_latin = 1', 'SELECT * INTO stolen FROM horses', 'WITH changed AS (UPDATE horses SET name_latin=1 RETURNING *) SELECT * FROM changed', 'SELECT * FROM horses FOR UPDATE', '/* ok */ CALL dangerous()'])
    test(`R98 readonly guard rejects ${q}`, () => assert.throws(() => sql.assertReadOnlySql(q), /read-only/));
for (const q of ["SELECT 'DELETE;UPDATE' AS note -- DELETE FROM t", '/* UPDATE t */ SELECT 1; -- done', 'WITH q AS (SELECT 1) SELECT * FROM q', 'SELECT "UPDATE" FROM t', 'EXPLAIN SELECT * FROM horses', 'SHOW server_version'])
    test(`R98 readonly lexical guard permits catalog read ${q}`, () => assert.doesNotThrow(() => sql.assertReadOnlySql(q)));
test('R98 dollar-quoted text is protected', () => { const q = 'SELECT $txt$DELETE ? CURRENT_TIMESTAMP$txt$, ?'; assert.equal(pg(q), 'SELECT $txt$DELETE ? CURRENT_TIMESTAMP$txt$, $1'); sql.assertReadOnlySql(q); });
for (const q of ["SELECT 'unclosed", 'SELECT /* unfinished', 'SELECT $$ unfinished'])
    test(`R98 malformed quoted SQL fails closed ${q}`, () => assert.throws(() => sql.sqlCodeMask(q), /Unterminated/));
test('R98 insert-ignore clause is before RETURNING and trailing comments', () => { assert.equal(pg("INSERT OR IGNORE INTO t(x) VALUES(?) RETURNING id; -- KEEP ?"), 'INSERT INTO t(x) VALUES($1) ON CONFLICT DO NOTHING RETURNING id; -- KEEP ?'); assert.equal(pg("INSERT OR IGNORE INTO t(x) VALUES('ON CONFLICT') -- KEEP"), "INSERT INTO t(x) VALUES('ON CONFLICT') ON CONFLICT DO NOTHING -- KEEP"); });
test('R98 adapter returning appends before a trailing comment', () => assert.equal(appendSqlClause('INSERT INTO t VALUES($1); -- keep', 'RETURNING id'), 'INSERT INTO t VALUES($1) RETURNING id; -- keep'));
test('R98 datetime and existing translation contracts', () => { assert.equal(pg("SELECT datetime('now') AS now_text"), "SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS now_text"); assert.equal(pg('SELECT id FROM users WHERE email = ? COLLATE NOCASE'), 'SELECT id FROM users WHERE LOWER(email)=LOWER($1)'); assert.ok(pg("SELECT datetime('now','-10 minutes')").includes("now() AT TIME ZONE 'UTC' + '-10 minutes'::interval")); assert.equal(pg('SELECT group_concat(alias) FROM t WHERE id=?'), "SELECT string_agg(alias, ',') FROM t WHERE id=$1"); });
test('R98 unsupported datetime semantics are not silently approximated', () => assert.throws(() => pg("SELECT datetime('now','start of day')"), /Unsupported datetime modifier/));
const { publicSnapshotReadEligible: eligible } = require('../src/db/publicSnapshotPolicy.ts');
for (const path of ['/api/billing/orders', '/api/service-requests/inbox', '/api/workspaces', '/api/directory/persons/1', '/api/horses/1/genetics', '/api/horses/1/media', '/api/market/mine', '/api/new-unreviewed-read'])
    test(`R98 private or mutable route never fails over ${path}`, () => assert.equal(eligible(new Request('https://registry.test' + path), 'canonical_read'), false));
test('R98 explicitly public anonymous snapshot can fail over', () => assert.equal(eligible(new Request('https://registry.test/api/search?q=horse'), 'canonical_read'), true));
for (const headers of [{ cookie: 'session=old' }, { authorization: 'Bearer stale' }, { 'x-api-key': 'key' }])
    test(`R98 authenticated read cannot use snapshot failover ${Object.keys(headers)[0]}`, () => assert.equal(eligible(new Request('https://registry.test/api/search', { headers }), 'canonical_read'), false));
test('R98 hybrid AI and writes cannot use stale snapshot authority', () => { assert.equal(eligible(new Request('https://registry.test/api/search', { method: 'POST' }), 'ai_state_write_canonical_read'), false); assert.equal(eligible(new Request('https://registry.test/api/search?token=private'), 'canonical_read'), false); });
test('R98 unsupported calendar interval rollover is not presented as dialect parity', () => {
    for (const interval of ['+1 month', '-2 years'])
        assert.throws(() => pg(`SELECT datetime('2024-01-31','${interval}')`), /Unsupported datetime modifier/);
});
test('R98 comment-separated insert-ignore fails explicitly rather than producing invalid translated SQL', () => {
    assert.throws(() => pg('INSERT/* comment */OR IGNORE INTO t VALUES(?)'), /Unsupported comment-separated/);
});
