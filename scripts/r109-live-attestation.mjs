#!/usr/bin/env node
/**
 * r109-live-attestation — R109-19 read-only live re-attestation. NO production
 * mutations: worker settings/deployments read, D1/Supabase catalog read-only
 * probes, hosted header probes (GET only). The R109 candidate is NOT deployed;
 * this attests the CURRENT production state and its distance from the candidate.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!TOKEN || !ACCOUNT) { console.error("CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID required"); process.exit(2); }
const HAPI = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`;

async function cf(path) {
  const response = await fetch(`${HAPI}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const body = await response.json();
  return { ok: body.success === true, result: body.result, errors: body.errors };
}

const out = { ticket: "R109-19", mode: "read-only live attestation", probed_at: new Date().toISOString(), sections: {} };

// 1. Worker deployments (which revision is live?).
{
  const deployments = await cf("/workers/scripts/horse-registry-nextgen/deployments?per_page=5");
  const latest = deployments.result?.deployments?.[0];
  out.sections.worker = {
    live_deployment: latest ? { id: latest.id, created: latest.created_on, source: latest.source, strategy: latest.strategy, annotations: latest.annotations } : null,
    recent: (deployments.result?.deployments ?? []).slice(0, 5).map((d) => ({ id: d.id, created: d.created_on })),
    note: "R109 candidate NOT deployed — deployment requires explicit owner approval; production serves the last reviewed deployment until then.",
  };
  console.log("live deployment:", latest?.id, latest?.created_on);
}

// 2. Worker settings/bindings (redacted shapes only).
{
  const settings = await cf("/workers/scripts/horse-registry-nextgen/settings");
  const bindings = settings.result?.bindings ?? [];
  const redacted = bindings.map((b) => ({
    name: b.name,
    type: b.type,
    ...(b.namespace_id ? { namespace_id: b.namespace_id } : {}),
    ...(b.id ? { id: b.id } : {}),
    ...(b.database_id ? { database_id: b.database_id } : {}),
    ...(b.queue ? { queue: typeof b.queue === "object" ? b.queue.name : b.queue } : {}),
  }));
  out.sections.bindings = {
    compatibility_date: settings.result?.compatibility_date,
    observability: settings.result?.observability,
    bindings: redacted,
    note: "Values of secret_text bindings are never returned by the API; shapes only.",
  };
  console.log("bindings:", redacted.map((b) => `${b.name}:${b.type}`).join(", "));
  console.log("compat date:", settings.result?.compatibility_date);
}

// 3. D1 database identity (read-only).
{
  const dbs = await cf("/d1/database?per_page=100");
  out.sections.d1 = (dbs.result ?? []).map((d) => ({ name: d.name, uuid: d.uuid, version: d.version, created: d.created_at, num_tables: d.num_tables }));
  console.log("d1 databases:", out.sections.d1.map((d) => d.name).join(", "));
}

// 4. Hosted header probes (GET only; no auth for public paths).
{
  const probes = {};
  const probe = async (label, url) => {
    try {
      const response = await fetch(url, { redirect: "manual" });
      probes[label] = {
        status: response.status,
        location: response.headers.get("location"),
        contentType: response.headers.get("content-type"),
        xContentTypeOptions: response.headers.get("x-content-type-options"),
        frameOptions: response.headers.get("x-frame-options"),
        referrerPolicy: response.headers.get("referrer-policy"),
        contentSecurityPolicy: response.headers.get("content-security-policy")?.slice(0, 120),
        cacheControl: response.headers.get("cache-control"),
        permissionsPolicy: response.headers.get("permissions-policy"),
        xRobotsTag: response.headers.get("x-robots-tag"),
        strictTransportSecurity: response.headers.get("strict-transport-security"),
        server: response.headers.get("server"),
      };
      console.log(`${label}: ${response.status} csp=${probes[label].contentSecurityPolicy ? "set" : "absent"} noindex=${probes[label].xRobotsTag ?? "-"}`);
    } catch (error) {
      probes[label] = { error: String(error).slice(0, 120) };
      console.log(`${label}: ERROR ${probes[label].error}`);
    }
  };
  const BASE = "https://horse-registry-nextgen.rogerfires10.workers.dev";
  await probe("root", `${BASE}/`);
  await probe("health", `${BASE}/api/platform/health`);
  await probe("admin", `${BASE}/admin`);
  await probe("feiManagement", `${BASE}/f/fei-classic/management`);
  await probe("api404", `${BASE}/api/definitely-not-a-route`);
  await probe("apiAuth", `${BASE}/api/auth/me`);
  out.sections.hosted_probes = probes;
}

const path = join(root, "review-r109/evidence/r109-19-live-attestation.json");
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
console.log("report:", path);
