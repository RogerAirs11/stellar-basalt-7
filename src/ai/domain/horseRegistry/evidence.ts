import type { AiEntityReference } from "../../core/types";

export function horseRef(h:{id:number;name_latin?:string|null;name_native?:string|null;birth_year?:number|null}):AiEntityReference{
  const label=h.name_latin||h.name_native||`Horse #${h.id}`;
  return{kind:"horse",id:String(h.id),label,href:`/horse/${h.id}`,subtitle:h.birth_year?String(h.birth_year):null};
}
export function personRef(p:{id:number;name_latin?:string|null;name_native?:string|null}):AiEntityReference{
  return{kind:"person",id:String(p.id),label:p.name_latin||p.name_native||`Person #${p.id}`,href:`/person/${p.id}`};
}
export function contentRef(p:{slug:string;title?:string|null;title_fa?:string|null}):AiEntityReference{
  return{kind:"content",id:p.slug,label:p.title||p.title_fa||p.slug,href:`/content/${encodeURIComponent(p.slug)}`};
}
