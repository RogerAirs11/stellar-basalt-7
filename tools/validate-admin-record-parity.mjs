import { readFileSync } from "node:fs";
import { join } from "node:path";

const root=process.cwd();
const read=p=>readFileSync(join(root,p),"utf8");
const dbTypes=read("src/db/types.ts");
const horseFields=read("src/frontend-kit/horseFields.ts");
const curation=read("src/frontend-kit/horseCuration.ts");
const editor=read("src/frontend-kit/HorseCurationForm.tsx");
const typedColumns=read("src/registry/typedDateValue.ts");
const problems=[];

function quotedArray(source,name){
  const match=source.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`));
  if(!match) throw new Error(`Cannot locate ${name}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
}

const adminFields=quotedArray(dbTypes,"ADMIN_HORSE_DETAIL_FIELDS");
const publicBlock=horseFields.match(/PUBLIC_HORSE_DETAIL_FIELD_SPECS = Object\.freeze\(\[([\s\S]*?)\] as const/)?.[1]??"";
const publicFields=[...publicBlock.matchAll(/spec\("([^"]+)"/g)].map(x=>x[1]);
const staffBlock=horseFields.match(/STAFF_HORSE_DETAIL_FIELD_SPECS = Object\.freeze\(\[([\s\S]*?)\] as const/)?.[1]??"";
const staffFields=[...staffBlock.matchAll(/staffSpec\("([^"]+)"/g)].map(x=>x[1]);
const ordinaryCurationFields=[...curation.matchAll(/field\("([^"]+)"/g)].map(x=>x[1]);
const dateMappings=[...curation.matchAll(/^  ([a-z_]+): \{ columns: \[([^\]]+)\]/gm)].map(match=>({field:match[1],columns:[...match[2].matchAll(/"([^"]+)"/g)].map(value=>value[1])}));
const directMappings=[...curation.matchAll(/export const HORSE_CURATION_COLUMN_FIELDS = \{([^}]+)\}/g)].flatMap(match=>[...match[1].matchAll(/([a-z_]+): "([^"]+)"/g)].map(value=>[value[1],value[2]]));
const mappedColumns=new Map(directMappings);
const curationFields=[...ordinaryCurationFields,...dateMappings.map(value=>value.field)];
for(const {field,columns} of dateMappings){
  const match=typedColumns.match(new RegExp(`^  ${field}: \\{ value: "([^"\\n]+)", precision: "([^"\\n]+)", calendar: "([^"\\n]+)" \\}`,"m"));
  if(!match||JSON.stringify(columns)!==JSON.stringify(match.slice(1)))problems.push(`shared curation ${field} does not match the canonical typed-date storage columns`);
}
if(mappedColumns.get("previous_names")!=="previous_names_json"||!curation.includes("HORSE_CURATION_COLUMN_FIELDS.previous_names"))problems.push("previous_names must hydrate the actual previous_names_json storage array");
const renderedColumns=new Set([...publicFields,...staffFields,"id","row_version",...ordinaryCurationFields.map(field=>mappedColumns.get(field)??field),...dateMappings.flatMap(value=>value.columns)]);
const semanticGap=adminFields.filter(field=>!renderedColumns.has(field));
if(semanticGap.length)problems.push(`staff curation/display coverage missing DB fields: ${semanticGap.join(", ")}`);

// T07: the single source of horse field validation moved to
// src/registry/validation.ts (HORSE_FIELD_SCHEMAS) — direct edits, reviewed
// updates and creates all share it, so editable fields are derived from there.
const registryValidation=read("src/registry/validation.ts");
const schemaBlock=registryValidation.match(/export const HORSE_FIELD_SCHEMAS = \{([\s\S]*?)\n\} as const;/)?.[1]??"";
const editable=[...schemaBlock.matchAll(/^\s{2}([a-zA-Z0-9_]+):/gm)].map(x=>x[1]);
if(!editable.length) problems.push("could not derive editable HORSE_FIELD_SCHEMAS fields");

const frontends={
  Heritage:read("src/web/main.tsx"),
  EquiData:read("src/web/frontends/equidata-elite/governance.tsx"),
};
// The shared editor must render its catalog and use the real privileged SDK.
for(const marker of ["HORSE_CURATION_FIELD_SPECS.filter", "CURATION_DATE_KEYS.map", "draft.dates[key]", "staffHorseDetailFields(horse", "publicHorseDetailFields(horse", "includeEmpty: true", "platform.admin.horses.create", "platform.admin.horses.update(record.id, record.row_version", "horseCurationChanges(draft, record", "horseCurationCreate(draft", "<StaffHorseLedger horse={record}"]){
  if(!editor.includes(marker))problems.push(`shared curation editor missing actual rendering/command integration: ${marker}`);
}
const missingEditable=editable.filter(field=>!curationFields.includes(field));
if(missingEditable.length)problems.push(`shared curation controls missing backend-editable fields: ${missingEditable.join(", ")}`);
for(const [name,source] of Object.entries(frontends)){
  for(const marker of ["admin.horses.get", "admin.horses.archive", 'import { HorseCurationForm }']){
    if(!source.includes(marker))problems.push(`${name}: missing privileged curation integration ${marker}`);
  }
  const mounts=[...source.matchAll(/<HorseCurationForm\b([^>]+)>?/g)].map(value=>value[1]);
  if(mounts.length<2||!mounts.some(value=>/\shorse=\{/.test(value))||!mounts.some(value=>! /\shorse=\{/.test(value)))problems.push(`${name}: shared curation form must be reachable for both create and existing-horse editing`);
  if(mounts.some(value=>!value.includes("scope=")))problems.push(`${name}: private curation forms need the current principal scope`);
}

if(problems.length){
  console.error("Admin record parity validation FAILED:");
  for(const p of problems) console.error(`  ERROR ${p}`);
  process.exit(1);
}
console.log(`Admin record parity passed: ${adminFields.length} privileged DB fields are accounted for; all ${editable.length} backend-editable fields and staff-only identifiers are represented in Heritage/Professional and EquiData create/edit surfaces through the mounted shared typed editor.`);
