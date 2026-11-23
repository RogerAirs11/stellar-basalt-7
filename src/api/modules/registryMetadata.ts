import type { AuthContext } from '../../auth/session';
import { requireAuth, requireCsrf } from '../../auth/guards';
import type { MetadataCommand, MetadataDefinition, MetadataField, MetadataReceipt } from '../../contracts/registryMetadata';
import { MetadataActivationSchema, MetadataCreateSchema, MetadataKey, MetadataValueSchema, MetadataVersionSchema, parseMetadata, stableMetadataJson, validateMetadataValue } from '../../registry/supplementaryMetadata';
import { HttpError, json, readJson } from '../http';

interface FieldRow { field_key: string; value_type: string; visibility: string; active_version: number | null; latest_version: number; revision: number; definition_json: string; definition_version: number }
interface Context { db: D1Database; auth: AuthContext; key: string; horseId: number | null }
interface Guard { sql: string; bindings: (string | number)[] }
interface Intent { command: string; digest: string; input: MetadataCommand }
const CATALOG_LIMIT = 100;
const SUPPORTED_WORKFLOWS = ['existing_horse_curation'];

/** Generic editor authority does not grant permission to define public fields. */
function adminGuard(context: Context): Guard {
  return { sql: `EXISTS(SELECT 1 FROM sessions ms JOIN users mu ON mu.id=ms.user_id
    WHERE ms.id=? AND ms.user_id=? AND datetime(ms.expires_at)>CURRENT_TIMESTAMP AND mu.is_active=1 AND mu.role IN ('admin','super_admin'))`,
  bindings: [context.auth.sessionId,context.auth.user.id] };
}
async function admin(request: Request, env: Env): Promise<AuthContext> {
  const auth = await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME);
  if (!['admin','super_admin'].includes(auth.user.role)) throw new HttpError(403,'metadata_admin_required','Registry administrator authority is required');
  requireCsrf(request,auth);
  return auth;
}
function fieldProjection(row: FieldRow): MetadataField {
  return { key: row.field_key,revision: Number(row.revision),latest_version: Number(row.latest_version),active_version: row.active_version === null ? null : Number(row.active_version),definition_version: Number(row.definition_version),definition: JSON.parse(row.definition_json) as MetadataDefinition };
}
async function readField(db: D1Database,key: string): Promise<FieldRow> {
  const row = await db.prepare(`SELECT f.*,v.definition_json,v.version AS definition_version FROM registry_metadata_fields f
    JOIN registry_metadata_versions v ON v.field_key=f.field_key AND v.version=f.latest_version WHERE f.field_key=?`).bind(key).first<FieldRow>();
  if (!row) throw new HttpError(404,'not_found','Supplementary field not found');
  return row;
}
async function readVersion(db: D1Database,key: string,version: number): Promise<MetadataDefinition> {
  const row = await db.prepare('SELECT definition_json FROM registry_metadata_versions WHERE field_key=? AND version=?').bind(key,version).first<{definition_json:string}>();
  if (!row) throw new HttpError(422,'unknown_metadata_version','The requested definition version does not exist');
  return JSON.parse(row.definition_json) as MetadataDefinition;
}
async function catalog(db: D1Database,privileged: boolean): Promise<Response> {
  const rows = (await db.prepare(`SELECT f.*,v.definition_json,v.version AS definition_version FROM registry_metadata_fields f
    JOIN registry_metadata_versions v ON v.field_key=f.field_key AND v.version=${privileged ? 'f.latest_version' : 'f.active_version'}
    ${privileged ? '' : "WHERE f.visibility='public' AND f.active_version IS NOT NULL"}
    ORDER BY f.field_key LIMIT ?`).bind(CATALOG_LIMIT+1).all<FieldRow>()).results;
  return json({ fields: rows.slice(0,CATALOG_LIMIT).map(fieldProjection),limit: CATALOG_LIMIT,truncated: rows.length>CATALOG_LIMIT,supported_workflows: SUPPORTED_WORKFLOWS });
}
async function receipt(context: Context,intent: Intent): Promise<MetadataReceipt | null> {
  const row = await context.db.prepare('SELECT actor_user_id,field_key,horse_id,command,request_digest,response_json FROM registry_metadata_operations WHERE operation_id=?')
    .bind(intent.input.operation_id).first<{actor_user_id:string;field_key:string;horse_id:number|null;command:string;request_digest:string;response_json:string}>();
  if (!row) return null;
  if (row.actor_user_id!==context.auth.user.id || row.field_key!==context.key || row.horse_id!==context.horseId || row.command!==intent.command || row.request_digest!==intent.digest) throw new HttpError(409,'metadata_operation_reused','The operation id belongs to a different command');
  return JSON.parse(row.response_json) as MetadataReceipt;
}
async function begin(context: Context,command: string,input: MetadataCommand): Promise<Intent & { replay: MetadataReceipt | null }> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableMetadataJson({command,key:context.key,horse_id:context.horseId,input}))));
  const intent = { command,input,digest: Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('') };
  return { ...intent,replay: await receipt(context,intent) };
}
async function commit(context: Context,intent: Intent,result: MetadataReceipt,snapshot: unknown,mutations: D1PreparedStatement[],success: Guard): Promise<MetadataReceipt> {
  const {db,auth} = context;
  const receiptJson=JSON.stringify(result);
  // Locks are separate statements, so subsequent predicates see a fresh PG
  // READ COMMITTED snapshot. Horse precedes field to align with identity merges.
  const locks = [
    ...(context.horseId===null ? [] : [db.prepare('UPDATE horses SET row_version=row_version WHERE id=?').bind(context.horseId)]),
    db.prepare('UPDATE registry_metadata_fields SET revision=revision WHERE field_key=?').bind(context.key),
  ];
  const operationGuard='EXISTS(SELECT 1 FROM registry_metadata_operations WHERE operation_id=? AND actor_user_id=? AND request_digest=?)';
  const operationBindings=[intent.input.operation_id,auth.user.id,intent.digest];
  try {
    await db.batch([...locks,...mutations,
      db.prepare(`INSERT INTO registry_metadata_operations(operation_id,actor_user_id,field_key,horse_id,command,request_digest,response_json) SELECT ?,?,?,?,?,?,? WHERE ${success.sql}`)
        .bind(intent.input.operation_id,auth.user.id,context.key,context.horseId,intent.command,intent.digest,receiptJson,...success.bindings),
      db.prepare(`INSERT INTO registry_metadata_history(id,field_key,horse_id,operation_id,actor_user_id,action,snapshot_json,reason) SELECT ?,?,?,?,?,?,?,? WHERE ${operationGuard}`)
        .bind(crypto.randomUUID(),context.key,context.horseId,intent.input.operation_id,auth.user.id,intent.command,JSON.stringify(snapshot),intent.input.reason,...operationBindings),
      db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,after_json,request_id) SELECT ?,?,?,?,?,? WHERE ${operationGuard}`)
        .bind(auth.user.id,`metadata.${intent.command}`,'registry_metadata',context.key,receiptJson,intent.input.operation_id,...operationBindings),
    ]);
  } catch (cause) {
    const replay=await receipt(context,intent); if (replay) return replay;
    if (cause instanceof Error && /UNIQUE constraint failed|duplicate key value/i.test(cause.message)) throw new HttpError(409,'metadata_conflict','The field, version or operation already exists');
    throw cause;
  }
  const stored=await receipt(context,intent);
  if (!stored) throw new HttpError(409,'metadata_state_changed','The field, horse or authorization changed; reload before retrying');
  return stored;
}
function fieldSuccess(context: Context,operationId: string): Guard {
  return { sql: 'EXISTS(SELECT 1 FROM registry_metadata_fields WHERE field_key=? AND last_operation_id=?)',bindings:[context.key,operationId] };
}
async function createField(context: Context,input: ReturnType<typeof MetadataCreateSchema.parse>): Promise<MetadataReceipt> {
  const intent=await begin(context,'create_field',input); if (intent.replay) return intent.replay;
  const guard=adminGuard(context),success=fieldSuccess(context,input.operation_id);
  return commit(context,intent,{field_key:context.key,horse_id:null,revision:1,version:1,operation_id:input.operation_id},input.definition,[
    context.db.prepare(`INSERT INTO registry_metadata_fields(field_key,value_type,visibility,last_operation_id,created_by_user_id)
      SELECT ?,?,?,?,? WHERE ${guard.sql}`).bind(context.key,input.definition.type,input.definition.visibility,input.operation_id,context.auth.user.id,...guard.bindings),
    context.db.prepare(`INSERT INTO registry_metadata_versions(field_key,version,definition_json,created_by_user_id,reason)
      SELECT ?,1,?,?,? WHERE ${success.sql}`).bind(context.key,JSON.stringify(input.definition),context.auth.user.id,input.reason,...success.bindings),
  ],success);
}
async function newVersion(context: Context,input: ReturnType<typeof MetadataVersionSchema.parse>): Promise<MetadataReceipt> {
  const intent=await begin(context,'new_version',input); if (intent.replay) return intent.replay;
  const field=await readField(context.db,context.key);
  if (Number(field.revision)!==input.expected_revision) throw new HttpError(409,'metadata_state_changed','The field changed; reload before creating another version');
  if (field.value_type!==input.definition.type || field.visibility!==input.definition.visibility) throw new HttpError(422,'metadata_migration_required','Type and visibility are immutable; a separately reviewed migration must move values to a new field');
  if (field.latest_version>=100) throw new HttpError(422,'metadata_version_budget','Archive or migrate the field before adding more than 100 definition versions');
  const guard=adminGuard(context),success=fieldSuccess(context,input.operation_id),version=Number(field.latest_version)+1;
  return commit(context,intent,{field_key:context.key,horse_id:null,revision:input.expected_revision+1,version,operation_id:input.operation_id},input.definition,[
    context.db.prepare(`UPDATE registry_metadata_fields SET latest_version=?,revision=revision+1,last_operation_id=?,updated_at=CURRENT_TIMESTAMP
      WHERE field_key=? AND revision=? AND ${guard.sql}`).bind(version,input.operation_id,context.key,input.expected_revision,...guard.bindings),
    context.db.prepare(`INSERT INTO registry_metadata_versions(field_key,version,definition_json,created_by_user_id,reason)
      SELECT ?,?,?,?,? WHERE ${success.sql}`).bind(context.key,version,JSON.stringify(input.definition),context.auth.user.id,input.reason,...success.bindings),
  ],success);
}
async function activate(context: Context,input: ReturnType<typeof MetadataActivationSchema.parse>): Promise<MetadataReceipt> {
  const intent=await begin(context,'activate',input); if (intent.replay) return intent.replay;
  const field=await readField(context.db,context.key);
  if (Number(field.revision)!==input.expected_revision) throw new HttpError(409,'metadata_state_changed','The field changed; reload before activation');
  if (input.version!==null) await readVersion(context.db,context.key,input.version);
  const guard=adminGuard(context),success=fieldSuccess(context,input.operation_id);
  return commit(context,intent,{field_key:context.key,horse_id:null,revision:input.expected_revision+1,version:input.version??0,operation_id:input.operation_id},
    {previous_active_version:field.active_version,active_version:input.version},[
      context.db.prepare(`UPDATE registry_metadata_fields SET active_version=?,revision=revision+1,last_operation_id=?,updated_at=CURRENT_TIMESTAMP
        WHERE field_key=? AND revision=? AND ${guard.sql}`).bind(input.version,input.operation_id,context.key,input.expected_revision,...guard.bindings),
    ],success);
}
async function saveValue(context: Context,input: ReturnType<typeof MetadataValueSchema.parse>): Promise<MetadataReceipt> {
  const intent=await begin(context,'save_value',input); if (intent.replay) return intent.replay;
  const field=await readField(context.db,context.key);
  if (Number(field.active_version)!==input.definition_version) throw new HttpError(409,'metadata_version_inactive','Use the currently active definition version');
  const definition=await readVersion(context.db,context.key,input.definition_version),value=validateMetadataValue(definition,input.value);
  const filterValue=(definition.type==='boolean'||definition.type==='select')&&value!==null ? String(value) : null;
  const auth=adminGuard(context);
  const guard={sql:`${auth.sql} AND EXISTS(SELECT 1 FROM horses WHERE id=? AND deleted_at IS NULL)
    AND EXISTS(SELECT 1 FROM registry_metadata_fields WHERE field_key=? AND active_version=? AND revision=?)`,bindings:[...auth.bindings,context.horseId!,context.key,input.definition_version,Number(field.revision)]};
  const version=input.expected_version+1;
  const statement=input.expected_version===0
    ? context.db.prepare(`INSERT INTO registry_metadata_values(horse_id,field_key,definition_version,version,value_json,filter_value,source_ref,evidence_ref,updated_by_user_id,last_operation_id)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`)
      .bind(context.horseId,context.key,input.definition_version,version,JSON.stringify(value),filterValue,input.source_ref,input.evidence_ref??null,context.auth.user.id,input.operation_id,...guard.bindings)
    : context.db.prepare(`UPDATE registry_metadata_values SET definition_version=?,version=version+1,value_json=?,filter_value=?,source_ref=?,evidence_ref=?,updated_by_user_id=?,last_operation_id=?,updated_at=CURRENT_TIMESTAMP
        WHERE horse_id=? AND field_key=? AND version=? AND ${guard.sql}`)
      .bind(input.definition_version,JSON.stringify(value),filterValue,input.source_ref,input.evidence_ref??null,context.auth.user.id,input.operation_id,context.horseId,context.key,input.expected_version,...guard.bindings);
  const success={sql:'EXISTS(SELECT 1 FROM registry_metadata_values WHERE horse_id=? AND field_key=? AND last_operation_id=?)',bindings:[context.horseId!,context.key,input.operation_id]};
  return commit(context,intent,{field_key:context.key,horse_id:context.horseId,revision:Number(field.revision),version,operation_id:input.operation_id},
    {definition_version:input.definition_version,version,value,source_ref:input.source_ref,evidence_ref:input.evidence_ref??null},[statement],success);
}
async function horseValues(db: D1Database,horseId: number,privileged: boolean): Promise<Response> {
  if (!await db.prepare(`SELECT id FROM horses WHERE id=? AND deleted_at IS NULL ${privileged?'':'AND is_active=1'}`).bind(horseId).first()) throw new HttpError(404,'not_found','Horse not found');
  const rows=(await db.prepare(`SELECT v.field_key,v.definition_version,v.version,v.value_json,v.source_ref,v.evidence_ref,v.updated_at,d.definition_json
    FROM registry_metadata_values v JOIN registry_metadata_fields f ON f.field_key=v.field_key
    JOIN registry_metadata_versions d ON d.field_key=v.field_key AND d.version=v.definition_version
    JOIN horses h ON h.id=v.horse_id WHERE v.horse_id=? AND h.deleted_at IS NULL
    ${privileged?'':"AND h.is_active=1 AND f.visibility='public' AND f.active_version IS NOT NULL AND v.value_json<>'null'"}
    ORDER BY v.field_key LIMIT 101`).bind(horseId).all<{field_key:string;definition_version:number;version:number;value_json:string;definition_json:string;source_ref:string;evidence_ref:string|null;updated_at:string}>()).results;
  return json({horse_id:horseId,values:rows.slice(0,100).map(({value_json,definition_json,source_ref,evidence_ref,...value})=>({...value,value:JSON.parse(value_json),definition:JSON.parse(definition_json),...(privileged?{source_ref,evidence_ref}:{})})),limit:100,truncated:rows.length>100});
}
async function filter(db: D1Database,key: string,url: URL): Promise<Response> {
  const field=await db.prepare("SELECT active_version FROM registry_metadata_fields WHERE field_key=? AND visibility='public' AND active_version IS NOT NULL").bind(key).first<{active_version:number}>();
  if (!field) throw new HttpError(404,'not_found','Supplementary filter not found');
  const definition=await readVersion(db,key,Number(field.active_version));
  if (!definition.filter_enabled) throw new HttpError(404,'not_found','Supplementary filter not found');
  const raw=url.searchParams.get('value');
  const value=validateMetadataValue(definition,definition.type==='boolean' ? raw==='true'?true:raw==='false'?false:raw : raw);
  if (value===null) throw new HttpError(422,'filter_value_required','A controlled filter value is required');
  const offset=Number(url.searchParams.get('offset')??0);
  if (!Number.isSafeInteger(offset)||offset<0||offset>10000) throw new HttpError(422,'invalid_offset','Offset must be from 0 to 10000');
  const rows=(await db.prepare(`SELECT h.id,h.name_latin,h.name_native FROM registry_metadata_values v JOIN horses h ON h.id=v.horse_id
    JOIN registry_metadata_fields f ON f.field_key=v.field_key WHERE v.field_key=? AND v.filter_value=? AND h.deleted_at IS NULL AND h.is_active=1
    AND f.visibility='public' AND f.active_version=? AND v.definition_version=f.active_version ORDER BY h.id LIMIT 51 OFFSET ?`).bind(key,String(value),field.active_version,offset).all()).results;
  return json({horses:rows.slice(0,50),limit:50,offset,next_offset:rows.length>50?offset+50:null});
}

export async function routeRegistryMetadata(request: Request,env: Env,url: URL): Promise<Response | null> {
  const path=url.pathname,method=request.method;
  const horse=/^\/api\/(admin\/)?horses\/([1-9]\d*)\/supplementary(?:\/(extra_[a-z][a-z0-9_]{1,53}|history))?$/.exec(path);
  const field=/^\/api\/admin\/metadata\/fields\/(extra_[a-z][a-z0-9_]{1,53})(?:\/(versions|activate))?$/.exec(path);
  const publicFilter=/^\/api\/registry\/metadata\/(extra_[a-z][a-z0-9_]{1,53})\/filter$/.exec(path);
  if (!horse&&!field&&!publicFilter&&path!=='/api/registry/metadata'&&path!=='/api/admin/metadata/fields') return null;
  if (horse&&!Number.isSafeInteger(Number(horse[2]))) throw new HttpError(400,'invalid_horse_id','Invalid horse identifier');
  if (path==='/api/registry/metadata'&&method==='GET') return catalog(env.DB,false);
  if (publicFilter&&method==='GET') return filter(env.DB,publicFilter[1]!,url);
  if (horse&&!horse[1]&&method==='GET'&&!horse[3]) return horseValues(env.DB,Number(horse[2]),false);
  const auth=await admin(request,env);
  if (path==='/api/admin/metadata/fields'&&method==='GET') return catalog(env.DB,true);
  if (horse) {
    const horseId=Number(horse[2]);
    if (!Number.isSafeInteger(horseId)) throw new HttpError(400,'invalid_horse_id','Invalid horse identifier');
    if (horse[1]&&method==='GET'&&!horse[3]) return horseValues(env.DB,horseId,true);
    if (horse[1]&&method==='GET'&&horse[3]==='history') {
      if (!await env.DB.prepare('SELECT id FROM horses WHERE id=? AND deleted_at IS NULL').bind(horseId).first()) throw new HttpError(404,'not_found','Horse not found');
      const rows=(await env.DB.prepare('SELECT field_key,action,actor_user_id,reason,created_at,snapshot_json FROM registry_metadata_history WHERE horse_id=? ORDER BY created_at DESC,id DESC LIMIT 101').bind(horseId).all<{snapshot_json:string}>()).results;
      return json({horse_id:horseId,history:rows.slice(0,100).map(({snapshot_json,...entry})=>({...entry,snapshot:JSON.parse(snapshot_json)})),limit:100,truncated:rows.length>100});
    }
    if (horse[1]&&method==='PUT'&&horse[3]&&horse[3]!=='history') {
      const input=parseMetadata(MetadataValueSchema,await readJson(request,16384));
      return json({receipt:await saveValue({db:env.DB,auth,key:horse[3],horseId},input)});
    }
  }
  if (path==='/api/admin/metadata/fields'&&method==='POST') {
    const input=parseMetadata(MetadataCreateSchema,await readJson(request,32768));
    return json({receipt:await createField({db:env.DB,auth,key:input.key,horseId:null},input)},{status:201});
  }
  if (field) {
    const key=parseMetadata(MetadataKey,field[1]),context={db:env.DB,auth,key,horseId:null};
    if (method==='GET'&&!field[2]) {
      const current=await readField(env.DB,key);
      const versions=(await env.DB.prepare('SELECT version,definition_json,created_at,reason FROM registry_metadata_versions WHERE field_key=? ORDER BY version DESC LIMIT 100').bind(key).all<{version:number;definition_json:string;created_at:string;reason:string}>()).results;
      const history=(await env.DB.prepare('SELECT action,actor_user_id,reason,created_at,snapshot_json FROM registry_metadata_history WHERE field_key=? AND horse_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 101').bind(key).all<{snapshot_json:string}>()).results;
      return json({field:fieldProjection(current),versions:versions.map(({definition_json,...version})=>({...version,definition:JSON.parse(definition_json)})),history:history.slice(0,100).map(({snapshot_json,...entry})=>({...entry,snapshot:JSON.parse(snapshot_json)})),history_truncated:history.length>100});
    }
    if (method==='POST'&&field[2]==='versions') return json({receipt:await newVersion(context,parseMetadata(MetadataVersionSchema,await readJson(request,32768)))},{status:201});
    if (method==='POST'&&field[2]==='activate') return json({receipt:await activate(context,parseMetadata(MetadataActivationSchema,await readJson(request,8192)))});
  }
  throw new HttpError(405,'method_not_allowed','This supplementary metadata route does not support the requested method');
}
