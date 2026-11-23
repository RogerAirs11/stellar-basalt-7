#!/usr/bin/env node
/**
 * R120 containment fix — align the LIVE worker's DEMO_PAYMENTS_ENABLED with
 * the remediated checked-in config (wrangler.jsonc sets "0"; the live worker
 * still carried the pre-remediation "1"). The fail-closed triple already
 * makes demo settlement unreachable in production (verified by the
 * inspection script), so this flag change is defense-in-depth, not the
 * primary barrier.
 *
 * Mechanism: read the COMPLETE effective bindings, echo every binding back
 * unchanged except the single plain_text var, PATCH the settings, re-read to
 * verify, then hit the live health endpoint. Secrets are echoed by NAME only
 * (the API requires their presence in the payload as {type: secret_text,
 * name}; the value field is omitted so the stored value is preserved).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Credentials come from the environment (vault TOKENS.md is the documented store).
const CF_ACCOUNT = process.env.CF_ACCOUNT_ID;
const CF_TOKEN = process.env.CF_API_TOKEN;
const WORKER = "horse-registry-nextgen";
if (!CF_ACCOUNT || !CF_TOKEN) { console.error("CF_ACCOUNT_ID and CF_API_TOKEN are required (vault TOKENS.md)"); process.exit(2); }

const evidence = { started: new Date().toISOString(), steps: [], ok: null };
const step = (label, ok, detail) => { evidence.steps.push({ label, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); };

const getSettings = async () => {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/workers/scripts/${WORKER}/settings`, {
    headers: { Authorization: `Bearer ${CF_TOKEN}` },
  });
  const body = await res.json();
  if (!res.ok || !body.success) throw new Error(`settings GET ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
  return body.result;
};

const before = await getSettings();
const bindings = before.bindings ?? [];
const flag = bindings.find(b => b.name === "DEMO_PAYMENTS_ENABLED");
step("current live DEMO_PAYMENTS_ENABLED read", flag?.type === "plain_text", `${flag?.type}:${flag?.text}`);
if (flag?.text === "0") { step("already aligned with the remediated config (no change needed)", true); evidence.ok = true; }
else {
  // Echo-back PATCH: identical bindings except the one var.
  // The Workers Settings API takes multipart/form-data with a "settings" JSON part.
  const patched = bindings.map(b => b.name === "DEMO_PAYMENTS_ENABLED" ? { ...b, text: "0" } : b);
  const form = new FormData();
  form.append("settings", new Blob([JSON.stringify({ bindings: patched })], { type: "application/json" }), "settings.json");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/workers/scripts/${WORKER}/settings`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${CF_TOKEN}` },
    body: form,
  });
  const body = await res.json();
  step("settings PATCH accepted", res.ok && body.success, `${res.status}${res.ok ? "" : " " + JSON.stringify(body.errors ?? body).slice(0, 300)}`);
  const after = await getSettings();
  const afterFlag = (after.bindings ?? []).find(b => b.name === "DEMO_PAYMENTS_ENABLED");
  step("live DEMO_PAYMENTS_ENABLED is now 0", afterFlag?.text === "0", String(afterFlag?.text));
  // Every other binding unchanged?
  const beforeNames = bindings.map(b => `${b.type}:${b.name}`).sort().join(",");
  const afterNames = (after.bindings ?? []).map(b => `${b.type}:${b.name}`).sort().join(",");
  step("all other bindings preserved", beforeNames === afterNames);
  const health = await fetch("https://iraho.ir/api/health");
  const healthBody = await health.json().catch(() => ({}));
  step("live health still OK after the change", health.status === 200 && healthBody.ok === true,
    `HTTP ${health.status} version=${healthBody.applicationVersion ?? "?"}`);
  evidence.ok = evidence.steps.every(s => s.ok);
}

evidence.finished = new Date().toISOString();
mkdirSync(join(root, "review-r120", "evidence-live"), { recursive: true });
writeFileSync(join(root, "review-r120", "evidence-live", "demo-flag-containment-fix.json"), JSON.stringify(evidence, null, 2));
console.log(`[verdict] ${evidence.ok ? "DONE" : "FAILED"} — evidence: review-r120/evidence-live/demo-flag-containment-fix.json`);
process.exit(evidence.ok ? 0 : 1);
