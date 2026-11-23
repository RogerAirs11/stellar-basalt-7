#!/usr/bin/env node
/** Read-only production gate. Never prints origin details, tokens, or API bodies.
 * Scope: the root wrangler.jsonc release, without named --env overrides.
 * This configuration attestation does NOT replace live revocation/race testing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseJsonc(text) {
  // Strip comments and trailing commas without altering quoted URLs/SQL strings.
  let clean='', quoted=false, escaped=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i], next=text[i+1];
    if(quoted) { clean+=c; if(escaped) escaped=false; else if(c==='\\') escaped=true; else if(c==='"') quoted=false; continue; }
    if(c==='"') { quoted=true;clean+=c;continue; }
    if(c==='/' && next==='/') { while(i<text.length && text[i]!=='\n') i++; clean+='\n';continue; }
    if(c==='/' && next==='*') {
      i+=2;while(i<text.length && !(text[i]==='*' && text[i+1]==='/')) {clean+=text[i]==='\n'?'\n':' ';i++;}
      if(i>=text.length) throw new Error('config_invalid_jsonc');i++;clean+=' ';continue;
    }
    clean+=c;
  }
  let result='';quoted=false;escaped=false;
  for(let i=0;i<clean.length;i++) {
    const c=clean[i];
    if(quoted) {result+=c;if(escaped) escaped=false;else if(c==='\\') escaped=true;else if(c==='"') quoted=false;continue;}
    if(c==='"') quoted=true;
    if(c===',') {let j=i+1;while(/\s/.test(clean[j]??'') && j<clean.length)j++;if(clean[j]===']'||clean[j]==='}')continue;}
    result+=c;
  }
  try {return JSON.parse(result);} catch {throw new Error('config_invalid_jsonc');}
}

export async function verifyHyperdriveFreshness(config, env=process.env, fetcher=fetch) {
  if(config?.vars?.APP_ENV !== 'production') throw new Error('production_environment_required');
  if(config.vars.ENABLE_DEMO_ADMIN_LOGIN === '1') throw new Error('production_demo_administrator_forbidden');
  const mode=config.vars.DB_PROVIDER_MODE ?? 'supabase_full';
  if(mode==='d1_only') return {status:'not_applicable',providerMode:mode,reason:'No PostgreSQL authority selected'};
  if(mode!=='supabase_full') throw new Error('provider_mode_not_release_certified');
  const bindings=config.hyperdrive?.filter(item=>item.binding==='SUPABASE_HYPERDRIVE');
  // Direct-URL deployments need their own explicit approved gate rather than an
  // accidental success when the canonical binding was removed or misspelled.
  if(bindings?.length!==1) throw new Error('canonical_hyperdrive_binding_required');
  const id=bindings[0].id, account=env.CLOUDFLARE_ACCOUNT_ID, token=env.CLOUDFLARE_API_TOKEN;
  if(!/^[a-f0-9]{32}$/i.test(id??'')) throw new Error('hyperdrive_id_invalid');
  if(!/^[a-f0-9]{32}$/i.test(account??'') || !token?.trim()) throw new Error('cloudflare_read_credentials_required');
  let response;
  try {
    response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/hyperdrive/configs/${id}`,{
      method:'GET',headers:{authorization:`Bearer ${token}`,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000),
    });
  } catch {throw new Error('hyperdrive_read_failed');}
  if(!response.ok) throw new Error('hyperdrive_read_refused');
  let body;
  try {body=await response.json();} catch {throw new Error('hyperdrive_response_invalid');}
  if(body?.success!==true || body?.result?.id!==id) throw new Error('hyperdrive_response_identity_mismatch');
  if(body.result.caching?.disabled!==true) throw new Error('authority_query_cache_must_be_disabled');
  return {status:'verified_configuration_only',providerMode:mode,binding:'SUPABASE_HYPERDRIVE',hyperdriveId:id,
    cachingDisabled:true,checkedAt:new Date().toISOString(),liveAuthorityRevocationTest:'still_required'};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.length>2) throw new Error('named_environment_and_config_overrides_not_supported');
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    const config=parseJsonc(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
    console.log(JSON.stringify(await verifyHyperdriveFreshness(config),null,2));
  } catch(error) {
    // Every emitted error is a locally generated stage code, not upstream data.
    const allowed=new Set(['config_invalid_jsonc','production_environment_required','production_demo_administrator_forbidden',
      'provider_mode_not_release_certified','canonical_hyperdrive_binding_required','hyperdrive_id_invalid',
      'cloudflare_read_credentials_required','hyperdrive_read_failed','hyperdrive_read_refused','hyperdrive_response_invalid',
      'hyperdrive_response_identity_mismatch','authority_query_cache_must_be_disabled','named_environment_and_config_overrides_not_supported']);
    console.error(`Release freshness gate refused: ${allowed.has(error?.message)?error.message:'configuration_unavailable'}`);
    process.exitCode=1;
  }
}
