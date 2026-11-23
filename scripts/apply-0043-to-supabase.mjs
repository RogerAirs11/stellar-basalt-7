#!/usr/bin/env node
/**
 * R88 agent plan P11 Supabase-first step: apply migration 0043 (directory
 * credentials) to the Supabase canonical database BEFORE the worker push.
 * Additive only: 4 new tables + 4 indexes. No data changes.
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-0043-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0043");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

try {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS directory_profiles (
      id BIGSERIAL PRIMARY KEY,
      person_id bigint NOT NULL UNIQUE REFERENCES people(id) ON DELETE CASCADE,
      service_categories TEXT NOT NULL DEFAULT '[]',
      province_code TEXT,
      city TEXT,
      contact_preference TEXT NOT NULL DEFAULT 'platform_message' CHECK (contact_preference IN ('platform_message','phone','email')),
      contact_value TEXT,
      languages TEXT,
      availability_text TEXT,
      publication_consent bigint NOT NULL DEFAULT 0 CHECK (publication_consent IN (0,1)),
      published_at TEXT,
      created_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_directory_profiles_published ON directory_profiles(publication_consent, person_id)`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS organization_profiles (
      id BIGSERIAL PRIMARY KEY,
      organization_id bigint NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
      description TEXT,
      service_categories TEXT NOT NULL DEFAULT '[]',
      province_code TEXT,
      city TEXT,
      contact_preference TEXT NOT NULL DEFAULT 'platform_message' CHECK (contact_preference IN ('platform_message','phone','email')),
      contact_value TEXT,
      publication_consent bigint NOT NULL DEFAULT 0 CHECK (publication_consent IN (0,1)),
      published_at TEXT,
      created_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_organization_profiles_published ON organization_profiles(publication_consent, organization_id)`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS person_credentials (
      id BIGSERIAL PRIMARY KEY,
      person_id bigint NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      issuer_name TEXT NOT NULL,
      identifier TEXT NOT NULL,
      issued_at TEXT,
      expires_at TEXT,
      evidence_media_id TEXT,
      verification_state TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_state IN ('unverified','platform_reviewed','issuer_attested')),
      verified_by_user_id TEXT,
      verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(person_id, role, identifier)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_person_credentials_person ON person_credentials(person_id, role)`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS directory_claims (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      claim_type TEXT NOT NULL CHECK (claim_type IN ('person','organization')),
      person_id bigint REFERENCES people(id) ON DELETE CASCADE,
      organization_id bigint REFERENCES organizations(id) ON DELETE CASCADE,
      evidence_note TEXT NOT NULL,
      evidence_media_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      reviewed_by_user_id TEXT,
      reviewed_at TEXT,
      review_note TEXT,
      appeal_for_claim_id bigint REFERENCES directory_claims(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_directory_claims_status ON directory_claims(status, created_at)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_directory_claims_user ON directory_claims(user_id, status)`);

  for (const table of ["directory_profiles", "organization_profiles", "person_credentials", "directory_claims"]) {
    const rows = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${table} ORDER BY ordinal_position`;
    console.log(`OK ${table}:`, rows.map((row) => row.column_name).join(", "));
  }
  console.log("apply-0043: Supabase canonical updated (P11 directory + credentials; additive only)");
} finally {
  await sql.end({ timeout: 5 });
}
