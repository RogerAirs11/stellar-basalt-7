// Release label is independent of the persisted demo-state schema version.
export const DEMO_REVISION = 'R102';
/** Pure, synthetic-only demonstration model. Never imports production API clients.
 * State is bounded, schema-checked and isolated from authentication/registry storage.
 */
export const STORAGE_KEY = 'horse-registry:demo:r96:v1';
export const MAX_ITEMS = 100;
export const INQUIRY_STATES = ['new', 'acknowledged', 'closed'];
const cleanText = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
const realDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v+'T00:00:00Z')) && new Date(v+'T00:00:00Z').toISOString().slice(0,10) === v;
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function normalizeSearch(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\u064a/g,'\u06cc').replace(/\u0643/g,'\u06a9').replace(/[\u200c\u200d]/g,' ').replace(/[\u0660-\u0669\u06f0-\u06f9]/g,c=>String(c.charCodeAt(0)&15)).replace(/\s+/g,' ').trim();
}
export function newState() {
  return { version:1, saved:[], inquiries:[], tasks:[
    {id:'demo-task-1',title:'DEMO: review renewal document',due:'2026-10-08',horseId:17,status:'open'},
    {id:'demo-task-2',title:'DEMO: arrange farrier appointment',due:'2026-10-10',horseId:19,status:'open'},
    {id:'demo-task-3',title:'DEMO: check sale dossier',due:'2026-10-12',horseId:21,status:'done'},
  ], cart:[], horseIds:[17,18,19,20,21,22] };
}
export function validateState(raw, data) {
  if (!raw || raw.version !== 1 || typeof raw !== 'object') throw new Error('Unsupported local demo state');
  for (const k of ['saved','inquiries','tasks','cart','horseIds']) if (!Array.isArray(raw[k]) || raw[k].length>MAX_ITEMS) throw new Error('Invalid or oversized local demo state');
  const horses=new Set(data.horses.map(h=>h.id)), products=new Set(data.products.map(p=>p.id));
  const targets=new Set([...data.providers.map(p=>p.id),...data.listings.map(p=>p.id),...data.products.map(p=>p.id)]);
  const ids = values => [...new Set(values.filter(v=>Number.isSafeInteger(v)&&horses.has(v)))];
  const inquiries=raw.inquiries.filter(r=>r && typeof r.id==='string' && targets.has(r.targetId) && INQUIRY_STATES.includes(r.status)).map(r=>({
    id:cleanText(r.id,80),targetId:r.targetId,note:cleanText(r.note,1500),shareContact:r.shareContact===true,status:r.status,
    createdAt:cleanText(r.createdAt,40),withdrawn:r.withdrawn===true,
  }));
  const tasks=raw.tasks.filter(t=>t&&typeof t.id==='string'&&realDay(t.due)&&horses.has(t.horseId)&&['open','done'].includes(t.status)).map(t=>({
    id:cleanText(t.id,80),title:cleanText(t.title,120),due:t.due,horseId:t.horseId,status:t.status,
  }));
  return {version:1,saved:ids(raw.saved),horseIds:ids(raw.horseIds),inquiries,tasks,cart:[...new Set(raw.cart.filter(id=>products.has(id)))]};
}
export function readState(storage, data) {
  try {
    const value=storage?.getItem(STORAGE_KEY);
    return {state:value?validateState(JSON.parse(value),data):newState(),notice:null};
  } catch {return {state:newState(),notice:'Local demo storage could not be read; a safe temporary state is shown.'};}
}
export function writeState(storage,state,data) {
  const checked=validateState(state,data);
  try {if(!storage)throw new Error('Unavailable');storage.setItem(STORAGE_KEY,JSON.stringify(checked));return null;}
  catch{return 'Local demo storage is unavailable. Changes last only until this page is closed.';}
}
export function filterHorses(data, {q='',breed='',sex='',province='',saved=null}={}) {
  const term=normalizeSearch(q);
  return data.horses.filter(h=>(!breed||h.breed_desc===breed)&&(!sex||h.sex_desc===sex)&&(!province||h.province===province)&&(!saved||saved.includes(h.id)))
    .filter(h=>!term||normalizeSearch([h.public_id,h.name_latin,h.name_native,h.breed_desc,h.province,h.color_desc].join(' ')).includes(term));
}
export function addInquiry(state,{targetId,note,shareContact=false},data,id,now) {
  const permitted=[...data.providers,...data.products,...data.listings.filter(l=>l.status==='active')].some(p=>p.id===targetId);
  if(!permitted)throw new Error('This demo target cannot receive inquiries');
  if(typeof note!=='string'||note.trim().length<10||note.length>1500)throw new Error('Use a synthetic note of 10-1500 characters');
  if(state.inquiries.length>=MAX_ITEMS)throw new Error('Demo inbox limit reached; reset this demo to continue');
  if(typeof id!=='string'||!id||state.inquiries.some(r=>r.id===id))throw new Error('Duplicate local command');
  return {...state,inquiries:[{id,targetId,note:note.trim(),shareContact:shareContact===true,status:'new',createdAt:now,withdrawn:false},...state.inquiries]};
}
export function transitionInquiry(state,id,to) {
  const row=state.inquiries.find(r=>r.id===id);
  const allowed=row&&!row.withdrawn&&((row.status==='new'&&['acknowledged','closed'].includes(to))||(row.status==='acknowledged'&&to==='closed'));
  if(!allowed)throw new Error('This simulated transition is no longer allowed');
  return {...state,inquiries:state.inquiries.map(r=>r.id===id?{...r,status:to}:r)};
}
export function withdrawInquiry(state,id) {
  if(!state.inquiries.some(r=>r.id===id))throw new Error('Unknown local inquiry');
  return {...state,inquiries:state.inquiries.map(r=>r.id===id?{...r,shareContact:false,withdrawn:true,note:'[DEMO note removed locally]',status:'closed'}:r)};
}
export function addTask(state,{title,due,horseId},data,id) {
  if(typeof title!=='string'||title.trim().length<3||title.length>120||!realDay(due)||!data.horses.some(h=>h.id===horseId)||!state.horseIds.includes(horseId))throw new Error('Use a title, a real date and a horse in this demo workspace');
  if(state.tasks.length>=MAX_ITEMS)throw new Error('Demo task limit reached');
  if(typeof id!=='string'||!id||id.length>80||state.tasks.some(task=>task.id===id))throw new Error('Duplicate or invalid local task command');
  return {...state,tasks:[...state.tasks,{id,title:title.trim(),due,horseId,status:'open'}]};
}
export function toggleSaved(state,id,data) {
  if(!data.horses.some(h=>h.id===id))throw new Error('Unknown horse');
  return {...state,saved:state.saved.includes(id)?state.saved.filter(v=>v!==id):[...state.saved,id]};
}
export function informationExtract(data,id,now) {
  const horse=data.horses.find(h=>h.id===id);if(!horse)throw new Error('Unknown horse');
  return {document_type:'DEMO_INFORMATION_EXTRACT_NOT_A_CERTIFICATE',version:1,is_demo:true,official:false,
    issued_at:now,source_as_of:data.as_of,horse,pedigree_metrics:data.metrics[id],
    warning:'Synthetic data only. Not an identity document, federation record, ownership proof, laboratory report or medical advice.'};
}
export function parseRoute(hash, business=false) {
  const value=String(hash||'').replace(/^#\/?/,'');
  if(!value)return {name:business?'business':'home',id:''};
  const [name,id='']=value.split('/');
  const aliases={professionals:'directory',market:'marketplace',breeding:'compare'};
  return {name:aliases[name]||name,id};
}
export const CAPABILITIES = [
  ['registry','Horse identity, ancestry and offspring','Synthetic records; actual pedigree engine','Production registry exists; data rights and correction operations need validation'],
  ['science','Recorded pedigree and laboratory interpretation','196 generated pair analyses; uncertainty visible','Specialist review, original report provenance and clinical limits remain'],
  ['marketplace','Horse listings and buyer inquiries','Local inquiry lifecycle; illustrative asking prices','Live seller mandates, moderation, delivery and complete purchase support remain'],
  ['directory','People, credentials and services','22 categories, linked people; no real licenses','Production directory and lead APIs exist; operational onboarding and notifications remain'],
  ['workspace','Stable records and reminders','Local task creation/completion and herd','Heritage is connected to real workspace APIs; cross-theme journeys need verification'],
  ['products','Equipment catalog and quote basket','Synthetic products; local quote request','Not an inventory, shipping, returns or checkout system'],
  ['billing','Pricing and operating model','Assumption calculator; no charges','Live payments remain gated; provider refund and credit allocation need completion'],
  ['trust','Evidence and privacy','Demo disclosure, export watermark, local reset','Server privacy fixes implemented; full audit and restore/provider tests still required'],
];

/** Demo IDs are not authentication tokens. getRandomValues also works in local
 * non-secure presentation contexts where randomUUID is not exposed. */
export function newDemoId() {
  const bytes=new Uint8Array(16);globalThis.crypto.getRandomValues(bytes);
  return 'demo-'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
}

/** Same capability IDs as the English matrix; no inferred service availability. */
export const CAPABILITIES_FA = [
  ['registry', 'هویت، شجره و فرزندان اسب', 'داده ساختگی؛ موتور واقعی محاسبه شجره', 'پایگاه اصلی وجود دارد؛ مجوز داده و فرآیند اصلاح باید آزموده شود'],
  ['science', 'شجره ثبت‌شده و نتایج آزمایش', '۱۹۶ تحلیل زوج؛ عدم قطعیت آشکار', 'بررسی متخصص، اصل گزارش و محدودیت بالینی همچنان لازم است'],
  ['marketplace', 'آگهی اسب و درخواست خریدار', 'چرخه درخواست محلی؛ قیمت نمونه', 'اختیار فروشنده، نظارت، ارسال و پشتیبانی خرید نیاز به تکمیل دارد'],
  ['directory', 'افراد، مجوزها و خدمات', '۲۲ دسته و افراد مرتبط؛ بدون مجوز واقعی', 'رابط داده وجود دارد؛ پذیرش خدمت‌دهنده و اعلان واقعی باید تکمیل شود'],
  ['workspace', 'اطلاعات اصطبل و یادآورها', 'ثبت و تکمیل کار محلی و گله', 'رابط هریتیج متصل است؛ مسیر کامل در همه رابط‌ها باید آزموده شود'],
  ['products', 'تجهیزات و سبد استعلام', 'محصول ساختگی؛ درخواست قیمت محلی', 'سامانه موجودی، ارسال، مرجوعی یا پرداخت نیست'],
  ['billing', 'تعرفه و مدل کسب‌وکار', 'ماشین‌حساب فرضی؛ بدون دریافت وجه', 'پرداخت واقعی مشروط است؛ بازپرداخت و تخصیص اعتبار نیاز به تکمیل دارد'],
  ['trust', 'مدرک و حریم خصوصی', 'برچسب نمایش، نشان خروجی و بازنشانی', 'اصلاحات سرور انجام شده؛ ممیزی کامل، بازیابی و تست سرویس واقعی لازم است'],
];
