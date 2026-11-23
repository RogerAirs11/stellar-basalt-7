import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {migrationTargetFingerprint,migrationApprovalDecision} from '../scripts/lib/migration-approval.mjs';
const url='postgres://operator:synthetic-secret@db.example.test:5432/registry';
const sha='a'.repeat(40),fingerprint=migrationTargetFingerprint(url);
const env={R95_PRODUCTION_RELEASE_APPROVED_SHA:sha,R96_MIGRATION_ID:'0061',R96_MIGRATION_TARGET_SHA256:fingerprint,R96_MIGRATION_BACKUP_ID:'restore-reviewed-20261004'};
const input={connectionString:url,migrationId:'0061',env,gitSha:sha,dirty:false};
test('canonical migration requires all explicit approval dimensions',()=>assert.equal(migrationApprovalDecision(input).mode,'owner-approved-canonical'));
for(const field of Object.keys(env))test(`missing ${field} fails closed`,()=>assert.throws(()=>migrationApprovalDecision({...input,env:{...env,[field]:undefined}})));
test('dirty approved revision fails closed',()=>assert.throws(()=>migrationApprovalDecision({...input,dirty:true})));
test('different approved revision fails closed',()=>assert.throws(()=>migrationApprovalDecision({...input,gitSha:'b'.repeat(40)})));
test('changed endpoint requires new target approval',()=>assert.throws(()=>migrationApprovalDecision({...input,connectionString:url.replace('/registry','/other')})));
test('password is not part of target fingerprint or reported error',()=>assert.equal(migrationTargetFingerprint(url.replace('synthetic-secret','another-secret')),fingerprint));
test('query overrides and non-PG targets fail closed',()=>{for(const x of [url+'?host=other','https://db.example.test/registry'])assert.throws(()=>migrationTargetFingerprint(x));});
test('explicit disposable loopback test database works without git approval',()=>assert.equal(migrationApprovalDecision({connectionString:'postgres://p:p@127.0.0.1/hr_test_migration',migrationId:'0061',env:{PG_PARITY_DISPOSABLE:'yes'}}).mode,'disposable-local'));
for(const x of ['postgres://p:p@127.0.0.1/postgres','postgres://p:p@db.example.test/hr_test_migration','postgres://p:p@localhost/registry'])test(`disposable switch cannot authorize ${new URL(x).pathname}`,()=>assert.throws(()=>migrationApprovalDecision({connectionString:x,migrationId:'0061',env:{PG_PARITY_DISPOSABLE:'yes'}})));
test('every supplied canonical apply entrypoint gates before opening postgres',()=>{
 const names=readdirSync('scripts').filter(x=>/^apply-\d+-to-supabase\.mjs$/.test(x));assert.equal(names.length,20);
 for(const name of names){const s=readFileSync('scripts/'+name,'utf8');assert.ok(s.indexOf('requireCanonicalMigrationApproval(url,')<s.indexOf('const sql = postgres(url,'),name);assert.ok(s.indexOf('requireCanonicalMigrationApproval(url,')>=0,name);}
});
