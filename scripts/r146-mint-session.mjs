#!/usr/bin/env node
// Mint a temp owner session and print the bearer cookie + csrf (debug helper).
// Usage: node scripts/r146-mint-session.mjs hold   -> keep session alive (prints)
//        node scripts/r146-mint-session.mjs drop <sessionId> -> delete it
import crypto from "node:crypto";
const SUPA_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = "gqzglbknkodyasqfrqfv";
const mode = process.argv[2];

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase query failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
}

if (mode === "drop") {
  await query(`DELETE FROM sessions WHERE id='${process.argv[3]}'`);
  console.log("session deleted");
  process.exit(0);
}

const users = await query(`SELECT id FROM users WHERE email='owner@horse-db.app'`);
const userId = users[0].id;
const token = crypto.randomBytes(32).toString("hex");
const csrf = crypto.randomBytes(18).toString("hex");
const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
const sessionId = crypto.randomUUID();
const expiresAt = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
await query(`INSERT INTO sessions(id,user_id,token_hash,csrf_token,expires_at,last_seen_at) VALUES('${sessionId}','${userId}','${tokenHash}','${csrf}','${expiresAt}',NOW())`);
console.log(JSON.stringify({ sessionId, cookie: `horse_registry_session=${token}`, csrf }));
