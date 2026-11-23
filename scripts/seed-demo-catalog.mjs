#!/usr/bin/env node
/**
 * R98-N10 demo catalog seed — ONE bounded farm offer for the demonstration
 * journey, applied as an explicit idempotent OPERATOR action.
 *
 * Why a script and not a migration: pricing stays an operator decision. The
 * seed is a no-op whenever (sku, version) already exists — an operator who
 * has priced 'farm_workspace_monthly' keeps their price untouched. Nothing
 * is charged: new LIVE charges stay disabled until owner approval; while
 * the demo gateway is enabled, every settlement is simulated (provider
 * 'demo') and every response says so.
 *
 * Targets, in order (each optional, each idempotent, each verified):
 *   1. Supabase canonical  — SUPABASE_DATABASE_URL (postgres, ON CONFLICT DO NOTHING)
 *   2. Cloudflare D1       — wrangler d1 execute --remote (SQLite, INSERT OR IGNORE)
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/seed-demo-catalog.mjs [--supabase-only]
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/seed-demo-catalog.mjs [--d1-only]
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync, rmSync } from "node:fs";

const argv = process.argv.slice(2);
const supabaseOnly = argv.includes("--supabase-only");
const d1Only = argv.includes("--d1-only");

const OFFER = {
  sku: "farm_workspace_monthly",
  version: 1,
  name_en: "Farm workspace (demo)",
  name_fa: "فضای کار مزرعه (نمایشی)",
  description: "Demonstration pilot price - NOT a verified market rate. No real charge can occur while payments run through the demo gateway.",
  price_minor: 19_000_000, // 1,900,000 toman — integer IRR
  period_days: 30,
  created_by: "system-demo-catalog",
};

function esc(value) {
  return String(value).replace(/'/g, "''");
}

const SQLITE_SQL = `INSERT OR IGNORE INTO billing_prices(sku,version,name_en,name_fa,description,price_minor,period_days,active,created_by_user_id)
VALUES('${esc(OFFER.sku)}',${OFFER.version},'${esc(OFFER.name_en)}','${esc(OFFER.name_fa)}','${esc(OFFER.description)}',${OFFER.price_minor},${OFFER.period_days},1,'${esc(OFFER.created_by)}');`;

async function seedSupabase() {
  const url = process.env.SUPABASE_DATABASE_URL;
  if (!url) { console.log("[supabase] SUPABASE_DATABASE_URL not set — skipped"); return; }
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1, ssl: { rejectUnauthorized: false } });
  try {
    await sql.unsafe(`INSERT INTO billing_prices(sku,version,name_en,name_fa,description,price_minor,period_days,active,created_by_user_id)
VALUES('${esc(OFFER.sku)}',${OFFER.version},'${esc(OFFER.name_en)}','${esc(OFFER.name_fa)}','${esc(OFFER.description)}',${OFFER.price_minor},${OFFER.period_days},1,'${esc(OFFER.created_by)}')
ON CONFLICT (sku, version) DO NOTHING`);
    const rows = await sql.unsafe(`SELECT id, sku, version, price_minor, period_days, active FROM billing_prices WHERE sku='${esc(OFFER.sku)}' ORDER BY version DESC LIMIT 5`);
    for (const row of rows) console.log(`[supabase] billing_prices id=${row.id} sku=${row.sku} v${row.version} price=${row.price_minor} period=${row.period_days}d active=${row.active}`);
    console.log("[supabase] demo catalog seed applied (idempotent)");
  } finally {
    await sql.end();
  }
}

function seedD1() {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.log("[d1] CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set — skipped");
    return;
  }
  const file = `/tmp/demo-catalog-${randomUUID()}.sql`;
  writeFileSync(file, SQLITE_SQL + "\n");
  try {
    const out = execFileSync("npx", [
      "wrangler", "d1", "execute", "horse-registry", "--remote", "--config", "wrangler.jsonc",
      "--file", file, "--json",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: process.env, timeout: 120_000 });
    const results = JSON.parse(out.slice(out.indexOf("[")));
    for (const batch of results) {
      for (const row of batch.results ?? []) {
        console.log(`[d1] billing_prices id=${row.id} sku=${row.sku} v${row.version} price=${row.price_minor} period=${row.period_days}d active=${row.active}`);
      }
    }
    console.log("[d1] demo catalog seed applied (idempotent)");
  } finally {
    rmSync(file, { force: true });
  }
}

const summary = async () => {
  if (!d1Only) await seedSupabase();
  if (!supabaseOnly) seedD1();
  console.log("Done. The offer is purchasable through the demo gateway (DEMO_PAYMENTS_ENABLED) or the real gateway when the owner enables live payments.");
};

summary().catch((error) => { console.error(error); process.exit(1); });
