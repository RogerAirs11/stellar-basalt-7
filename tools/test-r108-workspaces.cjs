'use strict';
// Production statement builders executed against real SQLite. This is not a
// Worker/HTTP, remote PostgreSQL, D1, or Turso integration certification.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { load } = require('./lib/r104-isolated-module.cjs');
const collaboration = load('src/workspaces/collaboration.ts');
function world(t) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  sql.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,is_active INTEGER NOT NULL);
    CREATE TABLE organizations(id INTEGER PRIMARY KEY,status TEXT);
    CREATE TABLE organization_memberships(organization_id INTEGER,user_id TEXT,role TEXT,status TEXT,revoked_at TEXT,valid_from TEXT,valid_until TEXT);
    CREATE TABLE entitlement_events(payer_organization_id INTEGER,sku TEXT,kind TEXT,grant_scope TEXT NOT NULL DEFAULT 'production');
    CREATE TABLE entitlements(holder_key TEXT,sku TEXT,active INTEGER,expires_at TEXT,grant_scope TEXT NOT NULL DEFAULT 'production');
    CREATE TABLE workspace_collections(id INTEGER PRIMARY KEY,organization_id INTEGER,owner_user_id TEXT,deleted_at TEXT,row_version INTEGER DEFAULT 1,updated_at TEXT);
    CREATE TABLE workspace_staff_assignments(collection_id INTEGER,user_id TEXT,actions TEXT,status TEXT DEFAULT 'active',granted_by_user_id TEXT,last_operation_id TEXT,revoked_at TEXT,revoked_by_user_id TEXT,granted_at TEXT,UNIQUE(collection_id,user_id));
    CREATE TABLE workspace_staff_invites(id INTEGER PRIMARY KEY,collection_id INTEGER,invitee_user_id TEXT,invited_by_user_id TEXT,proposed_actions TEXT,status TEXT,note TEXT,expires_at TEXT,last_invite_operation_id TEXT,responded_at TEXT);
    CREATE TABLE workspace_tasks(id INTEGER PRIMARY KEY,collection_id INTEGER NOT NULL REFERENCES workspace_collections(id),assigned_to_user_id TEXT REFERENCES users(id),status TEXT,row_version INTEGER DEFAULT 1,last_operation_id TEXT,updated_at TEXT);
    CREATE TABLE workspace_documents(id INTEGER PRIMARY KEY,collection_id INTEGER NOT NULL REFERENCES workspace_collections(id),status TEXT,row_version INTEGER DEFAULT 1,last_operation_id TEXT,updated_at TEXT);
    CREATE TABLE audit_events(id INTEGER PRIMARY KEY,actor_user_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT,before_json TEXT,after_json TEXT,created_at TEXT,operation_id TEXT);
    CREATE TABLE notification_outbox(id INTEGER PRIMARY KEY,recipient_user_id TEXT,status TEXT,payload_ref TEXT,last_error TEXT,updated_at TEXT);
    INSERT INTO users VALUES ('owner',1),('staff',1),('outsider',1),('disabled',0);
    INSERT INTO workspace_collections(id,owner_user_id) VALUES (1,'owner'),(2,'owner');
    INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,status) VALUES (1,'staff','view,tasks_manage','active'),(2,'staff','view,tasks_manage','active'),(1,'disabled','view','active');
    INSERT INTO workspace_tasks(id,collection_id,assigned_to_user_id,status,updated_at) VALUES (101,1,'owner','open','2000-01-01'),(202,2,'staff','open','2000-01-01');
    INSERT INTO workspace_documents(id,collection_id,status) VALUES (301,1,'active');
    INSERT INTO notification_outbox(id,recipient_user_id,status,payload_ref) VALUES (1,'staff','queued','workspace_tasks:101'),(2,'staff','queued','workspace_tasks:202'),(3,'staff','sent','workspace_tasks:101'),(4,'owner','queued','workspace_tasks:101'),(5,'staff','queued','other:101');
  `);
  const db = { prepare: query => ({ bind: (...binds) => ({ query, binds }) }) };
  function batch(statements) {
    sql.exec('BEGIN');
    try { const results = statements.map(({query,binds}) => sql.prepare(query).run(...binds)); sql.exec('COMMIT'); return results; }
    catch(e) { sql.exec('ROLLBACK'); throw e; }
  }
  const reassign = overrides => batch(collaboration.reassignTaskStatements(db, { collectionId:1,taskId:101,newAssigneeUserId:'staff',actorUserId:'owner',operationId:crypto.randomUUID(),expectedVersion:1,...overrides }));
  return {sql,db,batch,reassign};
}
test('R108 SQLite: reassign advances version and update timestamp', t => {
  const w=world(t); w.reassign();
  const task=w.sql.prepare('SELECT * FROM workspace_tasks WHERE id=101').get();
  assert.equal(task.assigned_to_user_id,'staff'); assert.equal(task.row_version,2); assert.notEqual(task.updated_at,'2000-01-01');
  const audit=w.sql.prepare('SELECT * FROM audit_events').get(); assert.equal(audit.action,'workspace.task_reassigned');
  assert.notDeepEqual(JSON.parse(audit.before_json),{reassigned_to:'staff'},'never fabricate the previous assignee from the NEW value');
});
test('R108 SQLite: stale task reassignment cannot overwrite or audit', t => {
  const w=world(t); w.reassign(); const results=w.reassign({newAssigneeUserId:'owner',expectedVersion:1});
  assert.equal(Number(results[1].changes),0); assert.equal(w.sql.prepare('SELECT assigned_to_user_id FROM workspace_tasks WHERE id=101').get().assigned_to_user_id,'staff');
  assert.equal(w.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,1);
});
test('R108 SQLite: unassignment advances version and is audit-visible', t => {
  const w=world(t); w.reassign({newAssigneeUserId:null});
  const task=w.sql.prepare('SELECT * FROM workspace_tasks WHERE id=101').get(); assert.equal(task.assigned_to_user_id,null);assert.equal(task.row_version,2);
  const audit=w.sql.prepare('SELECT * FROM audit_events').get();assert.equal(JSON.parse(audit.after_json).assigned_to_user_id,null);
});
for(const target of ['outsider','disabled']) test(`R108 SQLite: ${target} cannot be assigned`, t => {
  const w=world(t);const results=w.reassign({newAssigneeUserId:target}); assert.equal(Number(results[1].changes),0);assert.equal(w.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
});
test('R108 SQLite: revoked actor cannot reassign or unassign', t => {
  const w=world(t);w.sql.exec("UPDATE workspace_staff_assignments SET status='revoked' WHERE collection_id=1 AND user_id='staff'");
  for(const newAssigneeUserId of ['owner',null]) { const results=w.reassign({actorUserId:'staff',newAssigneeUserId});assert.equal(Number(results[1].changes),0); }
  assert.equal(w.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
});
test('R108 SQLite: document archive has marker-gated audit and no failed-write audit', t => {
  const w=world(t);
  for(let n=0;n<2;n++) w.batch(collaboration.archiveDocumentStatements(w.db,{collectionId:1,documentId:301,actorUserId:'owner',operationId:`archive-${n}`}));
  assert.equal(w.sql.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='workspace.document_archived'").get().n,1);
  assert.equal(w.sql.prepare('SELECT row_version FROM workspace_documents WHERE id=301').get().row_version,2);
});
test('R108 SQLite: staff departure suppresses only the selected workspace queued reminders', t => {
  const w=world(t);w.batch([collaboration.suppressQueuedWorkspaceNotificationsStatement(w.db,'staff',1)]);
  const states=Object.fromEntries(w.sql.prepare('SELECT id,status FROM notification_outbox').all().map(r=>[r.id,r.status]));
  assert.deepEqual(states,{1:'suppressed',2:'queued',3:'sent',4:'queued',5:'queued'});
});

function invitation(w, invitee='outsider') {
  w.sql.prepare("INSERT INTO workspace_staff_invites(collection_id,invitee_user_id,invited_by_user_id,proposed_actions,status,expires_at) VALUES (1,?,'owner','view','pending','2099-01-01 00:00:00')").run(invitee);
}
function accept(w, overrides={}) { return w.batch(collaboration.acceptStaffInviteStatements(w.db,{collectionId:1,inviteeUserId:'outsider',actorUserId:'outsider',operationId:crypto.randomUUID(),...overrides})); }
test('R108 SQLite: accepting invite locks the workspace before creating an audited assignment', t => {
  const w=world(t);invitation(w);
  const statements=collaboration.acceptStaffInviteStatements(w.db,{collectionId:1,inviteeUserId:'outsider',actorUserId:'outsider',operationId:'accept-one'});
  assert.match(statements[0].query,/UPDATE workspace_collections/);
  const results=w.batch(statements);assert.equal(Number(results[1].changes),1);
  assert.equal(w.sql.prepare("SELECT status FROM workspace_staff_invites").get().status,'accepted');
  assert.equal(w.sql.prepare("SELECT COUNT(*) n FROM audit_events").get().n,1);
  accept(w);assert.equal(w.sql.prepare("SELECT COUNT(*) n FROM audit_events").get().n,1);
});
test('R108 SQLite: invite acceptance refuses a caller other than the invitee before emitting SQL', t => {
  const w=world(t);invitation(w);assert.throws(()=>accept(w,{actorUserId:'owner'}),/Only the invitee/);
});
for(const condition of ['disabled-invitee','disabled-inviter','expired','revoked-inviter','full']) test(`R108 SQLite: ${condition} invite acceptance creates no assignment or audit`,t=>{
  const w=world(t);invitation(w);
  if(condition==='disabled-invitee') w.sql.exec("UPDATE users SET is_active=0 WHERE id='outsider'");
  if(condition==='disabled-inviter') w.sql.exec("UPDATE users SET is_active=0 WHERE id='owner'");
  if(condition==='expired') w.sql.exec("UPDATE workspace_staff_invites SET expires_at='2000-01-01 00:00:00'");
  if(condition==='revoked-inviter') w.sql.exec("UPDATE workspace_collections SET owner_user_id='staff' WHERE id=1");
  if(condition==='full') for(let n=0;n<48;n++) w.sql.prepare("INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,status) VALUES (1,?,'view','active')").run(`capacity-${n}`);
  const results=accept(w);assert.equal(Number(results[1].changes),0);
  assert.equal(w.sql.prepare("SELECT status FROM workspace_staff_invites").get().status,'pending');
  assert.equal(w.sql.prepare("SELECT COUNT(*) n FROM audit_events").get().n,0);
});
