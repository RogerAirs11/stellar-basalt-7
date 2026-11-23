import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT=process.cwd();
const roots=["src","public/classic-registry","standalone-frontends/classic-v1.4/public"];
const extensions=/\.(?:ts|tsx|js|jsx|json|html)$/;
// Do not ban established terms such as shajareh-nameh or studbook.
// This guard catches agreed editorial regressions, not linguistic correctness.
const forbidden=[
  "رجیستری","کانونی","گفتگو","جستجو","استادبوک","دفتر انساب",
  "ارزش تولیدمثلی","ارزش اصلاح‌نژادی","خط تبار","بک‌اند","فرانت‌اند",
  "پالایه","واگرد","زادسال","تاریخ فوت","درگذشته",
];
const problems=[];
function walk(dir,out=[]){
  for(const name of readdirSync(dir)){
    const p=join(dir,name),st=statSync(p);
    if(st.isDirectory()){if(!["node_modules","dist","data",".git","donor-apps"].includes(name))walk(p,out)}
    else if(extensions.test(name)&&!name.endsWith(".map"))out.push(p);
  }
  return out;
}
for(const root of roots){
  for(const file of walk(join(ROOT,root))){
    const text=readFileSync(file,"utf8");
    for(const token of forbidden)if(text.includes(token))problems.push(`${relative(ROOT,file)} contains deprecated public Persian term: ${token}`);
  }
}
const panel=readFileSync(join(ROOT,"src/frontend-kit/ai/AssistantPanel.tsx"),"utf8");
for(const token of ["localizeAiStatus","localizeAiError","localizeEvidenceTitle","localizeEntityLabel","گفت‌وگو"]){
  if(!panel.includes(token))problems.push(`AssistantPanel localization wiring missing: ${token}`);
}
const aiLocale=readFileSync(join(ROOT,"src/frontend-kit/ai/localization.ts"),"utf8");
for(const token of ["provider_retry","researching","pedigree_calculation","ضریب هم‌خونی","جست‌وجو","در حال انجام درخواست"]){
  if(!aiLocale.includes(token))problems.push(`AI localization authority missing: ${token}`);
}
const analysisLocale=readFileSync(join(ROOT,"src/frontend-kit/analysisLocale.ts"),"utf8");
for(const token of ["ارزش اصلاحی","ضریب هم‌خونی","خط خونی","bounded-pedigree-path-atlas","توضیح تحلیلی این مورد هنوز به فارسی بومی‌سازی نشده است"]){
  if(!analysisLocale.includes(token))problems.push(`Analysis localization authority missing: ${token}`);
}
if(problems.length){console.error("Language/localization validation FAILED:");for(const p of problems)console.error(`  ERROR ${p}`);process.exit(1)}
console.log(`Language/localization validation passed: ${roots.length} runtime source roots scanned; deprecated Persian terminology absent; AI/science localization authorities are wired.`);
