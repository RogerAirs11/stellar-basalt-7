#!/usr/bin/env node
// Read-only probe of live Supabase schema state for migrations 0089-0092.
import postgres from 'postgres';
const url = process.env.SUPABASE_DATABASE_URL;
if (!url) { console.error('Need SUPABASE_DATABASE_URL'); process.exit(2); }
const sql = postgres(url, { max: 1, connect_timeout: 15, idle_timeout: 5 });
try {
  const report = await sql.begin('read only', async tx => {
    const out = {};
    // 0089: command_receipts CHECK includes inquiry.reply / inquiry.buyer_close?
    const chk = await tx`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'command_receipts'::regclass AND contype = 'c' AND conname LIKE '%command%'`;
    out.command_receipts_checks = chk.map(r => r.def);
    const crCount = await tx`SELECT count(*)::int AS n FROM command_receipts`;
    out.command_receipts_rows = crCount[0].n;
    // 0090
    out.content_post_revisions = await tx`SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='content_post_revisions'`.then(r => r.length > 0);
    // 0091
    out.horses_data_origin = await tx`SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='horses' AND column_name='data_origin'`.then(r => r.length > 0);
    // 0092
    out.horse_merges_manifest_digest = await tx`SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='horse_merges' AND column_name='manifest_digest'`.then(r => r.length > 0);
    out.merge_command_receipts = await tx`SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='merge_command_receipts'`.then(r => r.length > 0);
    // migration tracking (if any table)
    const trackers = await tx`SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND (table_name LIKE '%migration%' OR table_name LIKE '%ledger%')`;
    out.tracking_tables = trackers.map(r => r.table_name);
    // scale check
    out.horses_rows = (await tx`SELECT count(*)::int AS n FROM horses`)[0].n;
    return out;
  });
  console.log(JSON.stringify(report, null, 2));
} finally { await sql.end({ timeout: 5 }); }
