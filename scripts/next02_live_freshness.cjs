#!/usr/bin/env node
/**
 * NEXT-02 — LIVE authority-read freshness test through the deployed Worker.
 *
 * Master-AI acceptance (R106 plan Slice F / BACKLOG NEXT-02):
 *   1. "Login, revoke session/staff permission, immediately repeat the same
 *      read/command: it must be refused."
 *   2. "Withdraw consent immediately before ... delivery: the sender must not
 *      disclose the withdrawn content." (read-side leg: withdrawn directory
 *      consent must hide the profile on the very next public read)
 *   3. "An unchanged public-read cache key cannot cause a private authorization
 *      decision to use stale state."
 *
 * Method: labeled synthetic fixtures are written out-of-band to the canonical
 * Supabase database (read-write via pooler, NEVER through the worker), while
 * every READ and every LOGIN goes through the production deployment
 * https://horse-registry-nextgen.rogerfires10.workers.dev (Version 40b5a026,
 * the exact R106 release) using the same Hyperdrive binding production uses.
 * Revocations are committed out-of-band; the very next worker request must
 * reflect them (zero tolerance — the pre-R106 Hyperdrive query cache would
 * have served stale authority for up to 60s).
 *
 * Safety contract:
 *   - Only NEXT-02-labeled fixture rows are created/modified/deleted.
 *   - No real user, session, workspace, person or profile is touched.
 *   - No email/OTP/payment/AI side effects (password login only).
 *   - Full cleanup + baseline-count verification at the end.
 *
 * Usage: SUPABASE_DATABASE_URL=<pooler url> node scripts/next02_live_freshness.js
 */
const { Client } = require("/tmp/pgclient/node_modules/pg");
const crypto = require("crypto");

const WORKER = "https://horse-registry-nextgen.rogerfires10.workers.dev";
const DB_URL = process.env.SUPABASE_DATABASE_URL;
if (!DB_URL) { console.error("SUPABASE_DATABASE_URL env required"); process.exit(2); }

const STAMP = "20261015";
const U1 = { id: `next02-owner-${STAMP}`, email: `next02.owner.${STAMP}@horse-registry-test.local`, pw: null, display: "NEXT-02 Freshness Owner (test fixture)" };
const U2 = { id: `next02-staff-${STAMP}`, email: `next02.staff.${STAMP}@horse-registry-test.local`, pw: null, display: "NEXT-02 Freshness Staff (test fixture)" };
const PERSON_NAME = `NEXT-02 Freshness Person ${STAMP} (test fixture)`;

const evidence = { started_at: new Date().toISOString(), worker: WORKER, legs: [], cleanup: null, summary: {} };
const trace = (leg, step, kind, detail) => { const e = { step, kind, detail, t: new Date().toISOString() }; evidence.legs.push({ leg, ...e }); return e; };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const bits = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
  // Format mirrors src/auth/password.ts: pbkdf2-sha256$100000$<b64 salt>$<b64 key>
  // (bytesToBase64UrlSafe is standard base64 via btoa — padding included).
  return `pbkdf2-sha256$100000$${salt.toString("base64")}$${bits.toString("base64")}`;
}

async function req(method, path, { cookie, csrf, body } = {}) {
  const headers = { "accept": "application/json", "user-agent": "next02-freshness-test/1.0" };
  if (body) headers["content-type"] = "application/json";
  if (cookie) headers["cookie"] = cookie;
  if (csrf) headers["x-csrf-token"] = csrf;
  const t0 = Date.now();
  const res = await fetch(WORKER + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ms = Date.now() - t0;
  let json = null; try { json = await res.json(); } catch { /* non-json */ }
  let setCookie = res.headers.get("set-cookie");
  return { status: res.status, ms, json, cookie: setCookie ? setCookie.split(";")[0] : null, t: new Date().toISOString() };
}

async function login(u) {
  const r = await req("POST", "/api/auth/login", { body: { email: u.email, password: u.pw } });
  return r;
}

function assert(cond, msg) { if (!cond) throw new Error("ASSERTION FAILED: " + msg); }

async function main() {
  const db = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const q = (text, params) => db.query(text, params);

  // ---------- PHASE 0: preflight + baseline ----------
  const health = await req("GET", "/api/health");
  trace("preflight", "worker-health", "http", `GET /api/health -> ${health.status} version=${health.json?.version ?? "?"} provider=${health.json?.db?.provider ?? health.json?.provider ?? "?"} in ${health.ms}ms`);
  assert(health.status === 200, "worker health not 200");

  const baseCounts = (await q(`SELECT
      (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM sessions) AS sessions,
      (SELECT count(*) FROM workspace_collections) AS wc,
      (SELECT count(*) FROM workspace_staff_assignments) AS wsa,
      (SELECT count(*) FROM directory_profiles) AS dp,
      (SELECT count(*) FROM people) AS people`)).rows[0];
  evidence.baseline_counts = baseCounts;
  trace("preflight", "baseline-counts", "db", JSON.stringify(baseCounts));

  // Remove any leftover fixture from an interrupted previous run (idempotent).
  await cleanupFixtures(q, false);

  const peopleSeq = (await q(`SELECT pg_get_serial_sequence('people','id') AS seq`)).rows[0].seq;
  trace("preflight", "people-pk", "db", `pg_get_serial_sequence(people.id) = ${peopleSeq ?? "NONE (explicit id required)"}`);

  // ---------- PHASE 1: fixture (out-of-band writes, clearly labeled) ----------
  U1.pw = crypto.randomBytes(18).toString("base64url");
  U2.pw = crypto.randomBytes(18).toString("base64url");
  for (const u of [U1, U2]) {
    await q(`INSERT INTO users(id,email,display_name,password_hash,role,is_active)
             VALUES($1,$2,$3,$4,'user',1)`, [u.id, u.email, u.display, hashPassword(u.pw)]);
  }
  trace("fixture", "users", "db", `inserted 2 labeled test users (${U1.id}, ${U2.id})`);

  const wc = (await q(`INSERT INTO workspace_collections(name, description, owner_user_id)
             VALUES($1,$2,$3) RETURNING id`, [`NEXT-02 Freshness Workspace ${STAMP} (test fixture)`, "Synthetic fixture for the NEXT-02 live freshness test — never real data", U1.id])).rows[0];
  const W = Number(wc.id);
  trace("fixture", "workspace", "db", `inserted workspace id=${W} owner=${U1.id}`);

  const wsa = (await q(`INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,granted_by_user_id,status)
             VALUES($1,$2,'view',$3,'active') RETURNING id`, [W, U2.id, U1.id])).rows[0];
  trace("fixture", "staff-assignment", "db", `inserted staff assignment id=${wsa.id} collection=${W} user=${U2.id} actions=view`);

  let personId;
  if (peopleSeq) {
    personId = Number((await q(`INSERT INTO people(name_latin) VALUES($1) RETURNING id`, [PERSON_NAME])).rows[0].id);
  } else {
    const maxId = Number((await q(`SELECT coalesce(max(id),0)+100000 AS id FROM people`)).rows[0].id);
    personId = Number((await q(`INSERT INTO people(id,name_latin) VALUES($1,$2) RETURNING id`, [maxId, PERSON_NAME])).rows[0].id);
  }
  const dp = (await q(`INSERT INTO directory_profiles(person_id, service_categories, publication_consent, published_at, created_by_user_id, availability_text)
             VALUES($1,'[]',1,now()::text,$2,'NEXT-02 synthetic test fixture') RETURNING id`, [personId, U1.id])).rows[0];
  trace("fixture", "directory-profile", "db", `inserted person id=${personId} + published directory profile id=${dp.id} (consent=1)`);
  evidence.fixture = { users: [U1.id, U2.id], workspace: W, staff_assignment: Number(wsa.id), person: personId, directory_profile: Number(dp.id) };

  // ---------- PHASE 2: session-revocation leg ----------
  let leg = "leg-1-session-revocation";
  let r = await login(U2);
  trace(leg, "login", "http", `POST /api/auth/login -> ${r.status} user=${r.json?.user?.email ?? "?"} in ${r.ms}ms`);
  assert(r.status === 200 && r.cookie, "login failed");
  const sess1 = { cookie: r.cookie, csrf: r.json.csrfToken };

  r = await req("GET", "/api/auth/me", sess1);
  trace(leg, "me-before", "http", `GET /api/auth/me -> ${r.status} user=${r.json?.user ? r.json.user.id : "null"} in ${r.ms}ms`);
  assert(r.status === 200 && r.json.user?.id === U2.id, "me before revocation should be authenticated");

  r = await req("GET", "/api/workspaces/mine", sess1);
  const listedBefore = (r.json?.workspaces ?? r.json?.owned ?? []).some(w => Number(w.id) === W) || JSON.stringify(r.json).includes(String(W));
  trace(leg, "workspaces-before", "http", `GET /api/workspaces/mine -> ${r.status} workspace ${W} visible=${listedBefore} in ${r.ms}ms`);
  assert(r.status === 200 && listedBefore, "staff workspace should be listed before revocation");

  r = await req("GET", `/api/workspaces/${W}`, sess1);
  trace(leg, "dashboard-before", "http", `GET /api/workspaces/${W} -> ${r.status} in ${r.ms}ms`);
  assert(r.status === 200, "workspace dashboard should be 200 for active staff");

  const del = await q(`DELETE FROM sessions WHERE user_id=$1`, [U2.id]);
  const revokedAt = Date.now();
  trace(leg, "revoke-session", "db", `DELETE FROM sessions WHERE user_id='${U2.id}' — ${del.rowCount} row(s) deleted (out-of-band, committed)`);
  assert(del.rowCount >= 1, "session row should have been deleted");

  // Acceptance 3 interleave: a PUBLIC read between revocation and the private read.
  r = await req("GET", "/api/directory/persons?name=NEXT-02");
  trace(leg, "public-interleave", "http", `GET /api/directory/persons?name=NEXT-02 (public) -> ${r.status} in ${r.ms}ms (+${Date.now() - revokedAt}ms after revocation)`);

  r = await req("GET", "/api/auth/me", sess1);
  const meAfter = r.json?.user ?? null;
  trace(leg, "me-after", "http", `GET /api/auth/me -> ${r.status} user=${meAfter ? meAfter.id : "null"} in ${r.ms}ms (+${Date.now() - revokedAt}ms after revocation)`);
  assert(meAfter === null, "ACCEPTANCE 1 FAILED: session still accepted after out-of-band revocation");

  r = await req("GET", "/api/workspaces/mine", sess1);
  trace(leg, "workspaces-after", "http", `GET /api/workspaces/mine -> ${r.status} (+${Date.now() - revokedAt}ms after revocation)`);
  assert(r.status === 401, "ACCEPTANCE 1 FAILED: workspaces read not refused (expected 401)");

  r = await req("GET", `/api/workspaces/${W}`, sess1);
  trace(leg, "dashboard-after", "http", `GET /api/workspaces/${W} -> ${r.status} (+${Date.now() - revokedAt}ms after revocation)`);
  assert(r.status === 401, "ACCEPTANCE 1 FAILED: workspace dashboard not refused");
  evidence.summary[leg] = "PASS — out-of-band session DELETE refused on the very next request";

  // ---------- PHASE 3: staff-permission-revocation leg ----------
  leg = "leg-2-staff-permission-revocation";
  r = await login(U2);
  trace(leg, "relogin", "http", `POST /api/auth/login -> ${r.status} (fresh session) in ${r.ms}ms`);
  assert(r.status === 200 && r.cookie, "re-login failed");
  const sess2 = { cookie: r.cookie, csrf: r.json.csrfToken };

  r = await req("GET", `/api/workspaces/${W}`, sess2);
  trace(leg, "dashboard-before", "http", `GET /api/workspaces/${W} -> ${r.status} in ${r.ms}ms`);
  assert(r.status === 200, "staff access should work before assignment revocation");

  const upd = await q(`UPDATE workspace_staff_assignments SET status='revoked', revoked_at=now()::text WHERE id=$1 AND user_id=$2`, [wsa.id, U2.id]);
  const permRevokedAt = Date.now();
  trace(leg, "revoke-staff", "db", `UPDATE workspace_staff_assignments SET status='revoked' id=${wsa.id} — ${upd.rowCount} row(s) (out-of-band, committed)`);
  assert(upd.rowCount === 1, "staff assignment should have been revoked");

  r = await req("GET", "/api/directory/persons?name=NEXT-02", {});
  trace(leg, "public-interleave", "http", `GET /api/directory/persons (public) -> ${r.status} in ${r.ms}ms (+${Date.now() - permRevokedAt}ms after revocation)`);

  r = await req("GET", "/api/workspaces/mine", sess2);
  const listedAfter = JSON.stringify(r.json).includes(String(W));
  trace(leg, "workspaces-after", "http", `GET /api/workspaces/mine -> ${r.status} workspace ${W} visible=${listedAfter} (+${Date.now() - permRevokedAt}ms after revocation)`);
  assert(r.status === 200 && !listedAfter, "ACCEPTANCE 1 FAILED: revoked staff workspace still listed");

  r = await req("GET", `/api/workspaces/${W}`, sess2);
  trace(leg, "dashboard-after", "http", `GET /api/workspaces/${W} -> ${r.status} (+${Date.now() - permRevokedAt}ms after revocation)`);
  assert(r.status === 404, "ACCEPTANCE 1 FAILED: revoked staff still has workspace access (expected 404)");
  evidence.summary[leg] = "PASS — out-of-band staff-assignment revocation takes effect on the next request";

  // ---------- PHASE 4: consent-withdrawal leg (public read freshness) ----------
  leg = "leg-3-consent-withdrawal";
  r = await req("GET", "/api/directory/persons?name=NEXT-02");
  const visibleBefore = JSON.stringify(r.json).includes(PERSON_NAME);
  trace(leg, "list-before", "http", `GET /api/directory/persons?name=NEXT-02 -> ${r.status} fixture visible=${visibleBefore} in ${r.ms}ms`);
  assert(r.status === 200 && visibleBefore, "published fixture profile should be publicly visible");

  r = await req("GET", `/api/directory/persons/${personId}`);
  trace(leg, "detail-before", "http", `GET /api/directory/persons/${personId} -> ${r.status} in ${r.ms}ms`);
  assert(r.status === 200, "published fixture detail should be 200");

  const cw = await q(`UPDATE directory_profiles SET publication_consent=0, published_at=NULL, updated_at=now()::text WHERE id=$1`, [dp.id]);
  const consentAt = Date.now();
  trace(leg, "withdraw-consent", "db", `UPDATE directory_profiles SET publication_consent=0 id=${dp.id} — ${cw.rowCount} row(s) (out-of-band, committed)`);
  assert(cw.rowCount === 1, "consent should have been withdrawn");

  r = await req("GET", "/api/health");
  trace(leg, "public-interleave", "http", `GET /api/health (public) -> ${r.status} in ${r.ms}ms (+${Date.now() - consentAt}ms after withdrawal)`);
  r = await req("GET", "/api/directory/persons?name=NEXT-02");
  const visibleAfter = JSON.stringify(r.json).includes(PERSON_NAME);
  trace(leg, "list-after", "http", `GET /api/directory/persons?name=NEXT-02 -> ${r.status} fixture visible=${visibleAfter} (+${Date.now() - consentAt}ms after withdrawal)`);
  assert(!visibleAfter, "ACCEPTANCE 2 FAILED (read side): withdrawn profile still listed");

  r = await req("GET", `/api/directory/persons/${personId}`);
  trace(leg, "detail-after", "http", `GET /api/directory/persons/${personId} -> ${r.status} code=${r.json?.error?.code ?? r.json?.code ?? "?"} (+${Date.now() - consentAt}ms after withdrawal)`);
  assert(r.status === 404, "ACCEPTANCE 2 FAILED (read side): withdrawn profile detail not hidden");
  evidence.summary[leg] = "PASS — consent withdrawal hides the profile on the very next public read (read-side delivery boundary; queued-notification leg not covered here)";

  // ---------- PHASE 5: account-deactivation leg (is_active term in the same session read) ----------
  leg = "leg-4-account-deactivation";
  r = await login(U2);
  trace(leg, "relogin", "http", `POST /api/auth/login -> ${r.status} (fresh session) in ${r.ms}ms`);
  assert(r.status === 200 && r.cookie, "re-login for deactivation leg failed");
  const sess3 = { cookie: r.cookie, csrf: r.json.csrfToken };

  r = await req("GET", "/api/auth/me", sess3);
  trace(leg, "me-before", "http", `GET /api/auth/me -> ${r.status} user=${r.json?.user ? r.json.user.id : "null"} in ${r.ms}ms`);
  assert(r.status === 200 && r.json.user?.id === U2.id, "me should be authenticated before deactivation");

  const de = await q(`UPDATE users SET is_active=0, updated_at=now()::text WHERE id=$1`, [U2.id]);
  const deactAt = Date.now();
  trace(leg, "deactivate", "db", `UPDATE users SET is_active=0 id='${U2.id}' — ${de.rowCount} row(s) (out-of-band, committed)`);
  assert(de.rowCount === 1, "user should have been deactivated");

  r = await req("GET", "/api/directory/persons?name=NEXT-02", {});
  r = await req("GET", "/api/auth/me", sess3);
  const meDeact = r.json?.user ?? null;
  trace(leg, "me-after", "http", `GET /api/auth/me -> ${r.status} user=${meDeact ? meDeact.id : "null"} (+${Date.now() - deactAt}ms after deactivation)`);
  assert(meDeact === null, "AUTHORITY FRESHNESS FAILED: deactivated account still has a live session");

  r = await req("GET", "/api/workspaces/mine", sess3);
  trace(leg, "workspaces-after", "http", `GET /api/workspaces/mine -> ${r.status} (+${Date.now() - deactAt}ms after deactivation)`);
  assert(r.status === 401, "deactivated account should be refused");
  evidence.summary[leg] = "PASS — out-of-band account deactivation terminates authority on the next request";

  // ---------- PHASE 6: cleanup + verification ----------
  await cleanupFixtures(q, true);
  const afterCounts = (await q(`SELECT
      (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM sessions) AS sessions,
      (SELECT count(*) FROM workspace_collections) AS wc,
      (SELECT count(*) FROM workspace_staff_assignments) AS wsa,
      (SELECT count(*) FROM directory_profiles) AS dp,
      (SELECT count(*) FROM people) AS people`)).rows[0];
  // Sessions note: createSession() runs expired-session housekeeping on every
  // login (DELETE ... WHERE expires_at <= now LIMIT 100), so the count can
  // legitimately DROP below baseline when pre-existing rows were expired —
  // that is the application's own maintenance path, not test residue. What
  // MUST hold: zero NEXT-02 residue and every other table back to baseline.
  const residue = (await q(`SELECT
      (SELECT count(*) FROM users WHERE id LIKE 'next02-%') AS r_users,
      (SELECT count(*) FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.id LIKE 'next02-%') AS r_sessions,
      (SELECT count(*) FROM workspace_collections WHERE owner_user_id LIKE 'next02-%') AS r_wc,
      (SELECT count(*) FROM workspace_staff_assignments WHERE user_id LIKE 'next02-%') AS r_wsa,
      (SELECT count(*) FROM directory_profiles dp JOIN users u ON u.id=dp.created_by_user_id WHERE u.id LIKE 'next02-%') AS r_dp,
      (SELECT count(*) FROM people WHERE name_latin LIKE 'NEXT-02%') AS r_people`)).rows[0];
  const exactTables = ["users", "wc", "wsa", "dp", "people"].every(k => String(afterCounts[k]) === String(baseCounts[k]));
  const noResidue = Object.values(residue).every(v => String(v) === "0");
  const sessionsDelta = Number(afterCounts.sessions) - Number(baseCounts.sessions);
  const restored = exactTables && noResidue && sessionsDelta <= 0;
  evidence.cleanup = { baseline: baseCounts, after: afterCounts, residue, zero_residue: noResidue,
    sessions_delta: sessionsDelta, sessions_delta_note: sessionsDelta < 0 ? "pre-existing expired sessions removed by the app's own login housekeeping (createSession maintenance DELETE) — not test residue" : null,
    baseline_restored: restored };
  trace("cleanup", "counts", "db", `zero_residue=${noResidue} exactTables=${exactTables} sessionsDelta=${sessionsDelta} after=${JSON.stringify(afterCounts)}`);
  assert(restored, "CLEANUP FAILED: residue or non-session counts do not match baseline");

  await db.end();
  evidence.finished_at = new Date().toISOString();
  evidence.verdict = "ALL LEGS PASS — production authority reads are fresh through the deployed Worker (no stale-cache window)";
  console.log(JSON.stringify(evidence, null, 2));
}

async function cleanupFixtures(q, verbose) {
  const del = async (sql, params, label) => {
    const r = await q(sql, params);
    if (verbose && r.rowCount > 0) trace("cleanup", label, "db", `${r.rowCount} row(s) deleted`);
    return r.rowCount;
  };
  await del(`DELETE FROM sessions WHERE user_id IN ($1,$2)`, [U1.id, U2.id], "sessions");
  await del(`DELETE FROM workspace_staff_assignments WHERE user_id IN ($1,$2) OR granted_by_user_id IN ($1,$2)`, [U1.id, U2.id], "staff-assignments");
  await del(`DELETE FROM workspace_collections WHERE owner_user_id IN ($1,$2)`, [U1.id, U2.id], "workspace-collections");
  await del(`DELETE FROM directory_profiles WHERE created_by_user_id IN ($1,$2)`, [U1.id, U2.id], "directory-profiles");
  await del(`DELETE FROM people WHERE name_latin=$1`, [PERSON_NAME], "people");
  await del(`DELETE FROM users WHERE id IN ($1,$2)`, [U1.id, U2.id], "users");
}

main().catch((e) => { evidence.error = e.message; evidence.finished_at = new Date().toISOString(); console.error("FAILED:", e.message); console.log(JSON.stringify(evidence, null, 2)); process.exit(1); });
