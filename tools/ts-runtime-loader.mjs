import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Compile a small dependency-light slice of src/ to CommonJS for executable
 * Node harnesses without requiring the project's full npm dependency tree.
 * This is validation infrastructure only; production still uses the normal TS/Vite build.
 */
export function compileTsRuntime(entries, options = {}) {
  const root = options.root ?? process.cwd();
  const out = mkdtempSync(join(tmpdir(), "horse-r31-ts-runtime-"));
  const stub = join(out, "cloudflare-test-globals.d.ts");
  writeFileSync(stub, `
    type D1Result<T=Record<string,unknown>> = { success:boolean; results:T[]; meta:any };
    interface D1PreparedStatement { bind(...values:any[]):D1PreparedStatement; first<T=Record<string,unknown>>(columnName?:string):Promise<T|null>; all<T=Record<string,unknown>>():Promise<D1Result<T>>; run<T=Record<string,unknown>>():Promise<D1Result<T>>; }
    interface D1Database { prepare(sql:string):D1PreparedStatement; batch<T=unknown>(statements:D1PreparedStatement[]):Promise<D1Result<any>[]>; exec(sql:string):Promise<any>; dump():Promise<any>; }
    interface DurableObjectStub { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>; }
    interface DurableObjectId { }
    interface DurableObjectNamespaceGetDurableObjectOptions { locationHint?: "wnam"|"enam"|"sam"|"weur"|"eeur"|"apac"|"oc"; }
    interface DurableObjectNamespace { idFromName(name: string): DurableObjectId; get(id: DurableObjectId, options?: DurableObjectNamespaceGetDurableObjectOptions): DurableObjectStub; }
    interface DurableObject { fetch(request: Request): Response | Promise<Response>; }
    interface Env { [key:string]: any; DB:D1Database; AI_DB?:D1Database; APP_ENV?:string; DB_RUNTIME?:any; GEMINI_API_KEY?:string; GEMINI_API_KEYS?:string; DEEPSEEK_API_KEY?:string; AI_GEMINI_WEB_GROUNDING_ENABLED?:string; GEMINI_BASE_URL?:string; GEMINI_RELAY?:DurableObjectNamespace; GEMINI_RELAY_ENABLED?:string; AI_VERTEX_EXPRESS_ENABLED?:string; AI_DIAG_TOKEN?:string; AI_KEY_ENCRYPTION_SECRETS?:string; AI_KEY_ENCRYPTION_SECRET?:string; }
  `);
  try {
    // Resolve the project-local tsc when it exists so DIRECT `node script.mjs`
    // invocations work without npm's node_modules/.bin PATH injection (the
    // plain "tsc" fallback still covers global/CI PATH setups).
    const localTsc = join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
    const tscCommand = existsSync(localTsc) ? localTsc : (process.platform === "win32" ? "tsc.cmd" : "tsc");
    execFileSync(tscCommand, [
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--target", "es2022",
      "--lib", "es2023,dom",
      "--skipLibCheck",
      "--esModuleInterop",
      "--rootDir", "src",
      "--outDir", out,
      ...entries,
      stub,
    ], { cwd: root, stdio: options.stdio ?? "pipe" });
  } catch (error) {
    rmSync(out, { recursive: true, force: true });
    throw error;
  }
  // Compiled slices that import runtime packages (e.g. zod) resolve them from
  // the project's node_modules via a temp-dir symlink.
  if (options.linkNodeModules) {
    try { symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir"); } catch { /* already present */ }
  }
  const require = createRequire(import.meta.url);
  return {
    out,
    load(sourcePath) {
      const rel = relative(join(root, "src"), join(root, sourcePath)).replace(/\.tsx?$/i, ".js");
      return require(join(out, rel));
    },
    cleanup() { rmSync(out, { recursive: true, force: true }); },
  };
}
