import React,{useRef,useState} from 'react';
import type {MetadataDefinition,MetadataField,MetadataFieldDetail,MetadataValue,PlatformClient} from '../../contracts/platform';
import {useDomainResource,usePlatformCommand} from '../../frontend-kit';
import {uiText} from '../../shared/uiLocale';
import {useI18n} from '../i18n';
import {HeritageCommandNotice,HeritageResourceNotice} from './DomainFeedback';
import '../styles/heritage.metadata.css';

function useMetadataCommand(scope:string,refresh:()=>void) {
  const command=usePlatformCommand(scope);
  const retryRef=useRef<null|(()=>Promise<unknown>)>(null);
  const busy=command.state.phase==='submitting',uncertain=command.state.phase==='failed';
  const execute=async(fn:()=>Promise<unknown>)=>{
    const accepted=await command.run(fn);
    if(accepted){retryRef.current=null;refresh();}
    return accepted;
  };
  return {...command,blocked:busy||uncertain,
    submit:(fn:()=>Promise<unknown>)=>{if(busy||uncertain)return Promise.resolve(false);retryRef.current=fn;return execute(fn);},
    retry:()=>retryRef.current?execute(retryRef.current):Promise.resolve(false),
  };
}
function CommandFeedback({command,reload}:{command:ReturnType<typeof useMetadataCommand>;reload:()=>void}) {
  const {locale}=useI18n();
  return <><HeritageCommandNotice state={command.state} reload={reload}/>{command.state.phase==='failed'&&<button type="button" onClick={()=>void command.retry()}>{uiText(locale,'Retry the same saved operation','تلاش دوباره برای همان عملیات ذخیره‌شده')}</button>}</>;
}
function labelOf(definition:MetadataDefinition,locale:string):string{return locale==='fa'?(definition.label.fa||definition.label.en):definition.label.en;}
const initialDefinition:MetadataDefinition={type:'text',label:{en:''},visibility:'staff',filter_enabled:false,max_length:200};

function DefinitionForm({initial=initialDefinition,locked=false,blocked,onSave}:{initial?:MetadataDefinition;locked?:boolean;blocked:boolean;onSave:(definition:MetadataDefinition,reason:string,key:string)=>void}) {
  const {locale}=useI18n(),L=(en:string,fa:string)=>uiText(locale,en,fa);
  const [key,setKey]=useState('extra_'),[type,setType]=useState(initial.type),[en,setEn]=useState(initial.label.en),[fa,setFa]=useState(initial.label.fa??'');
  const [visibility,setVisibility]=useState(initial.visibility),[filter,setFilter]=useState(initial.filter_enabled),[description,setDescription]=useState(initial.description??'');
  const [maxLength,setMaxLength]=useState(initial.type==='text'?String(initial.max_length):'200');
  const [minimum,setMinimum]=useState(initial.type==='number'&&initial.minimum!==undefined?String(initial.minimum):'');
  const [maximum,setMaximum]=useState(initial.type==='number'&&initial.maximum!==undefined?String(initial.maximum):'');
  const [unit,setUnit]=useState(initial.type==='number'?initial.unit??'':'');
  const [options,setOptions]=useState(initial.type==='select'?initial.options.map(o=>`${o.value} | ${o.label.en} | ${o.label.fa??''}`).join('\n'):'');
  const [reason,setReason]=useState(''),[error,setError]=useState('');
  const submit=(event:React.FormEvent)=>{
    event.preventDefault();setError('');
    if(reason.trim().length<8){setError(L('Explain the change in at least eight characters.','دلیل تغییر را با دست‌کم هشت نویسه بنویسید.'));return;}
    const common={label:{en:en.trim(),...(fa.trim()?{fa:fa.trim()}:{})},description:description.trim(),visibility,filter_enabled:visibility==='public'&&['select','boolean'].includes(type)&&filter};
    let definition:MetadataDefinition;
    if(type==='text')definition={...common,type,max_length:Number(maxLength)};
    else if(type==='number')definition={...common,type,...(minimum.trim()?{minimum:Number(minimum)}:{}),...(maximum.trim()?{maximum:Number(maximum)}:{}),...(unit.trim()?{unit:unit.trim()}:{})};
    else if(type==='select'){
      const choices=options.split('\n').filter(line=>line.trim()).map(line=>{const[value,en,fa]=line.split('|').map(s=>s.trim());return{value:value??'',label:{en:en??'',...(fa?{fa}:{})}};});
      if(choices.some(choice=>!choice.value||!choice.label.en)){setError(L('Each option needs a stable value and an English label.','هر گزینه به یک مقدار ثابت و عنوان انگلیسی نیاز دارد.'));return;}
      definition={...common,type,options:choices};
    }else definition={...common,type:'boolean'};
    onSave(definition,reason.trim(),key.trim());
  };
  return <form onSubmit={submit} className="metadata-form"><fieldset disabled={blocked}>
    {!locked&&<label>{L('Stable field key','کلید ثابت فیلد')}<input required pattern="extra_[a-z][a-z0-9_]{1,53}" value={key} onChange={e=>setKey(e.target.value)} dir="ltr" placeholder="extra_training_discipline"/></label>}
    <div className="metadata-columns"><label>{L('English label','عنوان انگلیسی')}<input required maxLength={100} value={en} onChange={e=>setEn(e.target.value)} dir="ltr"/></label><label>{L('Persian label','عنوان فارسی')}<input maxLength={100} value={fa} onChange={e=>setFa(e.target.value)} dir="rtl"/></label></div>
    <div className="metadata-columns"><label>{L('Value type','نوع مقدار')}<select disabled={locked} value={type} onChange={e=>setType(e.target.value as MetadataDefinition['type'])}><option value="text">{L('Text','متن')}</option><option value="number">{L('Number','عدد')}</option><option value="boolean">{L('Yes / no','بله / خیر')}</option><option value="select">{L('Controlled choice','گزینه کنترل‌شده')}</option></select></label>
      <label>{L('Visibility','دسترسی')}<select disabled={locked} value={visibility} onChange={e=>setVisibility(e.target.value as 'public'|'staff')}><option value="staff">{L('Registry administrators','مدیران ثبت')}</option><option value="public">{L('Public','عمومی')}</option></select></label></div>
    {type==='text'&&<label>{L('Maximum characters','حداکثر نویسه')}<input required type="number" min={1} max={2000} value={maxLength} onChange={e=>setMaxLength(e.target.value)}/></label>}
    {type==='number'&&<div className="metadata-columns"><label>{L('Minimum (optional)','کمینه (اختیاری)')}<input type="number" step="any" value={minimum} onChange={e=>setMinimum(e.target.value)}/></label><label>{L('Maximum (optional)','بیشینه (اختیاری)')}<input type="number" step="any" value={maximum} onChange={e=>setMaximum(e.target.value)}/></label><label>{L('Unit (optional)','واحد (اختیاری)')}<input maxLength={30} value={unit} onChange={e=>setUnit(e.target.value)}/></label></div>}
    {type==='select'&&<label>{L('Options: stable_value | English label | Persian label, one per line','گزینه‌ها: مقدار_ثابت | عنوان انگلیسی | عنوان فارسی، هر گزینه در یک سطر')}<textarea required rows={5} value={options} onChange={e=>setOptions(e.target.value)} dir="ltr" placeholder="dressage | Dressage | درساژ"/></label>}
    {visibility==='public'&&['select','boolean'].includes(type)&&<label className="metadata-check"><input type="checkbox" checked={filter} onChange={e=>setFilter(e.target.checked)}/>{L('Allow public exact filtering for values reviewed under this version','اجازه فیلتر دقیق عمومی برای مقادیر بررسی‌شده در این نسخه')}</label>}
    <label>{L('Description','توضیحات')}<textarea maxLength={1000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
    <label>{L('Reason for this definition','دلیل این تعریف')}<textarea required minLength={8} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    {error&&<p role="alert">{error}</p>}<button type="submit">{locked?L('Save a new draft version','ذخیره نسخه پیش‌نویس جدید'):L('Create draft field','ساخت فیلد پیش‌نویس')}</button>
  </fieldset></form>;
}

function FieldEditor({platform,detail,scope,refresh}:{platform:PlatformClient;detail:MetadataFieldDetail;scope:string;refresh:()=>void}) {
  const {locale,n}=useI18n(),L=(en:string,fa:string)=>uiText(locale,en,fa);
  const command=useMetadataCommand(scope,refresh),[version,setVersion]=useState(String(detail.field.active_version??detail.field.latest_version)),[reason,setReason]=useState('');
  const {field}=detail;
  return <section className="metadata-editor"><h3>{labelOf(field.definition,locale)}</h3><p><code>{field.key}</code> · {L('Revision','ویرایش')} {n(field.revision)} · {field.active_version===null?L('Inactive','غیرفعال'):`${L('Active version','نسخه فعال')} ${n(field.active_version)}`}</p>
    <CommandFeedback command={command} reload={refresh}/>
    <form onSubmit={event=>{event.preventDefault();const input={expected_revision:field.revision,version:version==='none'?null:Number(version),reason:reason.trim(),operation_id:crypto.randomUUID()};void command.submit(()=>platform.metadata.admin.activate(field.key,input));}} className="metadata-form"><fieldset disabled={command.blocked}>
      <label>{L('Activate a reviewed version, or hide this field','فعال‌سازی نسخه بررسی‌شده یا پنهان‌سازی فیلد')}<select value={version} onChange={e=>setVersion(e.target.value)}><option value="none">{L('Hide / deactivate','پنهان / غیرفعال')}</option>{detail.versions.map(v=><option key={v.version} value={v.version}>{L('Version','نسخه')} {n(v.version)} — {labelOf(v.definition,locale)}</option>)}</select></label>
      <label>{L('Activation / withdrawal reason','دلیل فعال‌سازی / توقف')}<textarea required minLength={8} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button type="submit">{L('Apply activation decision','اعمال تصمیم فعال‌سازی')}</button>
    </fieldset></form>
    <details><summary>{L('Prepare the next definition','آماده‌سازی تعریف بعدی')}</summary><DefinitionForm key={`${field.key}:${field.latest_version}`} initial={field.definition} locked blocked={command.blocked} onSave={(definition,reason)=>{const input={definition,reason,expected_revision:field.revision,operation_id:crypto.randomUUID()};void command.submit(()=>platform.metadata.admin.newVersion(field.key,input));}}/></details>
    <details><summary>{L('Definition history','تاریخچه تعریف')}</summary><ol>{detail.history.map((entry,index)=><li key={index}><strong>{entry.action}</strong> · <time>{entry.created_at}</time><p>{entry.reason}</p><small>{entry.actor_user_id}</small></li>)}</ol>{detail.history_truncated&&<p>{L('Showing the latest 100 decisions.','۱۰۰ تصمیم اخیر نمایش داده شده است.')}</p>}</details>
  </section>;
}

function ValueInput({definition,value,setValue}:{definition:MetadataDefinition;value:string;setValue:(value:string)=>void}) {
  const {locale}=useI18n();
  if(definition.type==='boolean')return <select value={value} onChange={e=>setValue(e.target.value)}><option value="">—</option><option value="true">{uiText(locale,'Yes','بله')}</option><option value="false">{uiText(locale,'No','خیر')}</option></select>;
  if(definition.type==='select')return <select value={value} onChange={e=>setValue(e.target.value)}><option value="">—</option>{definition.options.map(option=><option key={option.value} value={option.value}>{locale==='fa'?(option.label.fa||option.label.en):option.label.en}</option>)}</select>;
  if(definition.type==='number')return <input type="number" step="any" min={definition.minimum} max={definition.maximum} value={value} onChange={e=>setValue(e.target.value)}/>;
  return <textarea maxLength={definition.max_length} value={value} onChange={e=>setValue(e.target.value)}/>;
}
function HorseValueEditor({platform,horseId,detail,stored,scope,refresh}:{platform:PlatformClient;horseId:number;detail:MetadataFieldDetail;stored?:MetadataValue;scope:string;refresh:()=>void}) {
  const {locale}=useI18n(),L=(en:string,fa:string)=>uiText(locale,en,fa);
  const active=detail.versions.find(version=>version.version===detail.field.active_version);
  const [value,setValue]=useState(stored?.value===null||stored?.value===undefined?'':String(stored.value));
  const [source,setSource]=useState(stored?.source_ref??''),[evidence,setEvidence]=useState(''),[reason,setReason]=useState('');
  const command=useMetadataCommand(scope,refresh);
  if(!active)return <p>{L('Activate a field definition before recording values.','پیش از ثبت مقدار، یک نسخه از فیلد را فعال کنید.')}</p>;
  const {definition}=active;
  return <form className="metadata-form" onSubmit={event=>{
    event.preventDefault();const typed=value===''?null:definition.type==='number'?Number(value):definition.type==='boolean'?value==='true':value;
    const input={value:typed,expected_version:stored?.version??0,definition_version:active.version,source_ref:source.trim(),evidence_ref:evidence.trim()||null,reason:reason.trim(),operation_id:crypto.randomUUID()};
    void command.submit(()=>platform.metadata.admin.save(horseId,detail.field.key,input));
  }}><CommandFeedback command={command} reload={refresh}/><fieldset disabled={command.blocked}>
    <p>{definition.visibility==='public'?L('This value will be publicly visible for a published horse.','این مقدار برای اسب منتشرشده، عمومی خواهد بود.'):L('Visible only to registry administrators.','فقط برای مدیران ثبت قابل مشاهده است.')}</p>
    {stored&&stored.definition_version!==active.version&&<p role="status">{L('The existing value uses an older definition. Review its meaning before saving under the active version.','مقدار موجود از تعریف قدیمی استفاده می‌کند. پیش از ذخیره در نسخه فعال، معنای آن را بررسی کنید.')}</p>}
    <label>{labelOf(definition,locale)}<ValueInput definition={definition} value={value} setValue={setValue}/><small>{L('Leave empty to record a reviewed removal.','برای ثبت حذفِ بررسی‌شده، خالی بگذارید.')}</small></label>
    <label>{L('Source reference','مرجع منبع')}<input required minLength={3} maxLength={500} value={source} onChange={e=>setSource(e.target.value)}/></label>
    <label>{L('Evidence reference (optional)','مرجع شاهد (اختیاری)')}<input maxLength={500} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
    <label>{L('Review reason','دلیل بررسی')}<textarea required minLength={8} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button type="submit">{L('Record reviewed value','ثبت مقدار بررسی‌شده')}</button>
  </fieldset></form>;
}

export function MetadataWorkbench({platform,scope}:{platform:PlatformClient;scope:string}) {
  const {locale,n}=useI18n(),L=(en:string,fa:string)=>uiText(locale,en,fa);
  const [selected,setSelected]=useState(''),[horseDraft,setHorseDraft]=useState(''),[horseId,setHorseId]=useState<number|null>(null);
  const catalog=useDomainResource('metadata-catalog',scope,signal=>platform.metadata.admin.catalog({signal}));
  const fields=catalog.state.phase==='ready'||catalog.state.phase==='reloading'?catalog.state.data.fields:[];
  const details=useDomainResource('metadata-definition',`${scope}:${selected}`,signal=>platform.metadata.admin.detail(selected,{signal}),{enabled:!!selected});
  const detail=details.state.phase==='ready'||details.state.phase==='reloading'?details.state.data:null;
  const values=useDomainResource('metadata-horse-values',`${scope}:${horseId}`,signal=>platform.metadata.admin.horse(horseId!,{signal}),{enabled:horseId!==null});
  const history=useDomainResource('metadata-horse-history',`${scope}:${horseId}`,signal=>platform.metadata.admin.history(horseId!,{signal}),{enabled:horseId!==null});
  const rows=values.state.phase==='ready'||values.state.phase==='reloading'?values.state.data.values:[];
  const refresh=()=>{catalog.retry();details.retry();values.retry();history.retry();};
  const createCommand=useMetadataCommand(`${scope}:create`,refresh);
  const stored=rows.find(value=>value.field_key===selected);
  return <section className="metadata-workbench h-glass-1" data-h-surface-role="panel" aria-label={L('Supplementary field administration','مدیریت فیلدهای تکمیلی')}>
    <header><div><small>{L('Registry administration','مدیریت ثبت')}</small><h2>{L('Supplementary fields','فیلدهای تکمیلی')}</h2></div><button type="button" onClick={refresh}>{L('Refresh','تازه‌سازی')}</button></header>
    <p>{L('Create reviewed supplementary fields for existing horse records. Each definition and value keeps its version and source. Core identity and medical records use their dedicated workflows.','برای پرونده‌های موجود اسب، فیلدهای تکمیلی بررسی‌شده تعریف کنید. نسخه و منبع هر تعریف و مقدار حفظ می‌شود. هویت اصلی و پرونده پزشکی مسیرهای اختصاصی خود را دارند.')}</p>
    <HeritageResourceNotice state={catalog.state} retry={catalog.retry}/>
    {catalog.state.phase==='ready'&&catalog.state.data.truncated&&<p role="status">{L('Showing the first 100 fields; use the administration API for additional catalog work.','۱۰۰ فیلد اول نمایش داده می‌شود؛ برای ادامه مدیریت از رابط مدیریت سامانه استفاده کنید.')}</p>}
    <div className="metadata-layout"><aside><label>{L('Choose a field','انتخاب فیلد')}<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">—</option>{fields.map(field=><option value={field.key} key={field.key}>{labelOf(field.definition,locale)} — {field.definition.visibility==='public'?L('Public','عمومی'):L('Administrators','مدیران')}</option>)}</select></label>
      <details><summary>{L('Create a new supplementary field','ساخت فیلد تکمیلی جدید')}</summary><CommandFeedback command={createCommand} reload={refresh}/><DefinitionForm blocked={createCommand.blocked} onSave={(definition,reason,key)=>{const input={definition,reason,key,operation_id:crypto.randomUUID()};void createCommand.submit(()=>platform.metadata.admin.create(input));}}/></details>
    </aside><div><HeritageResourceNotice state={details.state} retry={details.retry}/>{detail&&<FieldEditor key={`${scope}:${selected}`} platform={platform} scope={`${scope}:${selected}:definition`} detail={detail} refresh={refresh}/>}</div></div>
    <section className="metadata-horse"><h3>{L('Record an existing horse’s supplementary value','ثبت مقدار تکمیلی برای اسب موجود')}</h3>
      <form className="metadata-horse-choice" onSubmit={event=>{event.preventDefault();const id=Number(horseDraft.replace(/[۰-۹]/g,char=>String(char.charCodeAt(0)-1776)).replace(/[٠-٩]/g,char=>String(char.charCodeAt(0)-1632)));if(Number.isSafeInteger(id)&&id>0)setHorseId(id);}}><label>{L('Horse registry number','شماره اسب در سامانه')}<input inputMode="numeric" required value={horseDraft} onChange={e=>setHorseDraft(e.target.value)}/></label><button type="submit">{L('Open record','باز کردن پرونده')}</button></form>
      <HeritageResourceNotice state={values.state} retry={values.retry}/>
      {horseId!==null&&(values.state.phase==='ready'||values.state.phase==='reloading')&&<><p>{L('Horse','اسب')} #{n(horseId)}</p><dl>{rows.map(row=><div key={row.field_key}><dt>{labelOf(row.definition,locale)}</dt><dd>{row.value===null?L('Removed','حذف‌شده'):String(row.value)} <small>· {L('Definition','تعریف')} {n(row.definition_version)}</small></dd></div>)}</dl>{detail?<HorseValueEditor key={`${scope}:${horseId}:${selected}:${stored?.version??0}:${detail.field.revision}`} platform={platform} scope={`${scope}:${horseId}:${selected}:value`} horseId={horseId} detail={detail} stored={stored} refresh={refresh}/>:<p>{L('Choose a field above to record its reviewed value.','برای ثبت مقدار بررسی‌شده، فیلدی را از بالا انتخاب کنید.')}</p>}</>}
      {horseId!==null&&<details><summary>{L('Horse supplementary-value history','تاریخچه مقادیر تکمیلی اسب')}</summary><HeritageResourceNotice state={history.state} retry={history.retry}/>{history.state.phase==='ready'&&<><ol>{history.state.data.history.map((entry,index)=><li key={index}><code>{entry.field_key}</code> · <time>{entry.created_at}</time><p>{entry.reason}</p><pre>{JSON.stringify(entry.snapshot,null,2)}</pre></li>)}</ol>{history.state.data.truncated&&<p>{L('Showing the latest 100 changes.','۱۰۰ تغییر اخیر نمایش داده شده است.')}</p>}</>}</details>}
    </section>
  </section>;
}

/** Public projection only; the server never returns staff-only fields here. */
export function SupplementaryValues({platform,horseId}:{platform:PlatformClient;horseId:number}) {
  const {locale,n}=useI18n();
  const resource=useDomainResource('public-supplementary-values',horseId,signal=>platform.metadata.horse(horseId,{signal}));
  if(resource.state.phase==='ready'&&!resource.state.data.values.length)return null;
  return <section className="metadata-public-values"><h3>{uiText(locale,'Supplementary registry facts','اطلاعات تکمیلی ثبت')}</h3><HeritageResourceNotice state={resource.state} retry={resource.retry}/>{(resource.state.phase==='ready'||resource.state.phase==='reloading')&&<dl>{resource.state.data.values.map(item=><div key={item.field_key}><dt>{labelOf(item.definition,locale)}</dt><dd>{item.definition.type==='select'?item.definition.options.find(option=>option.value===item.value)?.label[locale==='fa'?'fa':'en']||item.definition.options.find(option=>option.value===item.value)?.label.en||String(item.value):typeof item.value==='boolean'?uiText(locale,item.value?'Yes':'No',item.value?'بله':'خیر'):typeof item.value==='number'?n(item.value):String(item.value)}<small> · {uiText(locale,'Definition','تعریف')} {n(item.definition_version)}</small></dd></div>)}</dl>}</section>;
}
