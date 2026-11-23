import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Credit shared curation only when the native console actually imports and
 * mounts its create and edit forms with the current principal scope. */
export function nativeCurationEvidence(root, nativeSource, frontend) {
  const editor = readFileSync(join(root, "src/frontend-kit/HorseCurationForm.tsx"), "utf8");
  const model = readFileSync(join(root, "src/frontend-kit/horseCuration.ts"), "utf8");
  const problems = [];
  const fromPublicKit = /import \{ HorseCurationForm \} from "[^"\n]*frontend-kit"/.test(nativeSource);
  const fromHostCompatibility = /import \{ HorseCurationForm \} from "[^"\n]*shared\/HorseCurationForm"/.test(nativeSource);
  if (!fromPublicKit && !fromHostCompatibility) problems.push(`${frontend}: shared curation component is not imported`);
  if (fromPublicKit && !readFileSync(join(root, "src/frontend-kit/index.ts"), "utf8").includes('export { HorseCurationForm, StaffHorseLedger } from "./HorseCurationForm"')) problems.push(`${frontend}: public kit does not export the actual curation implementation`);
  if (fromHostCompatibility && !readFileSync(join(root, "src/web/shared/HorseCurationForm.tsx"), "utf8").includes('from "../../frontend-kit/HorseCurationForm"')) problems.push(`${frontend}: host compatibility path does not resolve to the portable curation implementation`);
  const mounts = [...nativeSource.matchAll(/<HorseCurationForm\b([^>]+)>?/g)].map(match => match[1]);
  if (!mounts.some(props => /\shorse=\{/.test(props)) || !mounts.some(props => !/\shorse=\{/.test(props))) problems.push(`${frontend}: both create and existing-record curation must be mounted`);
  if (mounts.some(props => !props.includes("scope="))) problems.push(`${frontend}: private curation must receive the principal scope`);
  for (const marker of ["HORSE_CURATION_FIELD_SPECS.filter", "CURATION_DATE_KEYS.map", "platform.admin.horses.create", "platform.admin.horses.update(record.id, record.row_version", "horseCurationChanges(draft, record", "horseCurationCreate(draft", "staffHorseDetailFields(horse"]) {
    if (!editor.includes(marker)) problems.push(`${frontend}: mounted curation editor is missing ${marker}`);
  }
  return { problems, source: problems.length ? "" : [editor, model].join("\n") };
}
