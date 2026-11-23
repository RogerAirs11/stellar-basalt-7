# D1 Recovery Runbook — v1.1.8 Remediation

## Safety state

Destructive replacement of a populated remote D1 is intentionally blocked by `scripts/deploy-cloudflare.ps1` until a restore-capable recovery workflow is rehearsed. The project uses FTS5 virtual tables, so the former whole-database `wrangler d1 export` assumption must not be treated as a portable backup.

## Canonical recovery sources

Preserve together:

1. original XLSX/source files;
2. generated verified local SQLite;
3. exact source/build revision;
4. migrations;
5. importer/exporter scripts;
6. SQL shard manifest + hashes;
7. dataset/source revision metadata;
8. separate governance/staff-data recovery procedure.

FTS/trigram structures are derived and must be rebuildable from canonical/search-source data.

## Required rehearsal before enabling destructive replacement

1. Create a disposable clean D1.
2. Apply all migrations.
3. Import canonical registry data using the quota-aware/resumable importer.
4. Restore or intentionally preserve governance/staff data according to deployment policy.
5. Rebuild search source, FTS5 and trigram indexes.
6. Import/build revision-matched analytics/reference intelligence.
7. Verify foreign keys, canonical counts, search counts, source revision and representative search/profile/pedigree queries.
8. Record raw evidence and exact commands.
9. Only after successful rehearsal may the destructive-replacement block be reconsidered.

## Cloud operational recovery

Use D1 provider recovery/Time Travel as an operational safety layer where available, but not as the sole durable canonical backup.

## Current status

**NOT YET REHEARSED. Remote destructive replacement must remain blocked.**
