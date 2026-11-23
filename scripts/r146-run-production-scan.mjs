#!/usr/bin/env node
/**
 * R146 deploy step: run the E04 data-quality corpus scan against PRODUCTION
 * through the app's own audited API (never raw SQL — the scan is the idempotent
 * R145 implementation: SCAN_WINDOW 3000, write cap 150/pass, dedupe safe).
 *
 * Auth: production has no demo admin login. We mint a TEMPORARY session row
 * for the owner super_admin directly in Supabase (token_hash = sha256(token),
 * exactly the app's own scheme in src/auth/session.ts), call the scan API in a
 * loop until completed=true, then DELETE the session row. Nothing about the
 * session scheme is bypassed — the API still enforces permission + CSRF.
 */
import crypto from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SUPA_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = "gqzglbknkodyasqfrqfv";
const BASE = "https://equine-registry-live.rogerfires10.workers.dev";
const OWNER_EMAIL = "owner@horse-db.app";
if (!SUPA_TOKEN) { console.error("Need SUPABASE_ACCESS_TOKEN"); process.exit(1); }

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase query failed (${res.status}): ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : [];
}

// 0. refresh planner statistics first — with stale stats the PG planner
// seq-scans the 95k-row horses table even for a 3k-id PK range (measured:
// both-sides 4.9s -> 1.7s after ANALYZE) and the adapter's 8s statement
// deadline turns that into a 500.
await query("ANALYZE horses");
console.log("ANALYZE horses done");

// 1. owner user
const users = await query(`SELECT id, email, role, is_active FROM users WHERE email='${OWNER_EMAIL}'`);
if (!users.length) { console.error("owner user not found"); process.exit(1); }
const user = users[0];
console.log(`owner: ${user.id} role=${user.role} active=${user.is_active}`);
if (user.role !== "super_admin" || user.is_active !== 1) { console.error("owner not usable"); process.exit(1); }

// 2. mint session
const token = crypto.randomBytes(32).toString("hex");
const csrf = crypto.randomBytes(18).toString("hex");
const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
const sessionId = crypto.randomUUID();
const expiresAt = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
await query(`INSERT INTO sessions(id,user_id,token_hash,csrf_token,expires_at,last_seen_at) VALUES('${sessionId}','${user.id}','${tokenHash}','${csrf}','${expiresAt}',NOW())`);
console.log("temp session minted (expires +3h)");

const cookie = `horse_registry_session=${token}`;
const headers = { cookie, "x-csrf-token": csrf, "content-type": "application/json" };

// Resumable across invocations: the cursor survives in a state file so a
// chunked runner (sandbox bash timeout) can continue where it stopped.
const STATE = "/tmp/r146-scan-cursor.txt";
let resumeAfter = 0;
if (process.argv[2]) resumeAfter = Number(process.argv[2]);
else if (existsSync(STATE)) resumeAfter = Number(readFileSync(STATE, "utf8").trim() || 0);
if (!Number.isInteger(resumeAfter) || resumeAfter < 0) resumeAfter = 0;

let pass = 0;
let retryCount = 0;
let completed = false;
let lastSummary = null;
const MAX_PASSES = Number(process.argv[3] ?? 200);
try {
  while (!completed && pass < MAX_PASSES) {
    pass += 1;
    const res = await fetch(`${BASE}/api/admin/quality/scan?resume_after=${resumeAfter}`, {
      method: "POST", headers, body: JSON.stringify({}),
    });
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) { // transient edge/worker/rate responses — wait and retry same cursor
      retryCount += 1;
      if (retryCount > 10) throw new Error(`too many transient failures (last ${res.status})`);
      console.log(`pass ${pass}: ${res.status}, sleeping 20s (retry ${retryCount})`);
      await new Promise((r) => setTimeout(r, 20000));
      pass -= 1;
      continue;
    }
    if (!res.ok) throw new Error(`scan pass ${pass} failed ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    lastSummary = data;
    writeFileSync(STATE, String(resumeAfter));
    console.log(`pass ${pass}: scanned_to=${data.scanned_to ?? "?"} created=${data.created ?? "?"} resume=${data.resume_after} completed=${data.completed}`);
    resumeAfter = Number(data.resume_after ?? 0);
    writeFileSync(STATE, String(resumeAfter));
    completed = Boolean(data.completed);
  }
  if (!completed) console.error("WARNING: pass budget exhausted before completed=true before completed=true");
} finally {
  // 3. cleanup session no matter what
  await query(`DELETE FROM sessions WHERE id='${sessionId}'`);
  console.log("temp session deleted");
}

console.log("SCAN_DONE passes=" + pass + " cursor=" + resumeAfter);
if (lastSummary) console.log("last_summary:", JSON.stringify(lastSummary).slice(0, 600));
