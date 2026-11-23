import { describe,expect,it } from "vitest";
import worker from "../../src/worker";
import { openRealDatabase,seedUser,makeSession,authedRequest,type AuthedSession } from "../helpers/realDatabase";
import { getAuth } from "../../src/auth/session";
import { mediaFixture } from "../helpers/mediaFixtures";
import type { D1Database,D1PreparedStatement } from "@cloudflare/workers-types";
const secret="synthetic-local-signing-secret-never-production";
const privateId="14800000-1111-4111-8111-000000000001",publicId="14800000-1111-4111-8111-000000000002";
const limiter={limit:async()=>({success:true})};
function http(db:D1Database,path:string,body?:unknown,session?:AuthedSession){return (worker as unknown as {fetch(r:Request,e:unknown):Promise<Response>}).fetch(authedRequest(path,body,{session}),{
  DB:db,DB_PROVIDER_MODE:"d1_only",APP_ENV:"test",SESSION_COOKIE_NAME:"hr_session",MFA_MODE:"optional",MEDIA_ACCESS_TOKEN_SECRET:secret,
  ASSETS:{fetch:async()=>new Response("unused")},PUBLIC_RATE_LIMITER:limiter,AUTH_RATE_LIMITER:limiter,EXPENSIVE_RATE_LIMITER:limiter,WRITE_RATE_LIMITER:limiter,ACCOUNT_RATE_LIMITER:limiter,
});}
async function fixture(){
  const db=await openRealDatabase();for(const [id,role] of [["pm-admin","admin"],["pm-reader","user"],["pm-other","user"]])await seedUser(db,id!,role!);
  await db.exec("INSERT INTO horses(id,name_latin) VALUES(14801,'Synthetic evidence horse')");
  const document=new TextEncoder().encode("%PDF-1.4\nPRIVATE-MFA-BYTE-SENTINEL\n%%EOF"),photo=mediaFixture("metadata.png");
  await db.prepare(`INSERT INTO horse_media(id,horse_id,media_type,role,file_name,mime_type,size_bytes,uploaded_by_user_id,consent_state,verification)
    VALUES(?,14801,'document','veterinary','PRIVATE-MFA-METADATA.pdf','application/pdf',?,'pm-admin','private','pending'),
      (?,14801,'photo','gallery','public.png','image/png',?,'pm-admin','shared_public','federation_verified')`).bind(privateId,document.length,publicId,photo.length).run();
  for(const [id,bytes] of [[privateId,document],[publicId,photo]] as const)await db.prepare("INSERT INTO horse_media_blobs(media_id,chunk,data) VALUES(?,0,?)").bind(id,bytes).run();
  await db.exec(`INSERT INTO professional_access_grants(id,horse_id,grantee_user_id,professional_kind,permissions,authority_ref,assignment_ref,basis,granted_by_user_id,valid_from)
    VALUES('pm-export',14801,'pm-reader','veterinarian','private_file_export','SYNTHETIC-AUTHORITY','SYNTHETIC-EXPORT','admin_grant','pm-admin','2020-01-01')`);
  const reader=await makeSession(db,"pm-reader"),admin=await makeSession(db,"pm-admin"),other=await makeSession(db,"pm-other");
  return {db,reader,admin,other};
}
async function enrollSyntheticFactor(db:D1Database,session:AuthedSession){
  // Cryptographic enrollment is tested separately by the real MFA command
  // suite. Here a synthetic factor isolates the SQL assurance/read boundary.
  await db.prepare("INSERT INTO auth_mfa_factors(user_id,factor_version,secret_ciphertext) VALUES(?,1,'synthetic-enrolled-factor-placeholder')").bind(session.userId).run();
}
async function assure(db:D1Database,session:AuthedSession){
  const auth=await getAuth(db,authedRequest("/api/auth/me",undefined,{session}),"hr_session");expect(auth).not.toBeNull();
  await db.prepare(`INSERT INTO auth_mfa_session_assurance(session_id,user_id,factor_version,token_hash,verified_at,expires_at,method)
    VALUES(?,?,1,?,CURRENT_TIMESTAMP,datetime('now','+15 minutes'),'totp') ON CONFLICT(session_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at`)
    .bind(auth!.sessionId,auth!.user.id,auth!.sessionTokenHash!).run();
  return auth!;
}
function beforeRead(db:D1Database,needle:string,action:()=>Promise<unknown>):D1Database{
  let fired=false;return {...db,prepare(sql:string){
    const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>new Proxy(statement,{get(target,key){
      if(key==="bind")return (...values:unknown[])=>wrap(target.bind(...values));
      if(key==="all")return async()=>{if(!fired&&sql.includes(needle)){fired=true;await action();}return target.all();};
      const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
    }});return wrap(db.prepare(sql));
  }} as D1Database;
}

describe("R148 private media uses current session, scoped export and MFA at byte selection",()=>{
  it("preserves public photo reads while unassured uploader/admin and export grantee cannot inspect private metadata or bytes",async()=>{
    const {db,reader,admin}=await fixture();
    for(const actor of [reader,admin]){
      await enrollSyntheticFactor(db,actor);
      expect((await http(db,`/api/media/file/${privateId}`,undefined,actor)).status).toBe(404);
      const listing=await http(db,"/api/horses/14801/media",undefined,actor);expect(listing.status).toBe(200);
      const body=await listing.json() as {counts:{documents:number};media:unknown[]};expect(body.counts.documents).toBe(0);expect(JSON.stringify(body)).not.toContain("PRIVATE-MFA");
    }
    expect((await http(db,`/api/media/file/${publicId}`)).status).toBe(200);
    await assure(db,reader);expect((await http(db,`/api/media/file/${privateId}`,undefined,reader)).status).toBe(200);
    expect(await (await http(db,"/api/horses/14801/media",undefined,reader)).text()).toContain("PRIVATE-MFA-METADATA");
  });
  it("signed private links require the exact same live bearer, not anonymous access or another session of the same user",async()=>{
    const {db,reader,other}=await fixture();await enrollSyntheticFactor(db,reader);await assure(db,reader);
    const minted=await http(db,`/api/media/${privateId}/access`,{},reader);expect(minted.status).toBe(201);
    const link=await minted.json() as {url:string};
    expect((await http(db,link.url)).status).toBe(404);expect((await http(db,link.url,undefined,other)).status).toBe(404);
    expect((await http(db,link.url,undefined,reader)).status).toBe(200);
    const second=await makeSession(db,"pm-reader");await assure(db,second);
    expect((await http(db,`/api/media/file/${privateId}`,undefined,second)).status).toBe(200);
    expect((await http(db,link.url,undefined,second)).status).toBe(404);
  });
  it("assurance expiry invalidates both direct and signed private reads, without affecting public photos",async()=>{
    const {db,reader}=await fixture();await enrollSyntheticFactor(db,reader);await assure(db,reader);
    const link=await (await http(db,`/api/media/${privateId}/access`,{},reader)).json() as {url:string};
    await db.exec("UPDATE auth_mfa_session_assurance SET expires_at='2000-01-01'");
    for(const path of [link.url,`/api/media/file/${privateId}`])expect((await http(db,path,undefined,reader)).status).toBe(404);
    expect((await http(db,`/api/media/file/${publicId}`,undefined,reader)).status).toBe(200);
  });
  it("a grant or bearer revoked at the final chunk query cannot leak bytes",async()=>{
    for(const change of ["grant","session","assurance"]){
      const {db,reader}=await fixture();await enrollSyntheticFactor(db,reader);await assure(db,reader);
      const raced=beforeRead(db,"LEFT JOIN horse_media_blobs",()=>db.exec(change==="grant"?"UPDATE professional_access_grants SET revoked_at=CURRENT_TIMESTAMP":change==="session"?"UPDATE sessions SET token_hash='rotated-away' WHERE user_id='pm-reader'":"DELETE FROM auth_mfa_session_assurance"));
      const reply=await http(raced,`/api/media/file/${privateId}`,undefined,reader);expect(reply.status).toBe(404);expect(await reply.text()).not.toContain("PRIVATE-MFA-BYTE-SENTINEL");
    }
  });
  it("URL revocation does not revoke an independent link, and old unbound grants fail closed",async()=>{
    const {db,reader}=await fixture();
    const first=await (await http(db,`/api/media/${privateId}/access`,{},reader)).json() as {url:string;grant_id:string};
    const second=await (await http(db,`/api/media/${privateId}/access`,{},reader)).json() as {url:string;grant_id:string};
    await db.prepare("UPDATE media_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE token_binding=?").bind(first.grant_id).run();
    expect((await http(db,first.url,undefined,reader)).status).toBe(404);expect((await http(db,second.url,undefined,reader)).status).toBe(200);
    await db.prepare("UPDATE media_access_grants SET granted_to_session_id=NULL WHERE token_binding=?").bind(second.grant_id).run();
    expect((await http(db,second.url,undefined,reader)).status).toBe(404);
  });
  it("grant revocation while minting cannot create a surviving export URL",async()=>{
    const {db,reader}=await fixture();let fired=false;
    const raced={...db,async batch(statements:Parameters<D1Database["batch"]>[0]){if(!fired){fired=true;await db.exec("UPDATE professional_access_grants SET revoked_at=CURRENT_TIMESTAMP");}return db.batch(statements);}} as D1Database;
    expect((await http(raced,`/api/media/${privateId}/access`,{},reader)).status).toBe(404);
    expect(await db.prepare("SELECT COUNT(*) n FROM media_access_grants").first("n")).toBe(0);
  });
});
