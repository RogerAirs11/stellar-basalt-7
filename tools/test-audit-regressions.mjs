import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const nativeRequire = createRequire(import.meta.url);
nativeRequire("./lib/register-typescript.cjs");
const { openLocalSqlite } = nativeRequire("../src/db/localSqlite.ts");
import { compileTsRuntime } from "./ts-runtime-loader.mjs";

const rt = compileTsRuntime([
  "src/api/http.ts", "src/auth/publicAuthPolicy.ts", "src/api/modules/mediaPolicy.ts",
  "src/db/sqliteSqlToPostgres.ts", "src/security/rateLimit.ts", "src/security/classify.ts",
  "src/registry/query.ts", "src/ai/runtime/quotaGovernor.ts", "src/pedigree/breeding.ts",
]);
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`); };
const load = path => rt.load(`src/${path}`);
try {
  const http = load("api/http.ts");
  const auth = load("auth/publicAuthPolicy.ts");
  const media = load("api/modules/mediaPolicy.ts");
  const { sqliteSqlToPostgres: pg } = load("db/sqliteSqlToPostgres.ts");
  const limits = load("security/rateLimit.ts");
  const { classifyApiRateLimit } = load("security/classify.ts");
  const { parseBoundedIntegerParam } = load("registry/query.ts");
  const { reserveGeminiAttempt } = load("ai/runtime/quotaGovernor.ts");
  const { classifyBreedingSex } = load("pedigree/breeding.ts");
  await test("missing and empty pagination use intended fallback", () => {
    assert.equal(parseBoundedIntegerParam(null,20,1,60,"limit"),20);
    assert.equal(parseBoundedIntegerParam(" ",20,1,60,"limit"),20);
    for (const raw of ["NaN","0","1.5","61","99999999999999999999"]) assert.throws(()=>parseBoundedIntegerParam(raw,20,1,60,"limit"),{status:400});
  });
  await test("bounded body accepts exact byte boundary and JSON", async () => {
    assert.equal(await http.readTextBody(new Request("https://audit.test",{method:"POST",body:"1234"}),4),"1234");
    assert.deepEqual(await http.readJson(new Request("https://audit.test",{method:"POST",headers:{"content-type":"application/json"},body:'{"ok":true}'}),11),{ok:true});
  });
  await test("bounded form and lying length are rejected", async () => {
    await assert.rejects(http.readTextBody(new Request("https://audit.test",{method:"POST",headers:{"content-length":"1"},body:"12345"}),4),{status:413});
    await assert.rejects(http.readTextBody(new Request("https://audit.test",{method:"POST",body:new Uint8Array([0xc3,0x28])}),4),{status:400});
  });
  await test("oversize cloned account probe does not hang waiting for its unread twin", async () => {
    const req=new Request("https://audit.test/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"audit@example.test",padding:"x".repeat(9000)})});
    let calls=0;
    const op=limits.enforceAccountLoginLimit(req,{ACCOUNT_RATE_LIMITER:{limit:async()=>{calls++;return{success:true}}}});
    let timer;
    try { await assert.rejects(Promise.race([op,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("probe timed out")),1500)})]),{status:413}); }
    finally { clearTimeout(timer); void req.body.cancel().catch(()=>{}); }
    assert.equal(calls,0);
  });
  await test("Iranian numbers normalize Persian and Arabic numerals", () => {
    for (const input of ["0912 123 4567","+989121234567","00989121234567","\u06f0\u06f9\u06f1\u06f2\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7","\u0660\u0669\u0661\u0662\u0661\u0662\u0663\u0664\u0665\u0666\u0667"]) assert.equal(auth.normalizeIranianPhone(input),"+989121234567");
    assert.equal(auth.normalizeIranianPhone("+14155552671"),null);
  });
  await test("production and unknown modes never expose demo OTP flow", () => {
    for (const env of [{},{APP_ENV:"production"},{APP_ENV:"staging"}]) assert.throws(()=>auth.requireDemoOtpEnvironment(env),{status:503,code:"sms_unavailable"});
    for (const mode of ["test","development","local"]) auth.requireDemoOtpEnvironment({APP_ENV:mode});
  });
  await test("all public auth mutations get the auth limiter", () => {
    for (const tail of ["login","register","otp/request","otp/verify","verify-email"]) assert.equal(classifyApiRateLimit(`/api/auth/${tail}`,"POST"),"auth");
    assert.equal(classifyApiRateLimit("/api/horses","POST"),"write");
  });
  await test("phone limiter hashes one normalized identity without exposing the phone", async () => {
    let key;
    const db = openLocalSqlite(":memory:");
    await db.exec(readFileSync("migrations/0040_rate_limit_counters.sql", "utf8"));
    await limits.enforceAccountLoginLimit(new Request("https://audit.test/api/auth/otp/verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({phone:"09121234567",code:"123456"})}),{DB:db,ACCOUNT_RATE_LIMITER:{limit:async v=>{key=v.key;return{success:true}}}});
    assert.match(key,/^otp-account:[a-f0-9]{64}$/);assert.ok(!key.includes("0912"));
    const row = await db.prepare("SELECT key,count FROM rate_limit_counters").first();
    assert.equal(row.key, `d1:${key}`); assert.equal(row.count, 1);
  });
  await test("unknown consent is private; explicitly shared, non-rejected photos are public", () => {
    const owner={user:{id:"u1",role:"editor"}}, stranger={user:{id:"u2",role:"editor"}}, admin={user:{id:"a",role:"admin"}};
    const file={media_type:"document",role:"veterinary",verification:"pending",uploaded_by_user_id:"u1"};
    assert.equal(media.canReadMedia(file),false);assert.equal(media.canReadMedia(file,stranger),false);
    assert.equal(media.canReadMedia(file,owner),true);assert.equal(media.canReadMedia(file,admin),true);
    assert.equal(media.canReadMedia({...file,verification:"federation_verified"}),false);
    assert.equal(media.canReadMedia({...file,media_type:"photo",role:"gallery",verification:"owner_submitted"}),false);
    assert.equal(media.canReadMedia({...file,media_type:"photo",role:"gallery",verification:"owner_submitted",consent_state:"shared_public"}),true);
    assert.equal(media.canReadMedia({...file,media_type:"photo",role:"gallery",verification:"rejected",consent_state:"shared_public"}),false);
  });
  await test("Farsi filenames are legal header values and cannot inject headers", () => {
    const result=media.mediaContentDisposition("\u0627\u0633\u0628\r\nBad: value.pdf",true);
    new Headers({"content-disposition":result});
    assert.ok(!result.includes("\r")&&!result.includes("\n"));assert.match(result,/filename\*=UTF-8''%D8/);
    assert.doesNotThrow(()=>new Headers({"content-disposition":media.mediaContentDisposition("x".repeat(239)+"\uD83D\uDC0E\uD800.pdf",true)}));
  });
  await test("base64 errors are controlled and sizes checked before decoding", () => {
    assert.throws(()=>media.decodeMediaBase64("!!!!",100),{status:400});
    assert.throws(()=>media.decodeMediaBase64("AAAA".repeat(10),3),{status:413});
    assert.equal(media.decodeMediaBase64("data:image/png;base64,AQID",3).length,3);
    assert.throws(()=>media.decodeMediaBase64("AQID",2),{status:413});
  });
  await test("file signature checks reject spoofed MIME", () => {
    assert.equal(media.hasExpectedMediaSignature(new TextEncoder().encode("<script>bad</script>"),"image/png"),false);
    assert.equal(media.hasExpectedMediaSignature(new Uint8Array([137,80,78,71,13,10,26,10]),"image/png"),true);
    assert.equal(media.hasExpectedMediaSignature(new TextEncoder().encode("%PDF-1.7"),"application/pdf"),true);
  });
  await test("normal PostgreSQL INSERT no longer suppresses uniqueness failures", () => {
    assert.equal(pg("INSERT INTO users(id,email) VALUES(?,?)"),"INSERT INTO users(id,email) VALUES($1,$2)");
    assert.match(pg("INSERT OR IGNORE INTO t(id) VALUES(?)"),/ON CONFLICT DO NOTHING$/);
    assert.ok(!pg("INSERT INTO t(id) VALUES(?) ON CONFLICT(id) DO UPDATE SET id=excluded.id").includes("DO NOTHING"));
  });
  await test("explicit NOCASE email equality preserved; plain equality remains plain", () => {
    assert.equal(pg("SELECT id FROM users WHERE email=? COLLATE NOCASE"),"SELECT id FROM users WHERE LOWER(email)=LOWER($1)");
    assert.equal(pg("SELECT id FROM users WHERE email=?"),"SELECT id FROM users WHERE email=$1");
  });
  await test("null-class conflict expression maps to PostgreSQL COALESCE", () => {
    assert.ok(pg("INSERT INTO t(a,b,c) VALUES(?,?,?) ON CONFLICT(a,b,IFNULL(c,'')) DO UPDATE SET c=excluded.c").includes("ON CONFLICT(a,b,COALESCE(c,''))"));
    assert.ok(pg("SELECT id FROM t WHERE datetime(expires_at)>datetime('now')").includes("::timestamptz"));
  });
  await test("recorded sex classification does not mistake female for male", () => {
    assert.equal(classifyBreedingSex("female"),"female");assert.equal(classifyBreedingSex("male"),"male");
    assert.equal(classifyBreedingSex("\u0645\u0627\u062f\u06cc\u0627\u0646"),"female");
    assert.equal(classifyBreedingSex("\u0646\u0631\u06cc\u0627\u0646"),"male");assert.equal(classifyBreedingSex(""),"unknown");
  });
  await test("unwritable quota ledger stops provider work, not an unmetered read-only fallback", async () => {
    const db={prepare:()=>({bind(){return this},run:async()=>{throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row write limit")}})};
    await assert.rejects(reserveGeminiAttempt(db,{id:"audit",conversationId:null,model:"gemini-3.5-flash-lite",estimatedInputTokens:100,quota:{rpmLimit:10,inputTpmLimit:100000,rpdLimit:200,reserveFraction:.2}}),{code:"gemini_reservation_unavailable"});
  });
  await test("frontend source wiring uses real competition and foal fields", () => {
    const profile=readFileSync("src/web/frontends/retro-astra/transplant/pages/Profile.tsx","utf8");
    const desk=readFileSync("src/web/frontends/retro-astra/transplant/pages/PlatformDesk.tsx","utf8");
    assert.ok(!profile.includes("row.placing")&&!desk.includes("row.placing"));
    assert.ok(profile.includes("row.horse.foal_id")&&profile.includes("row.test_type"));
    assert.ok(desk.includes("COMPETITION_DISCIPLINES.map"));
  });
  console.log(`\n${passed} audit regression groups passed. Source wiring checks are not browser/E2E certification.`);
} finally { rt.cleanup(); }
