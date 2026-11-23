import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { nodeRequest, sendNodeResponse } from "./local-http-bridge";
import { loadEnv, type Plugin, type ViteDevServer } from "vite";
import { openLocalSqlite } from "../src/db/localSqlite";

const LOCAL_AI_ENV_KEYS = [
  "AI_ASSISTANT_ENABLED",
  "AI_GEMINI_ENABLED",
  "GEMINI_API_KEY",
  "GEMINI_API_KEYS",
  "GEMINI_BASE_URL",
  "AI_GEMINI_RPM_LIMIT",
  "AI_GEMINI_INPUT_TPM_LIMIT",
  "AI_GEMINI_RPD_LIMIT",
  "AI_GEMINI_FLASH_LITE_RPM_LIMIT",
  "AI_GEMINI_FLASH_LITE_INPUT_TPM_LIMIT",
  "AI_GEMINI_FLASH_LITE_RPD_LIMIT",
  "AI_GEMINI_FLASH_RPM_LIMIT",
  "AI_GEMINI_FLASH_INPUT_TPM_LIMIT",
  "AI_GEMINI_FLASH_RPD_LIMIT",
  "AI_GEMINI_RESERVE_FRACTION",
  "AI_GEMINI_REPLAY_MAX_TOKENS",
  "AI_GEMINI_COUNT_TOKENS_THRESHOLD_FRACTION",
  "AI_GEMINI_TRANSIENT_429_RETRY_MAX_MS",
  "AI_DEEPSEEK_ENABLED",
  "DEEPSEEK_API_KEY",
  "AI_DEEPSEEK_VISION_ENABLED",
  "AI_DEEPSEEK_MAX_REQUEST_USD",
  "AI_DEEPSEEK_MAX_DAILY_USD",
  "AI_DEEPSEEK_INPUT_ESTIMATE_MULTIPLIER",
  "AI_DEEPSEEK_CACHE_HIT_PER_MILLION_USD",
  "AI_DEEPSEEK_CACHE_MISS_PER_MILLION_USD",
  "AI_DEEPSEEK_OUTPUT_PER_MILLION_USD",
  "AI_CONTEXT_SAFETY_FRACTION",
  "AI_OUTPUT_TOKENS_FAST",
  "AI_OUTPUT_TOKENS_AUTO",
  "AI_OUTPUT_TOKENS_RESEARCH",
  "AI_MAX_TOOL_CALLS_FAST",
  "AI_MAX_TOOL_CALLS_AUTO",
  "AI_MAX_TOOL_CALLS_RESEARCH",
  "AI_MAX_TOOL_ROUNDS_FAST",
  "AI_MAX_TOOL_ROUNDS_AUTO",
  "AI_MAX_TOOL_ROUNDS_RESEARCH",
  "AI_GEMINI_WEB_GROUNDING_ENABLED",
  "AI_OFFLINE_SANDBOX",
] as const;

function readSecretsFileGeminiKeys(root: string): string[] {
  // .env.secrets is the operator's canonical local credentials file (gitignored).
  // It survives .env loss and vite restarts; its GEMINI_KEY_1..N entries keep the
  // assistant alive without any manual export. Never logged, never pushed.
  try {
    const raw = fs.readFileSync(path.join(root, ".env.secrets"), "utf8");
    const keys: Array<{ index: number; value: string }> = [];
    for (const line of raw.split(/\r?\n/)) {
      if (/^\s*#/.test(line)) continue;
      const match = /^\s*GEMINI_KEY_(\d+)\s*=\s*(.+?)\s*$/i.exec(line);
      if (match) keys.push({ index: Number(match[1]), value: match[2] });
      const single = /^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$/i.exec(line);
      if (single) keys.push({ index: 0, value: single[1] });
    }
    return keys.sort((a, b) => a.index - b.index).map(entry => entry.value)
      .filter((value, index, all) => value && all.indexOf(value) === index);
  } catch {
    return [];
  }
}

function localAiEnv(root: string): Record<string, string> {
  // Vite does not automatically copy arbitrary .env values into the custom local
  // Worker env object. Load the sqlite-mode env files explicitly, then let real
  // process environment variables win, matching Vite's normal precedence.
  const fileEnv = loadEnv("sqlite", root, "");
  const merged: Record<string, string | undefined> = { ...fileEnv };
  for (const key of LOCAL_AI_ENV_KEYS) {
    if (process.env[key] !== undefined) merged[key] = process.env[key];
  }

  // Persistent key ring: .env.secrets GEMINI_KEY_* entries back up the usual
  // GEMINI_API_KEY / GEMINI_API_KEYS variables so a deleted .env can never
  // silently disable the assistant between restarts.
  const ring = (merged.GEMINI_API_KEYS ?? "").split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
  for (const key of [merged.GEMINI_API_KEY ?? "", ...readSecretsFileGeminiKeys(root)]) {
    const trimmed = key.trim();
    if (trimmed && !ring.includes(trimmed)) ring.push(trimmed);
  }
  if (ring.length) {
    merged.GEMINI_API_KEY = ring[0];
    merged.GEMINI_API_KEYS = ring.join("\n");
  }

  const out: Record<string, string> = {};
  for (const key of LOCAL_AI_ENV_KEYS) {
    const value = merged[key];
    if (value !== undefined) out[key] = value;
  }

  // Local convenience only: a configured provider key implies the user intends to
  // use the assistant unless they explicitly disabled it. Production keeps the
  // explicit fail-closed feature flag in loadAiConfig().
  const explicitEnabled = merged.AI_ASSISTANT_ENABLED?.trim();
  const hasProviderKey = Boolean(merged.GEMINI_API_KEY?.trim()) || Boolean(merged.GEMINI_API_KEYS?.trim()) || Boolean(merged.DEEPSEEK_API_KEY?.trim());
  if (!explicitEnabled && hasProviderKey) out.AI_ASSISTANT_ENABLED = "1";

  return out;
}

export function localSqliteApiPlugin(root: string): Plugin {
  const sqlitePath = path.resolve(process.env.HORSE_REGISTRY_SQLITE || path.join(root, "data", "generated", "horse-registry.sqlite"));
  const isolatedDemo = process.env.HORSE_REGISTRY_DEMO_MODE === "1";
  const readOnlyDemo = isolatedDemo && process.env.HORSE_REGISTRY_DEMO_READ_ONLY === "1";
  const freshSecret = () => Array.from(randomBytes(32), byte => byte.toString(16).padStart(2, "0")).join("");
  const demoSecrets = isolatedDemo ? { NOTIFICATION_CALLBACK_SECRET: freshSecret(), MEDIA_ACCESS_TOKEN_SECRET: freshSecret() } : {};
  // Never read local provider credentials for the isolated client rehearsal.
  const demoResearch = isolatedDemo && !readOnlyDemo && process.env.HORSE_REGISTRY_DEMO_RESEARCH !== "0";
  const aiEnv: Record<string, string> = isolatedDemo ? {
    AI_ASSISTANT_ENABLED: demoResearch ? "1" : "0", AI_GEMINI_ENABLED: "0", AI_DEEPSEEK_ENABLED: "0",
    AI_OFFLINE_SANDBOX: demoResearch ? "1" : "0", AI_DEMO_REGISTRY_RESEARCH: demoResearch ? "1" : "0",
  } : localAiEnv(root);
  let db: D1Database | null = null;

  return {
    name: "horse-registry-local-sqlite",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      if (!fs.existsSync(sqlitePath)) {
        throw new Error(`Local SQLite database not found: ${sqlitePath}. Run the Smart Launcher so it can generate it from the workbook.`);
      }
      db = openLocalSqlite(sqlitePath, { readOnly: readOnlyDemo });
      console.log(`  ➜  Database: SQLite ${sqlitePath}`);
      console.log("  ➜  Cloudflare/Wrangler: not used for local development");
      const assistantEnabled = aiEnv.AI_ASSISTANT_ENABLED === "1";
      const geminiConfigured = aiEnv.AI_GEMINI_ENABLED !== "0" && Boolean(aiEnv.GEMINI_API_KEY?.trim());
      const deepseekConfigured = aiEnv.AI_DEEPSEEK_ENABLED === "1" && Boolean(aiEnv.DEEPSEEK_API_KEY?.trim());
      const privateEnvPresent = fs.existsSync(path.join(root, ".env"));
      console.log(`  ➜  AI Assistant: ${assistantEnabled ? "enabled" : "disabled"}; provider: ${demoResearch ? "offline registry commands (fictional data only)" : geminiConfigured ? "Gemini" : deepseekConfigured ? "DeepSeek" : "none"}`);
      console.log(`  ➜  AI config: private .env ${privateEnvPresent ? "found" : "not found"}; provider key ${geminiConfigured || deepseekConfigured ? "detected" : "not detected"}`);

      const demoReady = isolatedDemo
        ? db.prepare("SELECT namespace FROM local_demo_manifest WHERE id=1").first<{ namespace: string }>().then(row => {
            if (row?.namespace !== "synthetic:r111") throw new Error("Refusing an unmarked database in isolated demo mode");
          })
        : Promise.resolve();
      // Mark the rejection handled even before the first browser request arrives.
      void demoReady.catch(() => undefined);
      server.middlewares.use(async (req, res, next) => {
        // Vite's SPA fallback otherwise serves the root React host at these
        // public directory URLs, recursively embedding Classic inside itself.
        // Only the fixed installed public entrypoints are rewritten.
        if (req.url && (req.method === "GET" || req.method === "HEAD")) {
          const requested = new URL(req.url, "http://127.0.0.1");
          const publicEntries = ["/classic-registry/", "/demo-pay/", "/demo-workbench/", "/business-model/"];
          if (publicEntries.includes(requested.pathname) && fs.existsSync(path.join(root, "public", requested.pathname, "index.html"))) {
            req.url = requested.pathname + "index.html" + requested.search;
            return next();
          }
        }
        if (!req.url?.startsWith("/api/")) return next();
        const abort = new AbortController();
        const onClose = () => { if (!res.writableFinished) abort.abort(); };
        res.once("close", onClose);
        try {
          await demoReady;
          const request = await nodeRequest(req, abort.signal);
          if (readOnlyDemo && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
            await sendNodeResponse(new Response(JSON.stringify({error:"reference_read_only",message:"This separate synthetic reference copy is read-only. Start the editable demo instance to rehearse changes."}),{status:403,headers:{"content-type":"application/json","cache-control":"no-store"}}),res);
            return;
          }
          if (isolatedDemo && (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")
              || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(request.url).hostname))) {
            await sendNodeResponse(new Response(JSON.stringify({error:"demo_loopback_only",message:"The synthetic demo accepts loopback requests only"}),{status:403,headers:{"content-type":"application/json"}}),res);
            return;
          }
          const workerModule = await server.ssrLoadModule("/src/worker.ts");
          const env = {
            DB: db,
            DB_PROVIDER_MODE: "d1_only", // Explicit local SQLite adapter; production defaults to Supabase.
            APP_ENV: "local",
            // Explicit, local-only rehearsal. No production agreement is inferred.
            EQUINE_CARE_MODE: process.env.EQUINE_CARE_MODE === "local_review" ? "local_review" : "disabled",
            // Explicit local setup only; no production key is generated, read
            // from a provider file, or embedded in the demo/browser bundle.
            MFA_MODE: process.env.MFA_MODE ?? "optional",
            MFA_KEYRING_JSON: process.env.MFA_KEYRING_JSON,
            SESSION_COOKIE_NAME: readOnlyDemo ? "horse_registry_reference_view" : isolatedDemo ? "horse_registry_isolated_demo" : "horse_registry_local_session",
            REGISTRY_DATASET_KIND: isolatedDemo ? "synthetic" : undefined,
            ISOLATED_DEMO_MODE: isolatedDemo ? "1" : "0",
            REGISTRY_WRITE_POLICY: readOnlyDemo ? "read_only" : isolatedDemo ? "isolated_local_only" : undefined,
            BILLING_LIVE_PAYMENTS_ENABLED: "false",
            PAYMENT_TERMINAL_RELEASE_ENABLED: "false",
            DEMO_PAYMENTS_ENABLED: isolatedDemo ? "1" : "0",
            DEMO_NOTIFICATIONS_ENABLED: isolatedDemo ? "1" : "0",
            PAYMENT_CALLBACK_BASE_URL: isolatedDemo ? "http://127.0.0.1:3000" : undefined,
            ...demoSecrets,
            SOURCE_FINGERPRINT: process.env.HORSE_REGISTRY_SOURCE_FINGERPRINT || "",
            ENABLE_DEMO_ADMIN_LOGIN: !readOnlyDemo && process.env.ENABLE_DEMO_ADMIN_LOGIN === "1" && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname) ? "1" : "0",
            ...aiEnv,
            ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) },
          };
          let demoResponse: Response | null = null;
          if (isolatedDemo && ["/api/demo/context", "/api/demo/clock", "/api/demo/run-pending-jobs"].includes(new URL(request.url).pathname)) {
            const controlModule = await server.ssrLoadModule("/tools/local-demo-controls.ts");
            const httpModule = await server.ssrLoadModule("/src/api/http.ts");
            try { demoResponse = await controlModule.localDemoControl(request, env); }
            catch (cause) {
              if (cause instanceof httpModule.HttpError) {
                const httpError = cause as import("../src/api/http").HttpError;
                demoResponse = httpModule.error(httpError.status, httpError.code, httpError.message, httpError.details);
              }
              else throw cause;
            }
          }
          const response = demoResponse ?? await workerModule.default.fetch(request, env);
          if (isolatedDemo) {
            response.headers.set("x-registry-dataset-kind", "synthetic");
            response.headers.set("x-registry-dataset-version", "r111");
            response.headers.set("x-registry-write-policy", readOnlyDemo ? "read_only" : "isolated_local_only");
            response.headers.set("cache-control", "no-store");
          }
          await sendNodeResponse(response, res);
        } catch (error) {
          server.ssrFixStacktrace(error as Error);
          console.error("Local SQLite API request failed");
          if (res.headersSent || res.destroyed) { res.destroy(); return; }
          res.statusCode = 500;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "local_api_error", message: "Local API unavailable; check the server configuration." }));
        } finally {
          res.off("close", onClose);
        }
      });
    },
  };
}
