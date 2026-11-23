import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
let ts;
try {
  ts = require("typescript");
} catch {
  const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  ts = require(join(globalRoot, "typescript"));
}

const root = process.cwd();
const files=[];
function walk(dir){
  for(const name of readdirSync(dir,{withFileTypes:true})){
    const p=join(dir,name.name);
    if(name.isDirectory()) walk(p);
    else if([".ts",".tsx"].includes(extname(name.name)) && !name.name.endsWith(".d.ts")) files.push(p);
  }
}
walk(join(root,"src"));
const problems=[];
for(const file of files){
  const text=readFileSync(file,"utf8");
  const kind=file.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS;
  const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,kind);
  for(const d of sf.parseDiagnostics??[]){
    const pos=d.start==null?null:sf.getLineAndCharacterOfPosition(d.start);
    const message=ts.flattenDiagnosticMessageText(d.messageText," ");
    problems.push(`${file.replace(root+"/","")}${pos?`:${pos.line+1}:${pos.character+1}`:""} TS${d.code}: ${message}`);
  }
}
if(problems.length){
  console.error("Production TS/TSX syntax validation FAILED:");
  for(const p of problems) console.error(`  ERROR ${p}`);
  process.exit(1);
}

// Extraction/refactor integrity: parsing alone cannot catch an identifier that was
// left behind when a large inline component is moved into its own module. Build a
// semantic program for the browser source and reject unresolved runtime/type names
// while deliberately ignoring missing package/type-module diagnostics in
// dependency-light environments. Full npm typecheck remains the authoritative
// dependency-backed gate.
const webFiles=files.filter(file=>file.includes(`${join("src","web")}`));
const semanticProgram=ts.createProgram({
  rootNames:webFiles,
  options:{
    noEmit:true,
    skipLibCheck:true,
    jsx:ts.JsxEmit.ReactJSX,
    target:ts.ScriptTarget.ES2022,
    module:ts.ModuleKind.ESNext,
    moduleResolution:ts.ModuleResolutionKind.Bundler,
    lib:["lib.es2022.d.ts","lib.dom.d.ts","lib.dom.iterable.d.ts"],
  },
});
const unresolved=semanticProgram.getSemanticDiagnostics().filter(d=>d.code===2304||d.code===2552);
if(unresolved.length){
  console.error("Production TS/TSX semantic-name validation FAILED:");
  for(const d of unresolved){
    const sf=d.file;
    const pos=sf&&d.start!=null?sf.getLineAndCharacterOfPosition(d.start):null;
    const where=sf?sf.fileName.replace(root+"/",""):"<unknown>";
    const message=ts.flattenDiagnosticMessageText(d.messageText," ");
    console.error(`  ERROR ${where}${pos?`:${pos.line+1}:${pos.character+1}`:""} TS${d.code}: ${message}`);
  }
  process.exit(1);
}
console.log(`Production TS/TSX syntax passed: ${files.length} files, 0 parse diagnostics; browser source has 0 unresolved-name diagnostics.`);
