/** Shared fail-closed boundary for legacy canonical migration entrypoints.
 * Approval fields are operator attestations, not evidence that a restore/test ran.
 * No connection is opened here and no credential-bearing URL is ever logged.
 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

export function migrationTargetFingerprint(connectionString) {
  const u=new URL(connectionString);
  if(!['postgres:','postgresql:'].includes(u.protocol)||!u.hostname||!u.pathname.slice(1)||u.search||u.hash)
    throw new Error('Use an explicit PostgreSQL database URL without query/fragment overrides');
  const identity=JSON.stringify({host:u.hostname.toLowerCase(),port:u.port||'5432',database:decodeURIComponent(u.pathname.slice(1)),user:decodeURIComponent(u.username)});
  return createHash('sha256').update(identity).digest('hex');
}

export function migrationApprovalDecision({connectionString,migrationId,env={},gitSha='',dirty=true}) {
  if(!/^\d{4}$/.test(migrationId))throw new Error('A four-digit migration ID is required');
  const fingerprint=migrationTargetFingerprint(connectionString),target=new URL(connectionString);
  if(env.PG_PARITY_DISPOSABLE==='yes') {
    if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname)
      ||!/^hr_test_[a-z0-9_]{1,48}$/.test(decodeURIComponent(target.pathname.slice(1))))
      throw new Error('Disposable migration execution requires a loopback hr_test_ database; never a default or canonical database');
    return {mode:'disposable-local',migrationId,fingerprint};
  }
  if(!/^[a-f0-9]{40,64}$/i.test(gitSha)||dirty||env.R95_PRODUCTION_RELEASE_APPROVED_SHA!==gitSha)
    throw new Error('Canonical migration refused: a clean, committed, exact-revision owner approval is required');
  if(env.R96_MIGRATION_ID!==migrationId||env.R96_MIGRATION_TARGET_SHA256!==fingerprint)
    throw new Error('Canonical migration refused: explicit migration ID and target fingerprint approval are required');
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/.test(env.R96_MIGRATION_BACKUP_ID||''))
    throw new Error('Canonical migration refused: record an approved backup/restore evidence ID first');
  return {mode:'owner-approved-canonical',migrationId,fingerprint};
}

export function requireCanonicalMigrationApproval(connectionString,migrationId,env=process.env) {
  let gitSha='',dirty=true;
  if(env.PG_PARITY_DISPOSABLE!=='yes') {
    try {
      gitSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
      dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()!=='';
    }catch { /* Missing git metadata is a refusal, not an approval bypass. */ }
  }
  return migrationApprovalDecision({connectionString,migrationId,env,gitSha,dirty});
}
