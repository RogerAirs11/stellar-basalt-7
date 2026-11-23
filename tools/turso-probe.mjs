// Probe Turso latency: distinguish query-time vs transfer-time.
import { createClient } from '@tursodatabase/serverless/compat';

const url = 'libsql://horse-registry-v5-serving-optimized-20260909-rogerairs11.aws-us-east-1.turso.io';
const remote = createClient({ url, authToken: process.env.TOK });

async function timed(label, fn) {
  const t = Date.now();
  const r = await fn();
  console.log(`${label}: ${(Date.now() - t) / 1000}s`, r);
}

await timed('COUNT horses', async () => {
  const r = await remote.execute('SELECT COUNT(*) AS n FROM horses');
  return r.rows[0].n;
});
await timed('SELECT 50 rows horses', async () => {
  const r = await remote.execute('SELECT * FROM horses LIMIT 50');
  return r.rows.length + ' rows';
});
await timed('SELECT 2000 rows horses', async () => {
  const r = await remote.execute('SELECT rowid AS __rid, * FROM horses WHERE rowid > 15000 ORDER BY rowid LIMIT 2000');
  return r.rows.length + ' rows';
});
await timed('COUNT horse_people', async () => {
  const r = await remote.execute('SELECT COUNT(*) AS n FROM horse_people');
  return r.rows[0].n;
});
await timed('COUNT people', async () => {
  const r = await remote.execute('SELECT COUNT(*) AS n FROM people');
  return r.rows[0].n;
});
await timed('COUNT horse_search_source', async () => {
  const r = await remote.execute('SELECT COUNT(*) AS n FROM horse_search_source');
  return r.rows[0].n;
});
