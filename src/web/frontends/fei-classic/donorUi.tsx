import { ContextNavigation } from "./Navigation";
import { Children, cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from "react";
import { Icon } from "./components";
import { num, type ClassicLocale } from "./i18n";

export function DonorPageTitle({title,right,subtitle}:{title:string;right?:ReactNode;subtitle?:string}){return <div className="fei-page-title"><div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{right&&<div className="fei-page-title-right">{right}</div>}</div>}
export function DonorSectionHeading({children}:{children:ReactNode}){return <h2 className="fei-section-heading">{children}</h2>}
export function DonorPanel({children,className=""}:{children:ReactNode;className?:string}){return <div className={`fei-panel ${className}`}>{children}</div>}
export function DonorField({label,children,info,className=""}:{label:string;children:ReactNode;info?:string;className?:string}) {
  const generatedId=useId();
  let controlId=generatedId;
  const controls=Children.toArray(children);
  const primary=controls.find(child=>isValidElement(child)&&typeof child.type==="string"&&["input","select","textarea"].includes(child.type)) as ReactElement<{id?:string}>|undefined;
  if(primary?.props.id)controlId=primary.props.id;
  return <div className={`fei-field ${className}`}><label htmlFor={primary?controlId:undefined}>{label}{info&&<span className="fei-info" title={info}>i</span>}</label><div>{controls.map(child=>child===primary?cloneElement(primary,{id:controlId}):child)}</div></div>;
}
export function DonorCheckbox({checked,onChange,label}:{checked:boolean;onChange:(v:boolean)=>void;label:string}){return <label className="fei-choice"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><span>{label}</span></label>}
export function DonorRadio({name,value,checked,onChange,label}:{name:string;value:string;checked:boolean;onChange:(v:string)=>void;label:string}){return <label className="fei-choice"><input type="radio" name={name} value={value} checked={checked} onChange={()=>onChange(value)}/><span>{label}</span></label>}
export function DonorSearchButtons({onReset,onSearch,loading,searchLabel,resetLabel}:{onReset:()=>void;onSearch:()=>void;loading?:boolean;searchLabel:string;resetLabel:string}){return <div className="fei-search-buttons"><button type="button" className="btn-reset" onClick={onReset}>{resetLabel}</button><button type="submit" className="btn-search" onClick={onSearch} disabled={loading}>{loading?<span className="fei-spinner"/>:<><Icon name="search"/>{searchLabel}</>}</button></div>}
export interface DonorColumn<T>{key:string;header:ReactNode;render:(row:T)=>ReactNode;className?:string;sortable?:boolean}
export function DonorDataTable<T>({columns,rows,rowKey,sortKey,sortDir,onSort,emptyText,scrollHint=true}:{columns:DonorColumn<T>[];rows:T[];rowKey:(r:T)=>string;sortKey?:string;sortDir?:"asc"|"desc";onSort?:(key:string)=>void;emptyText:string;scrollHint?:boolean}) {
  return <div className="fei-table-block"><div className="fei-table-scroll"><table className="fei-data-table"><thead><tr>{columns.map(column=><th key={column.key} scope="col" className={`${column.className||""} ${column.sortable?"sortable":""}`} aria-sort={column.sortable?(sortKey===column.key?(sortDir==="desc"?"descending":"ascending"):"none"):undefined}>
    {column.sortable&&onSort?<button type="button" className="fc112-table-sort" onClick={()=>onSort(column.key)}>{column.header}{sortKey===column.key&&<span className="fei-sort" aria-hidden="true">{sortDir==="asc"?"▲":"▼"}</span>}</button>:column.header}
  </th>)}</tr></thead><tbody>{rows.length===0?<tr><td colSpan={columns.length} className="fei-table-empty">{emptyText}</td></tr>:rows.map((row,index)=><tr key={rowKey(row)} className={index%2?"alt":""}>{columns.map(column=><td key={column.key} className={column.className||""}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>{scrollHint&&<div className="fei-scroll-hint" aria-hidden="true">↔</div>}</div>;
}
export function DonorPager({total,unit,page,perPage,onPage,onPerPage,locale,compact=false}:{total:number;unit:string;page:number;perPage:number;onPage:(p:number)=>void;onPerPage?:(n:number)=>void;locale:ClassicLocale;compact?:boolean}) {
  const pages=Math.max(1,Math.ceil(total/perPage));const [goto,setGoto]=useState("");const L=(en:string,fa:string)=>locale==="fa"?fa:en;
  const go=()=>{const n=Number(goto);if(n>=1&&n<=pages)onPage(n);setGoto("")};
  if(compact)return <div className="fei-pagination compact">{num(total,locale)} {unit} / {num(pages,locale)}</div>;
  const start=Math.max(1,Math.min(page-2,pages-4));const nums=Array.from({length:Math.min(5,pages)},(_,i)=>start+i).filter(value=>value<=pages);
  return <div className="fei-pagination"><div>{num(total,locale)} {unit} / {num(pages,locale)}{onPerPage&&<select aria-label={L("Results per page","نتایج در هر صفحه")} value={perPage} onChange={event=>onPerPage(Number(event.target.value))}>{[10,20,25,40,50,100].map(value=><option key={value} value={value}>{num(value,locale)}</option>)}</select>}</div>
    <div className="fei-pages"><button type="button" aria-label={L("Previous page","صفحه قبل")} disabled={page<=1} onClick={()=>onPage(page-1)}>‹</button>{nums.map(value=><button type="button" className={value===page?"active":""} key={value} aria-current={value===page?"page":undefined} aria-label={`${L("Page","صفحه")} ${num(value,locale)}`} onClick={()=>onPage(value)}>{num(value,locale)}</button>)}<button type="button" aria-label={L("Next page","صفحه بعد")} disabled={page>=pages} onClick={()=>onPage(page+1)}>›</button></div>
    <form className="fei-goto" onSubmit={event=>{event.preventDefault();go()}}><input aria-label={L("Go to page number","رفتن به شماره صفحه")} inputMode="numeric" maxLength={9} value={goto} onChange={event=>setGoto(event.target.value.replace(/\D/g,""))}/><button type="submit" aria-label={L("Go to page","رفتن به صفحه")} disabled={Number(goto)<1||Number(goto)>pages}>›</button></form></div>;
}
export function DonorTabs({tabs,active,onChange,locale="en"}:{tabs:Array<{key:string;label:string}>;active:string;onChange:(key:string)=>void;locale?:ClassicLocale}){return <ContextNavigation><nav className="fei-tabs" aria-label={locale==="fa"?"بخش‌های سابقه":"Record sections"}>{tabs.map(tab=><button type="button" key={tab.key} className={active===tab.key?"active":""} aria-pressed={active===tab.key} onClick={()=>onChange(tab.key)}>{tab.label}</button>)}</nav></ContextNavigation>;}
export function DonorFieldset({legend,children,className=""}:{legend:string;children:ReactNode;className?:string}){return <fieldset className={`fei-fieldset ${className}`}><legend>{legend}</legend>{children}</fieldset>}
