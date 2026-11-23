// R153 shared lib: Supabase (canonical) + Cloudflare D1 (failover) clients
import postgres from "postgres";
import fs from "fs";

export const supa = postgres(process.env.SUPA_URL, { max: 1, prepare: false });
await supa`set statement_timeout = 0`;

const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
export const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${process.env.D1_DB_ID}/query`;

export async function d1(sql, params = []) {
  const res = await fetch(D1_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + CF_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const json = await res.json();
  if (!json.success) {
    const msg = JSON.stringify(json.errors).slice(0, 300);
    throw new Error("D1 error: " + msg);
  }
  return json.result;
}

// literal-SQL escaping (D1 has a 100-bound-param limit, so multi-row VALUES uses literals)
export const esc = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "object") v = JSON.stringify(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
};

// build a multi-row INSERT OR REPLACE statement from column list + rows
export function insertValues(table, cols, rows, { orReplace = true } = {}) {
  const head = `INSERT ${orReplace ? "OR REPLACE" : "OR IGNORE"} INTO ${table} (${cols.join(",")}) VALUES `;
  const stmts = [];
  for (const r of rows) {
    stmts.push(head + "(" + cols.map((c) => esc(r[c])).join(",") + ");");
  }
  return stmts;
}

// send N single/multi statements per request, tolerating D1 hiccups with retry
export async function d1Statements(statements, { perRequest = 40, retries = 3 } = {}) {
  let done = 0;
  for (let i = 0; i < statements.length; i += perRequest) {
    const batch = statements.slice(i, i + perRequest).join("\n");
    let attempt = 0;
    for (;;) {
      try {
        await d1(batch);
        break;
      } catch (e) {
        attempt++;
        if (attempt > retries) throw e;
        if (String(e.message).includes("was reset")) {
          console.log("  D1 auto-reset detected — aborting run (rerun to resume)");
          throw e;
        }
        console.log(`  retry ${attempt} after error: ${e.message.slice(0, 120)}`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    done += Math.min(perRequest, statements.length - i);
    if (done % (perRequest * 20) === 0 || done === statements.length) console.log(`  statements ${done}/${statements.length}`);
  }
  return done;
}

export function loadState(name) {
  const f = `/home/z/my-project/horse-registry/scripts/r153-state-${name}.json`;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return {}; }
}
export function saveState(name, s) {
  fs.writeFileSync(`/home/z/my-project/horse-registry/scripts/r153-state-${name}.json`, JSON.stringify(s));
}
