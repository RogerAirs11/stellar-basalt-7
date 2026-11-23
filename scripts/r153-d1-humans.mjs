// R153 D1 sync stage 1: racing_humans — create table + full sync from Supabase (2,910 rows)
import { supa, d1, d1Statements } from "./r153-lib.mjs";

const COLS = ["human_id", "name", "role", "certificates", "starts", "p1", "p2", "p3", "weight", "nickname", "insurance_date", "last_weight_update", "has_permission", "iban_status", "source", "created_at"];

const DDL = `CREATE TABLE IF NOT EXISTS racing_humans (
  human_id TEXT PRIMARY KEY, name TEXT, role TEXT, certificates TEXT,
  starts INTEGER, p1 INTEGER, p2 INTEGER, p3 INTEGER,
  weight NUMERIC, nickname TEXT, insurance_date TEXT, last_weight_update TEXT,
  has_permission TEXT, iban_status TEXT, source TEXT, created_at TEXT);`;

console.log("creating racing_humans in D1 (if missing)...");
await d1(DDL);
console.log("fetching humans from Supabase...");
const rows = await supa`select ${supa(COLS)} from racing_humans`;
console.log(`humans: ${rows.length}`);

const { insertValues } = await import("./r153-lib.mjs");
const stmts = insertValues("racing_humans", COLS, rows, { orReplace: true });
console.log(`statements: ${stmts.length}`);
await d1Statements(stmts, { perRequest: 40 });

const v = await d1("select count(*) n from racing_humans");
console.log("D1 racing_humans now:", v[0].results[0].n);
await supa.end();
