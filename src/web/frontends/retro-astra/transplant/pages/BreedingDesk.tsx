import { useState } from 'react';
import { retroText } from '../i18n/messages';
import { ArabianPairingPanel, useDomainResource, usePrincipalScope } from '../../../../../frontend-kit';
import { useHorseDbAdapter } from '../HorseDbAdapter';
import { usePreferences } from '../preferences/PreferencesProvider';
import { Button, Field } from '../components/ui';
import { DeskResourceNotice } from '../components/DeskFeedback';

const positiveId = (value: string) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const idsOf = (value: string) => [...new Set(value.split(/[\s,;،]+/).filter(Boolean).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];

export function BreedingDesk() {
  const { runtime } = useHorseDbAdapter(); const { n, language } = usePreferences();
  const L = (en: string, fa: string) => retroText(language, en, fa);
  const scope = usePrincipalScope(runtime.user, runtime.permissions);
  const [sire, setSire] = useState(''), [dam, setDam] = useState('');
  const [fixed, setFixed] = useState(''), [role, setRole] = useState<'sire' | 'dam'>('sire'), [candidateText, setCandidateText] = useState('');
  const [pairQuery, setPairQuery] = useState<{ sire: number; dam: number } | null>(null);
  const [optQuery, setOptQuery] = useState<{ fixedHorseId: number; fixedRole: 'sire' | 'dam'; candidateIds: number[]; depth: number } | null>(null);
  const pairResource = useDomainResource('retro-pedigree-pair', `${scope}:${JSON.stringify(pairQuery)}`, signal => runtime.platform.breeding.pairingAnalysis(pairQuery!.sire, pairQuery!.dam, { depth: 6 }, { signal }), { enabled: pairQuery != null });
  const optResource = useDomainResource('retro-pedigree-ranking', `${scope}:${JSON.stringify(optQuery)}`, signal => runtime.platform.breeding.optimize(optQuery!, { signal }), { enabled: optQuery != null });
  const pair = pairResource.state.phase === 'ready' || pairResource.state.phase === 'reloading' ? pairResource.state.data : null;
  const opt = optResource.state.phase === 'ready' || optResource.state.phase === 'reloading' ? optResource.state.data : null;
  const pairBusy = pairResource.state.phase === 'loading' || pairResource.state.phase === 'reloading';
  const optBusy = optResource.state.phase === 'loading' || optResource.state.phase === 'reloading';
  const percent = (value: number | null | undefined) => value == null ? '—' : `${n(value, { maximumFractionDigits: 2 })}%`;
  return <>
    <section className="collection-sheet collection-sheet--gold"><div className="collection-sheet-heading"><div><span className="eyebrow">{L('PAIR ANALYSIS', 'تحلیل جفت')}</span><h2>{L('Recorded-pedigree pairing', 'بررسی تبار جفت')}</h2><p>{L('This comparison uses recorded ancestry. It does not predict health, performance or market value.', 'این مقایسه بر پایه تبار ثبت‌شده است و سلامت، عملکرد یا ارزش بازار را پیش‌بینی نمی‌کند.')}</p></div></div>
      <form className="collection-toolbar" onSubmit={event => { event.preventDefault(); setPairQuery({ sire: Number(sire), dam: Number(dam) }); }}>
        <Field label={L('Sire ID', 'شناسه نریان')}><input inputMode="numeric" pattern="[0-9]+" required value={sire} onChange={event => setSire(event.target.value)} /></Field>
        <Field label={L('Dam ID', 'شناسه مادیان')}><input inputMode="numeric" pattern="[0-9]+" required value={dam} onChange={event => setDam(event.target.value)} /></Field>
        <Button type="submit" small disabled={pairBusy || !positiveId(sire) || !positiveId(dam) || sire === dam}>{L('Analyze pair', 'تحلیل جفت')}</Button>
      </form>
      <DeskResourceNotice state={pairResource.state} retry={pairResource.retry} />
      {pair && <div className="profile-totals"><div><strong>{percent(pair.projectedOffspringInbreedingPercent)}</strong><span>{L('Projected offspring COI', 'ضریب هم‌خونی برآوردی کره')}</span></div><div><strong>{percent(pair.parentalRelationshipPercent)}</strong><span>{L('Parental relationship', 'رابطه والدین')}</span></div><div><strong>{n(pair.commonAncestors.length)}</strong><span>{L('Shared ancestors', 'نیاکان مشترک')}</span></div><div><strong>{pair.status === 'ok' ? L('Calculated', 'محاسبه‌شده') : L('Review evidence', 'نیازمند بررسی شواهد')}</strong><span>{L('Evidence status', 'وضعیت شواهد')}</span></div></div>}
      {pair && pairQuery && <ArabianPairingPanel platform={runtime.platform} sireId={pairQuery.sire} damId={pairQuery.dam} locale={language} principalScope={scope} />}
    </section>
    <section className="collection-sheet collection-sheet--green"><div className="collection-sheet-heading"><div><span className="eyebrow">{L('CANDIDATE COMPARISON', 'مقایسه نامزدها')}</span><h2>{L('Compare breeding candidates', 'مقایسه نامزدهای جفت‌گیری')}</h2><p>{L('Ranking reflects the recorded pedigree and its coverage only.', 'رتبه‌بندی فقط بر پایه تبار ثبت‌شده و میزان کامل بودن آن انجام می‌شود.')}</p></div></div>
      <form className="collection-toolbar" onSubmit={event => { event.preventDefault(); setOptQuery({ fixedHorseId: Number(fixed), fixedRole: role, candidateIds: idsOf(candidateText), depth: 6 }); }}>
        <Field label={L('Your horse ID', 'شناسه اسب شما')}><input inputMode="numeric" pattern="[0-9]+" required value={fixed} onChange={event => setFixed(event.target.value)} /></Field>
        <Field label={L('Role', 'نقش')}><select value={role} onChange={event => setRole(event.target.value as 'sire' | 'dam')}><option value="sire">{L('Sire', 'پدر')}</option><option value="dam">{L('Dam', 'مادر')}</option></select></Field>
        <Field label={L('Candidate IDs, separated by commas', 'شناسه نامزدها با کاما جدا شوند')}><input value={candidateText} onChange={event => setCandidateText(event.target.value)} placeholder="12, 34, 56" dir="ltr" required /></Field>
        <Button type="submit" small disabled={optBusy || !positiveId(fixed) || !idsOf(candidateText).length}>{L('Compare candidates', 'مقایسه نامزدها')}</Button>
      </form>
      <DeskResourceNotice state={optResource.state} retry={optResource.retry} />
      {opt && <div className="table-scroll" tabIndex={0} aria-label={L('Candidate comparison', 'مقایسه نامزدها')}><table className="horse-table"><thead><tr><th>{L('Rank', 'رتبه')}</th><th>{L('Candidate', 'نامزد')}</th><th>{L('Pedigree score', 'امتیاز تبار')}</th><th>{L('Projected COI', 'هم‌خونی برآوردی')}</th><th>{L('Evidence confidence', 'اطمینان شواهد')}</th></tr></thead><tbody>{opt.ranked.map(row => <tr key={row.candidate.id}><td>{n(row.rank)}</td><td><a href={`#/horses/${row.candidate.id}`} dir="auto">{language === 'fa' ? row.candidate.name_native || row.candidate.name_latin : row.candidate.name_latin || row.candidate.name_native}</a></td><td>{n(row.confidenceAdjustedScore, { maximumFractionDigits: 2 })}</td><td>{percent(row.projectedOffspringInbreedingPercent)}</td><td>{({ high: L('High', 'زیاد'), medium: L('Medium', 'متوسط'), low: L('Low', 'کم'), insufficient: L('Insufficient', 'ناکافی') } as Record<string, string>)[row.confidenceGrade] || row.confidenceGrade}</td></tr>)}</tbody></table></div>}
    </section>
  </>;
}
