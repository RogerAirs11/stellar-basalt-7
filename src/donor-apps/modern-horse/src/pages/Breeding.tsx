import {useState} from 'react';
import { Network,ShieldAlert } from 'lucide-react';
import { HORSES,horseById,eligibleParent,type Horse } from '../data';
import { fetchPairingAnalysis,useLiveFetch,useLiveSearch,useHydratedTick } from '../live';
import {useI18n} from '../i18n';
import {Card,PanelHeader,Pill} from '../components/ui';
import {Page} from '../components/Shell';
import {useBreeding} from '../store';
import {getNav} from '../nav';
type Tab='advisor'|'ancestry'|'matches'|'genetics';
export function Breeding({tab}:{tab:Tab}){
 useHydratedTick();const {tx}=useI18n(),{sId,mId,setS,setM}=useBreeding();const sire=horseById(sId),dam=horseById(mId);
 const leaves=getNav(tx).find(g=>g.key==='breeding')!.leaves;
 return <Page phase="breeding" title={tx('Registry pairing analysis','تحلیل جفت‌گیری ثبت اسب')} subtitle={tx('Compare the recorded pedigrees of two selected horses.','تبار ثبت‌شده دو اسب انتخابی را مقایسه کنید.')} tabs={leaves}>
 {tab==='genetics'?<Card className="p-4">{tx('A pedigree does not establish genotype, carrier status, or foal colour. Those require relevant laboratory evidence.','از تبار به‌تنهایی نمی‌توان ژنوتیپ، وضعیت ناقل یا رنگ کره را تعیین کرد. این موارد نیاز به مدرک آزمایشگاهی دارند.')}</Card>:<>
 <div className="panel mb-3 grid gap-3 p-3 sm:grid-cols-2"><ParentPicker role="stallion" id={sId} onChange={setS}/><ParentPicker role="mare" id={mId} onChange={setM}/></div>
 {tab==='matches'&&<p className="mb-3 text-sm">{tx('No verified match rankings are available. Compare a pair below instead.','رتبه‌بندی تأییدشده جفت‌ها موجود نیست؛ دو اسب را برای مقایسه انتخاب کنید.')}</p>}
 {sire&&dam&&eligibleParent(sire,'stallion')&&eligibleParent(dam,'mare')?<LivePairingCard key={sId+':'+mId} stallion={sire} mare={dam}/>:<Card className="p-4">{tx('Choose a registered stallion and mare to see pedigree evidence. No pair is selected automatically.','برای مشاهده شواهد تبار، یک سیلمی و یک مادیان ثبت‌شده انتخاب کنید. انتخاب خودکار انجام نمی‌شود.')}</Card>}</>}
 </Page>;
}
function ParentPicker({role,id,onChange}:{role:'stallion'|'mare';id:string;onChange:(id:string)=>void}){
 const {tx,tr}=useI18n(),[open,setOpen]=useState(false),[query,setQuery]=useState('');const result=useLiveSearch(open?query:''),picked=horseById(id),title=role==='mare'?tx('Mare','مادیان'):tx('Stallion','سیلمی');
 const local=HORSES.filter(h=>[h.name.en,h.name.fa,h.regId].some(s=>s.toLowerCase().includes(query.trim().toLowerCase())));
 const choices=[...new Map([...(result.rows??[]),...local].filter(h=>eligibleParent(h,role)).map(h=>[h.id,h])).values()].slice(0,40);
 return <div className="min-w-0"><button className="w-full rounded-xl border border-line px-3 py-2 text-start" aria-expanded={open} onClick={()=>setOpen(!open)}>{title} · {picked&&eligibleParent(picked,role)?tr(picked.name):tx('Select','انتخاب کنید')}</button>{open&&<div className="mt-2 rounded-xl border border-line p-2"><input autoFocus aria-label={title} className="w-full rounded-lg border border-line p-2" value={query} placeholder={tx('Search registry','جستجوی ثبت اسب')} onChange={e=>setQuery(e.target.value)}/><ul className="max-h-52 overflow-auto">{choices.map(h=><li key={h.id}><button className="w-full rounded px-2 py-2 text-start" onClick={()=>{onChange(h.id);setOpen(false);setQuery('')}}>{tr(h.name)} · {h.regId||h.id}</button></li>)}</ul><span role="status">{result.loading?tx('Searching…','در حال جستجو…'):result.failed?tx('Registry search unavailable','جستجوی ثبت در دسترس نیست'):!choices.length?tx('No eligible records found','رکورد واجد شرایط یافت نشد'):null}</span></div>}</div>;
}
function LivePairingCard({ stallion, mare }: { stallion: Horse; mare: Horse }) {
  const { tx, tr, n } = useI18n();
  const bothLive = /^[0-9]+$/.test(stallion.id) && /^[0-9]+$/.test(mare.id) && stallion.id !== mare.id;
  const { data, done } = useLiveFetch(bothLive ? `${stallion.id}|${mare.id}` : null, (k) => fetchPairingAnalysis(k.split('|')[0], k.split('|')[1]));
  if (!done || !data) return <Card className="p-4">{!done?tx('Loading recorded ancestry…','در حال دریافت تبار ثبت‌شده…'):tx('Pairing data unavailable. No estimate shown.','داده‌ای در دسترس نیست؛ برآوردی نمایش داده نمی‌شود.')}</Card>;
  const v = data;
  const clsTone: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
    outcross: 'green', mild_linebreeding: 'green', linebreeding: 'amber', close_inbreeding: 'red', insufficient_ancestry: 'slate', unknown: 'slate',
  };
  const stat = (label: string, value: string) => (
    <div key={label} className="stat-tile rounded-lg bg-fuchsia-100/60 px-2.5 py-1.5">
      <div className="text-[10px] font-semibold text-fg-navy-500">{label}</div>
      <div className="font-display text-base font-semibold leading-tight text-fg-navy-900">{value}</div>
    </div>
  );
  return (
    <Card className="p-3">
      <PanelHeader phase="breeding" icon={<Network />} title={tx('Platform pairing analysis', 'تحلیل جفت‌گیری پلتفرم')}
        sub={tx('Computed by the registry from the full recorded pedigree', 'محاسبه‌شده توسط ثبت از شجره کامل ثبت‌شده')} />
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        {v.classificationLabel && <Pill tone={clsTone[v.classification ?? 'unknown'] ?? 'slate'}>{v.classificationLabel}</Pill>}
        {v.closeMatingWarning && <Pill tone="red" icon={<ShieldAlert className="h-3 w-3" />}>{tx('Close mating warning', 'هشدار جفت‌گیری خویشاوندی')}</Pill>}
      </div>
      {v.closeMatingWarning && v.closeMatingWarningText && <p className="mb-2.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[12px] leading-snug text-fg-red-900">{v.closeMatingWarningText}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat(tx('Projected foal COI', 'هم‌خونی کره پیش‌بینی‌شده'), v.projectedCoiPercent != null ? `${n(v.projectedCoiPercent)}%` : '—')}
        {stat(tx('Parent relationship', 'خویشاوندی والدین'), v.relationshipPercent != null ? `${n(v.relationshipPercent)}%` : '—')}
        {stat(tx('Sire COI', 'هم‌خونی پدر'), v.sireCoiPercent != null ? `${n(v.sireCoiPercent)}%` : '—')}
        {stat(tx('Dam COI', 'هم‌خونی مادر'), v.damCoiPercent != null ? `${n(v.damCoiPercent)}%` : '—')}
      </div>
      <p className="mt-2 text-[11px] text-fg-navy-500">{tx('Pedigree completeness', 'کامل بودن شجره')}: {tx('sire', 'پدر')} {v.sireCompleteness==null?'—':`${n(v.sireCompleteness)}%`} · {tx('dam', 'مادر')} {v.damCompleteness==null?'—':`${n(v.damCompleteness)}%`}{v.foalAvkPercent != null ? ` · ${tx('AVK (projected foal)', 'AVK (کره پیش‌بینی‌شده)')} ${n(v.foalAvkPercent)}%` : ''}</p>
      {v.commonAncestors.length > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Common ancestors', 'نیاکان مشترک')}</div>
          <ul className="grid gap-1 sm:grid-cols-2">
            {v.commonAncestors.slice(0, 6).map((c) => (
              <li key={c.id}>
                <a href={`#/horses/${c.id}`} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2/70 px-2.5 py-1.5 text-[12px] transition hover:bg-surface-2">
                  <span className="truncate font-semibold">{tr(c.name)}</span>
                  <span className="shrink-0 text-fg-navy-500">×{n(c.occurrences)}{c.generation != null ? ` · ${tx('gen', 'نسل')} ${n(c.generation)}` : ''}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
