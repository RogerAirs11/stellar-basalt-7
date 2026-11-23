#!/usr/bin/env node
/** Read-only catalog probe. It neither migrates nor repairs production. */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
const url=process.env.SUPABASE_DATABASE_URL;
if (!url) { console.error('SUPABASE_DATABASE_URL is required for the read-only primary schema probe'); process.exit(2); }
const schema=process.env.R95_PG_SCHEMA || 'public';
const expected=JSON.parse(readFileSync(new URL('../audit/r95/expected-schema.json',import.meta.url),'utf8'));
const sql=postgres(url,{max:1,connect_timeout:10,idle_timeout:5});
try {
  const report=await sql.begin('read only',async tx=>{
    const columns=await tx`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=${schema}`;
    const available=new Set(columns.map(r=>`${r.table_name}.${r.column_name}`));
    const missing=expected.columns.filter(key=>!available.has(key));
    const indexes=await tx`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=${schema}`;
    for(const name of expected.required_unique_indexes) {
      if(!indexes.some(r=>r.indexname===name && /CREATE UNIQUE INDEX/i.test(r.indexdef)))missing.push(`unique-index:${name}`);
    }
    return {schema,expected_columns:expected.columns.length,missing,scope:'column and selected unique-index existence only; not data, constraints, migration checksums, or adapter parity'};
  });
  console.log(JSON.stringify(report,null,2));if(report.missing.length)process.exitCode=1;
} finally { await sql.end({timeout:5}); }
