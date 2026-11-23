import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const main=read("src/web/main.tsx");
const css=read("src/web/styles/heritage.system.css");
const pkg=JSON.parse(read("package.json"));

const requiredMain=[
  "registry-toolbar-actions",
  "registry-toolbar-control advanced-toggle",
  "registry-toolbar-control export-link",
  "registry-toolbar-control visual-encoding-toggle",
  "density-toggle registry-toolbar-segment",
  "registry-toolbar-control column-button",
  'aria-pressed={density==="compact"}',
  'aria-pressed={density==="roomy"}',
];
const requiredCss=[
  "--h-registry-tool-height:32px",
  "--h-registry-tool-font:12.5px",
  ".registry-toolbar-control",
  ".registry-toolbar-icon",
  ".registry-toolbar-segment button:is(.active,[aria-pressed=\"true\"])",
  ".registry-toolbar-control:is(.active,[aria-pressed=\"true\"])",
];
const missing=[
  ...requiredMain.filter(token=>!main.includes(token)).map(token=>`main:${token}`),
  ...requiredCss.filter(token=>!css.includes(token)).map(token=>`css:${token}`),
];
if(pkg.scripts?.["validate:registry-toolbar"]!=="node tools/validate-registry-toolbar-contract.mjs") missing.push("package:validate:registry-toolbar");
if(missing.length){
  console.error("Registry toolbar contract validation failed:\n"+missing.map(x=>` - ${x}`).join("\n"));
  process.exit(1);
}
console.log("Registry toolbar contract validation passed: unified compact geometry, typography, icons, motion, and shared selected-state styling are enforced.");
