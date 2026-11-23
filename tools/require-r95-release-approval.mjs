import { execFileSync } from 'node:child_process';
import { validateReleaseRevision } from './release-revision-policy.mjs';
try {
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const status=execFileSync('git',['status','--porcelain','--untracked-files=normal'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  validateReleaseRevision({head,status,ciSha:process.env.GITHUB_SHA,approvedSha:process.env.R95_PRODUCTION_RELEASE_APPROVED_SHA});
  console.log('Exact-revision owner approval supplied for a clean checkout. This is an approval gate, not proof that tests ran.');
} catch {
  // No filenames, secret-bearing git diagnostics, or caller-supplied values.
  console.error('R106 deployment blocked: approve the exact git SHA of a clean checkout after full tests, real PostgreSQL adapter parity, primary-schema verification and restore rehearsal. CI SHA must match actual HEAD; changed or untracked source is not approved. See R95_MIGRATION_RUNBOOK.md.');
  process.exitCode=1;
}
