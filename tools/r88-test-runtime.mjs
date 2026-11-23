import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Real source execution with TypeScript erasure, NOT full project type checking. */
export function sourceRuntime() {
  const require = createRequire(import.meta.url);
  let ts;
  try { ts = require("typescript"); }
  catch {
    const globalRoot = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8" }).trim();
    ts = require(path.join(globalRoot, "typescript"));
  }
  const previous = new Map();
  for (const ext of [".ts", ".tsx"]) {
    previous.set(ext, require.extensions[ext]);
    require.extensions[ext] = (module, filename) => {
      const result = ts.transpileModule(readFileSync(filename, "utf8"), {
        fileName: filename,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
        reportDiagnostics: true,
      });
      const errors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
      if (errors.length) throw new Error(errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
      module._compile(result.outputText, filename);
    };
  }
  return { load: (file) => require(path.resolve(file)), ts, cleanup() {
    for (const [ext, handler] of previous) { if (handler) require.extensions[ext] = handler; else delete require.extensions[ext]; }
  } };
}
