#!/usr/bin/env node
/** Loopback-only client rehearsal, backed by the real Worker + isolated SQLite.
 * No arbitrary Vite arguments, automatic database creation, or provider keys.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const uiAudit = args.includes('--ui-audit');
if (uiAudit) args.splice(args.indexOf('--ui-audit'), 1);
const readOnly = args[0] === '--read-only';
if (readOnly) args.shift();
if (args.length > 1 || args[0]?.startsWith('-')) {
  console.error('Usage: npm run dev:demo -- [--ui-audit] [--read-only] [path/to/new-synthetic.sqlite]');
  process.exit(1);
}
const database = path.resolve(args[0] || path.join(root, 'data/demo/client-demo.sqlite'));
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const checked = spawnSync(python, [path.join(root,'tools/create-demo-database.py'),'--check','--output',database], {cwd:root, encoding:'utf8'});
if (checked.error || checked.status !== 0) {
  console.error('Demo refused: create and validate a fresh marked database first with npm run db:demo:create. No database was changed.');
  process.exit(1);
}
const vite = path.join(root,'node_modules/vite/bin/vite.js');
if (!fs.existsSync(vite)) {
  console.error('Locked dependencies are missing. Restore the authorized frontend assets and run npm ci first.');
  process.exit(1);
}
const env = {...process.env, HORSE_REGISTRY_SQLITE:database, HORSE_REGISTRY_DEMO_MODE:'1',
  HORSE_REGISTRY_UI_AUDIT:uiAudit?'1':'0',
  ENABLE_DEMO_ADMIN_LOGIN:readOnly?'0':'1', HORSE_REGISTRY_DEMO_READ_ONLY:readOnly?'1':'0', HORSE_REGISTRY_DEV_ALLOWED_HOSTS:'',
  AI_ASSISTANT_ENABLED:'0', AI_GEMINI_ENABLED:'0', AI_DEEPSEEK_ENABLED:'0',
  AI_OFFLINE_SANDBOX:'0', AI_DEMO_REGISTRY_RESEARCH:'0',
  VITE_REACT_STRICT_QA:'1'};
// Defense in depth: do not inherit provider credentials into the child process.
for (const name of Object.keys(env)) {
  if (/^(?:GEMINI_|DEEPSEEK_|SUPABASE_|TURSO_|CLOUDFLARE_|CF_API_|ZARINPAL_|EMAIL_|SMTP_|RESEND_|KAVENEGAR_|NOTIFICATION_|PAYMENT_|BILLING_|MEDIA_ACCESS_|PG_CONNECTION_STRING$|DATABASE_URL$|__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS$)/i.test(name)) delete env[name];
}
console.log('SYNTHETIC LOCAL DEMO. No real credentials, payments, delivery, or remote database.');
if (uiAudit) console.log('UI AUDIT: hot replacement is disabled; navigate or reload explicitly after source changes.');
if (readOnly) console.log('READ-ONLY REFERENCE COPY: sign-in, mutations and local job controls are disabled by the server and SQLite.');
console.log('Demo date and fictional personas: http://127.0.0.1:3000/api/demo/context');
const lockPath = database + '.lock';
let lockInode;
try {
  const lock = fs.openSync(lockPath, 'wx', 0o600);
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, database }));
  lockInode = fs.fstatSync(lock).ino;
  fs.closeSync(lock);
} catch {
  console.error('Demo instance is locked. Stop the existing launcher before starting or resetting it. See docs/SHOWCASE-RUNBOOK.md for stale-lock recovery.');
  process.exit(1);
}
const cleanup = () => {
  try { if (fs.lstatSync(lockPath).ino === lockInode) fs.unlinkSync(lockPath); } catch {}
};
process.on('exit', cleanup);
const child = spawn(process.execPath,[vite,'dev','--mode','sqlite','--host','127.0.0.1','--port','3000','--strictPort'],{cwd:root,stdio:'inherit',env});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Demo server could not start.'); process.exitCode = 1; cleanup(); });
child.on('exit', code => { cleanup(); process.exit(code ?? 0); });
