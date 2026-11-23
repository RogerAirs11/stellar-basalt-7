import { useEffect, useMemo, useState } from 'react';
import { pick } from "../../../../../frontend-kit";
import { retroText } from '../i18n/messages';
import { COMPETITION_DISCIPLINES, LISTING_LIFECYCLE, MARKETPLACE_DISCLOSURE, listingLifecycleView, localizedAnalysisText, useDomainResource, useMyMarketplace, useSentInquiries, useWatchlist, useMarketplaceLifecycleCommands, useInquiryConversation, usePrincipalScope, useScopedState, useHorseCredentialStories, useAttestationVerification, useIssuerDirectory, useCredentialStoryCommands, runSnapshotReview, type ResourceState } from '../../../../../frontend-kit';
import { useHorseDbAdapter } from '../HorseDbAdapter';
import { usePreferences } from '../preferences/PreferencesProvider';
import { Button, EmptyState, Field } from '../components/ui';
import { DeskResourceNotice } from '../components/DeskFeedback';

function dataOf<T>(state: ResourceState<T>): T | null { return state.phase === 'ready' || state.phase === 'reloading' ? state.data : null; }
function nameOf(value: { name_latin?: string | null; name_native?: string | null }, fa: boolean) { return (fa ? value.name_native : value.name_latin) || value.name_latin || value.name_native || '—'; }
function positiveId(value: string) { return Number.isSafeInteger(Number(value)) && Number(value) > 0; }

export function PeopleDesk({ personId }: { personId?: string }) {
  const { runtime } = useHorseDbAdapter();
  const { language, n } = usePreferences();
  const fa = language === 'fa'; const L = (en: string, native: string) => retroText(language, en, native);
  const scope = usePrincipalScope(runtime.user, runtime.permissions);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState({ q: '', offset: 0 });
  const [selectedId, setSelectedId] = useScopedState<number | null>(scope, personId && positiveId(personId) ? Number(personId) : null);
  useEffect(() => { setSelectedId(personId && positiveId(personId) ? Number(personId) : null); }, [personId, scope]);
  const people = useDomainResource('retro-people', `${scope}:${JSON.stringify(query)}`, signal => runtime.platform.people.list({ q: query.q || undefined, limit: 25, offset: query.offset }, { signal }), { isEmpty: result => result.people.length === 0 });
  const profile = useDomainResource('retro-person', `${scope}:${selectedId}`, signal => runtime.platform.people.get(selectedId!, { signal }), { enabled: selectedId != null });
  const page = dataOf(people.state); const detail = dataOf(profile.state); const busy = people.state.phase === 'loading' || people.state.phase === 'reloading';
  const roles: Record<string, string> = { owner: L('Owner', 'مالک'), breeder: L('Breeder', 'پرورش‌دهنده'), importer: L('Importer', 'واردکننده'), passport_receiver: L('Passport receiver', 'دریافت‌کننده گذرنامه') };
  return <>
    <form className="collection-toolbar" role="search" onSubmit={event => { event.preventDefault(); setQuery({ q: q.trim(), offset: 0 }); }}>
      <Field label={L('Search people', 'جست‌وجوی افراد')}><input type="search" value={q} onChange={event => setQ(event.target.value)} placeholder={L('Name or ID', 'نام یا شناسه')} dir="auto" /></Field>
      <Button small type="submit" disabled={busy}>{L('Search', 'جست‌وجو')}</Button>
    </form>
    <DeskResourceNotice state={people.state} retry={people.retry} empty={['No people match this search', 'فردی با این مشخصات پیدا نشد']} />
    {page && <><div className="table-scroll" tabIndex={0} aria-label={L('People search results', 'نتایج جست‌وجوی افراد')}><table className="horse-table"><thead><tr><th>{L('Person', 'فرد')}</th><th>{L('Owner', 'مالک')}</th><th>{L('Breeder', 'پرورش‌دهنده')}</th><th>{L('Importer', 'واردکننده')}</th><th>{L('Horses', 'اسب‌ها')}</th><th>{L('Profile', 'نمایه')}</th></tr></thead><tbody>{page.people.map(person => <tr key={person.id}><td><strong dir="auto">{nameOf(person, fa)}</strong><small> <bdi>#{person.id}</bdi></small></td><td>{n(person.owner_count)}</td><td>{n(person.breeder_count)}</td><td>{n(person.importer_count)}</td><td>{n(person.horse_count)}</td><td><Button small onClick={() => setSelectedId(person.id)}>{L('Open', 'مشاهده')}</Button></td></tr>)}</tbody></table></div>
      <div className="pagination"><Button small disabled={busy || !query.offset} onClick={() => setQuery(value => ({ ...value, offset: Math.max(0, value.offset - 25) }))}>{L('Previous', 'قبلی')}</Button><span>{L('Page', 'صفحه')} {n(Math.floor(query.offset / 25) + 1)}</span><Button small disabled={busy || page.people.length < 25} onClick={() => setQuery(value => ({ ...value, offset: value.offset + 25 }))}>{L('Next', 'بعدی')}</Button></div></>}
    {selectedId != null && <section className="collection-sheet collection-sheet--blue"><div className="collection-sheet-heading"><h2>{detail ? nameOf(detail.person, fa) : L('Person profile', 'نمایه فرد')}</h2><Button small onClick={() => setSelectedId(null)}>{L('Close profile', 'بستن نمایه')}</Button></div><DeskResourceNotice state={profile.state} retry={profile.retry} />{detail && <><p className="desk-notice">{n(detail.person.horse_count ?? detail.horses.length)} {L('linked horse records', 'اسب مرتبط')}{detail.truncated ? L(' · Only part of the results is shown.', ' · بخشی از نتایج نمایش داده شده است.') : ''}</p>{detail.horses.length ? <div className="table-scroll" tabIndex={0} aria-label={L('Linked horse records', 'اسب‌های مرتبط')}><table className="horse-table"><thead><tr><th>{L('Horse', 'اسب')}</th><th>{L('Role', 'نقش')}</th><th>{L('Birth year', 'سال تولد')}</th></tr></thead><tbody>{detail.horses.map(horse => <tr key={`${horse.id}:${horse.role}`}><td><a href={`#/horses/${horse.id}`} dir="auto">{nameOf(horse, fa)}</a></td><td>{roles[horse.role ?? ''] || L('Linked record', 'رکورد مرتبط')}</td><td>{horse.birth_year == null ? '—' : n(horse.birth_year)}</td></tr>)}</tbody></table></div> : <EmptyState title={L('No linked horses', 'اسب مرتبطی ثبت نشده است')} description={L('Horse links will appear when recorded.', 'پس از ثبت ارتباط، اسب‌ها در این بخش نمایش داده می‌شوند.')} />}</>}</section>}
  </>;
}

export function RelationshipDesk() {
  const { runtime } = useHorseDbAdapter();
  const { language, n } = usePreferences(); const fa = language === 'fa'; const L = (en: string, native: string) => retroText(language, en, native);
  const scope = usePrincipalScope(runtime.user, runtime.permissions);
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [depth, setDepth] = useState(6);
  const [query, setQuery] = useState<{ from: number; to: number; depth: number } | null>(null);
  const resource = useDomainResource('retro-relationships', `${scope}:${JSON.stringify(query)}`, async signal => {
    const [relationship, coefficients] = await Promise.all([runtime.platform.relationships.commonAncestors(query!.from, query!.to, { depth: query!.depth }, { signal }), runtime.platform.relationships.coefficients(query!.from, query!.to, { depth: query!.depth }, { signal })]);
    return { relationship, coefficients };
  }, { enabled: query != null });
  const value = dataOf(resource.state); const busy = resource.state.phase === 'loading' || resource.state.phase === 'reloading';
  return <>
    <form className="collection-toolbar" onSubmit={event => { event.preventDefault(); setQuery({ from: Number(from), to: Number(to), depth }); }}>
      <Field label={L('Horse A ID', 'شناسه اسب اول')}><input inputMode="numeric" pattern="[0-9]+" required value={from} onChange={event => setFrom(event.target.value)} /></Field>
      <Field label={L('Horse B ID', 'شناسه اسب دوم')}><input inputMode="numeric" pattern="[0-9]+" required value={to} onChange={event => setTo(event.target.value)} /></Field>
      <Field label={L('Generations', 'تعداد نسل')}><select value={depth} onChange={event => setDepth(Number(event.target.value))}>{[4, 5, 6, 7, 8].map(count => <option key={count} value={count}>{n(count)}</option>)}</select></Field>
      <Button small type="submit" disabled={busy || !positiveId(from) || !positiveId(to)}>{L('Compare ancestry', 'مقایسه تبار')}</Button>
    </form>
    <DeskResourceNotice state={resource.state} retry={resource.retry} />
    {!query && <p className="desk-notice">{L('Enter two horse IDs to compare their recorded ancestors.', 'شناسه دو اسب را وارد کنید تا نیاکان ثبت‌شده آن‌ها مقایسه شوند.')}</p>}
    {value && <><div className="profile-totals"><div><strong>{n(value.relationship.commonAncestors.length)}</strong><span>{L('Shared ancestors', 'نیاکان مشترک')}</span></div><div><strong>{value.coefficients.relationshipPercent == null ? '—' : `${n(value.coefficients.relationshipPercent, { maximumFractionDigits: 2 })}%`}</strong><span>{L('Relationship coefficient', 'ضریب رابطه')}</span></div><div><strong>{value.coefficients.kinshipPercent == null ? '—' : `${n(value.coefficients.kinshipPercent, { maximumFractionDigits: 2 })}%`}</strong><span>{L('Kinship coefficient', 'ضریب خویشاوندی')}</span></div></div>
      {value.relationship.commonAncestors.length ? <div className="table-scroll" tabIndex={0} aria-label={L('Shared ancestors', 'نیاکان مشترک')}><table className="horse-table"><thead><tr><th>{L('Ancestor', 'نیا')}</th><th>{L('Generations from A', 'فاصله نسلی از اسب اول')}</th><th>{L('Generations from B', 'فاصله نسلی از اسب دوم')}</th></tr></thead><tbody>{value.relationship.commonAncestors.slice(0, 30).map((item, index) => <tr key={`${item.horse.id}:${index}`}><td><a href={`#/horses/${item.horse.id}`} dir="auto">{nameOf(item.horse, fa)}</a></td><td>{n(item.fromDepth)}</td><td>{n(item.toDepth)}</td></tr>)}</tbody></table></div> : <EmptyState title={L('No shared ancestor found at this depth', 'در این تعداد نسل، نیای مشترکی پیدا نشد')} description={L('Missing pedigree records can limit this comparison.', 'اطلاعات ناقص تبار می‌تواند این مقایسه را محدود کند.')} />}
      <p className="performance-disclaimer">{localizedAnalysisText(value.coefficients.provenance.interpretation, language)}</p>
    </>}
  </>;
}

const DISCIPLINES: Record<string, [string, string]> = { show_jumping: ['Show jumping', 'پرش با اسب'], dressage: ['Dressage', 'درساژ'], endurance: ['Endurance', 'استقامت'], racing: ['Racing', 'اسب‌دوانی'], eventing: ['Eventing', 'سه‌روزه'], showing: ['Showing', 'نمایش زیبایی'], other: ['Other', 'سایر'] };
export function CompetitionDesk() {
  const { runtime } = useHorseDbAdapter(); const { language, n, date } = usePreferences(); const fa = language === 'fa'; const L = (en: string, native: string) => retroText(language, en, native);
  const scope = usePrincipalScope(runtime.user, runtime.permissions);
  const [offset, setOffset] = useState(0), [discipline, setDiscipline] = useState('');
  const [detailId, setDetailId] = useScopedState<number | null>(scope, null);
  const resource = useDomainResource('retro-competitions', `${scope}:${offset}:${discipline}`, signal => runtime.platform.modules.competitions.list({ limit: 25, offset, discipline: discipline || undefined }, { signal }), { isEmpty: value => value.rows.length === 0 });
  const detail = useDomainResource('retro-competition', `${scope}:${detailId}`, signal => runtime.platform.modules.competitions.detail(detailId!, { signal }), { enabled: detailId != null });
  const page = dataOf(resource.state), selected = dataOf(detail.state); const busy = resource.state.phase === 'loading' || resource.state.phase === 'reloading';
  const disciplineName = (value: string) => DISCIPLINES[value] ? L(...DISCIPLINES[value]!) : value.replaceAll('_', ' ');
  if (detailId != null) return <><div className="collection-toolbar"><Button small onClick={() => setDetailId(null)}>{L('Back to competitions', 'بازگشت به مسابقات')}</Button></div><DeskResourceNotice state={detail.state} retry={detail.retry} />{selected && <><div className="collection-sheet-heading"><div><h2 dir="auto">{nameOf(selected.competition, fa)}</h2><p>{[selected.competition.venue, selected.competition.city].filter(Boolean).join(' · ')} · {date(selected.competition.event_date)}</p></div></div>{selected.results.length ? <div className="table-scroll" tabIndex={0} aria-label={L('Competition results', 'نتایج مسابقه')}><table className="horse-table"><thead><tr><th>{L('Result', 'نتیجه')}</th><th>{L('Horse', 'اسب')}</th><th>{L('Rider', 'سوارکار')}</th></tr></thead><tbody>{selected.results.map((row, index) => <tr key={row.id ?? index}><td>{row.is_eliminated ? L('Eliminated', 'حذف') : row.is_withdrawn ? L('Withdrawn', 'انصراف') : row.placement == null ? '—' : n(row.placement)}</td><td>{row.horse_id ? <a href={`#/horses/${row.horse_id}`} dir="auto">{nameOf(row, fa)}</a> : nameOf(row, fa)}</td><td dir="auto">{row.rider_name || '—'}</td></tr>)}</tbody></table></div> : <EmptyState title={L('No results recorded', 'نتیجه‌ای ثبت نشده است')} description={L('Results will appear here after they are recorded.', 'پس از ثبت، نتایج در این بخش نمایش داده می‌شوند.')} />}</>}</>;
  return <><div className="collection-toolbar"><Field label={L('Discipline', 'رشته')}><select value={discipline} onChange={event => { setDiscipline(event.target.value); setOffset(0); }}><option value="">{L('All disciplines', 'همه رشته‌ها')}</option>{COMPETITION_DISCIPLINES.map(value => <option key={value} value={value}>{disciplineName(value)}</option>)}</select></Field></div><DeskResourceNotice state={resource.state} retry={resource.retry} empty={['No competitions match these filters', 'مسابقه‌ای با این فیلترها پیدا نشد']} />{page && <><div className="table-scroll" tabIndex={0} aria-label={L('Competition calendar', 'تقویم مسابقات')}><table className="horse-table"><thead><tr><th>{L('Competition', 'مسابقه')}</th><th>{L('Discipline', 'رشته')}</th><th>{L('Date', 'تاریخ')}</th><th>{L('Venue', 'محل')}</th><th>{L('Results', 'نتایج')}</th></tr></thead><tbody>{page.rows.map(row => <tr key={row.id}><td><button type="button" className="desk-text-button" onClick={() => setDetailId(row.id)} dir="auto">{nameOf(row, fa)}</button></td><td>{disciplineName(row.discipline)}</td><td>{date(row.event_date)}</td><td dir="auto">{[row.venue, row.city].filter(Boolean).join(' · ') || '—'}</td><td>{n(row.result_count ?? 0)}</td></tr>)}</tbody></table></div><div className="pagination"><Button small disabled={busy || !offset} onClick={() => setOffset(value => Math.max(0, value - 25))}>{L('Previous', 'قبلی')}</Button><span>{L('Page', 'صفحه')} {n(Math.floor(offset / 25) + 1)}</span><Button small disabled={busy || offset + 25 >= page.total} onClick={() => setOffset(value => value + 25)}>{L('Next', 'بعدی')}</Button></div></>}</>;
}

export function MarketDesk() {
  const { runtime } = useHorseDbAdapter(); const { language, n } = usePreferences(); const fa = language === 'fa'; const L = (en: string, native: string) => retroText(language, en, native);
  const scope = usePrincipalScope(runtime.user, runtime.permissions); const [offset, setOffset] = useState(0);
  const resource = useDomainResource('retro-market', `${scope}:${offset}`, signal => runtime.platform.modules.market.list({ limit: 25, offset }, { signal }), { isEmpty: value => value.rows.length === 0 });
  const page = dataOf(resource.state); const busy = resource.state.phase === 'loading' || resource.state.phase === 'reloading';
  const statuses: Record<string, string> = { published: L('Published', 'منتشرشده'), active: L('Active', 'فعال'), expired: L('Expired', 'منقضی‌شده'), withdrawn: L('Withdrawn', 'پس‌گرفته‌شده'), reserved: L('Reserved', 'رزروشده'), sold: L('Sold', 'فروخته‌شده'), draft: L('Draft', 'پیش‌نویس'), suspended: L('Suspended', 'تعلیق‌شده'), unavailable: L('Unavailable', 'در دسترس نیست') };
  return <><p className="performance-disclaimer">{pick(MARKETPLACE_DISCLOSURE, language)}</p>{runtime.user ? <RetroMarketLifecycle /> : null}<DeskResourceNotice state={resource.state} retry={resource.retry} empty={['No published listings right now', 'در حال حاضر آگهی منتشرشده‌ای وجود ندارد']} />{page && <><div className="table-scroll" tabIndex={0} aria-label={L('Horse listings', 'آگهی‌های اسب')}><table className="horse-table"><thead><tr><th>{L('Horse', 'اسب')}</th><th>{L('Title', 'عنوان')}</th><th>{L('Asking price', 'قیمت پیشنهادی')}</th><th>{L('Status', 'وضعیت')}</th></tr></thead><tbody>{page.rows.map(row => { const lifecycle = listingLifecycleView({ listing: { status: row.status, expires_at: row.expires_at }, viewerRole: 'public' }); return <tr key={row.id}><td>{row.horse_id ? <a href={`#/horses/${row.horse_id}`} dir="auto">{nameOf(row, fa)}</a> : '—'}</td><td dir="auto">{row.title || '—'}</td><td>{row.price_visible === 0 || row.asking_price_toman == null ? L('Price not published', 'قیمت منتشر نشده') : `${n(row.asking_price_toman)} ${L('toman', 'تومان')}`}</td><td>{lifecycle.expiryStatus === 'invalid' ? L('Invalid expiry date · review required', 'تاریخ انقضا نامعتبر است؛ نیازمند بررسی') : statuses[lifecycle.effectiveStatus] || L('Status needs review', 'وضعیت نیازمند بررسی است')}</td></tr>; })}</tbody></table></div><div className="pagination"><Button small disabled={busy || !offset} onClick={() => setOffset(value => Math.max(0, value - 25))}>{L('Previous', 'قبلی')}</Button><span>{L('Page', 'صفحه')} {n(Math.floor(offset / 25) + 1)}</span><Button small disabled={busy || offset + 25 >= page.total} onClick={() => setOffset(value => value + 25)}>{L('Next', 'بعدی')}</Button></div></>}</>;
}

const RETRO_INQUIRY_STATUS: Record<string, [string, string]> = { new: ['New', 'جدید'], contacted: ['Contacted', 'تماس‌گرفته‌شده'], closed: ['Closed', 'بسته'] };

/** R117-15 (Master AI R117 handoff D19): the signed-in market lifecycle —
 * the seller's own listings + received-inquiry inbox, the buyer's OWN sent
 * inquiries, and the buyer's watchlist — on the ONE shared headless
 * controller. Versioned writes send the row version the renderer read; each
 * sent row reports the listing's CURRENT status honestly while its
 * conversation history stays reachable for both participants. */
function RetroMarketLifecycle() {
  const { runtime } = useHorseDbAdapter(); const { language, n } = usePreferences(); const fa = language === 'fa'; const L = (en: string, native: string) => retroText(language, en, native);
  const scope = usePrincipalScope(runtime.user, runtime.permissions);
  const { mine, retry } = useMyMarketplace({ platform: runtime.platform, scope, userId: runtime.user?.id });
  const { sent, retry: retrySent } = useSentInquiries({ platform: runtime.platform, scope, userId: runtime.user?.id });
  const { watchlist, retry: retryWatchlist } = useWatchlist({ platform: runtime.platform, scope, userId: runtime.user?.id });
  const commands = useMarketplaceLifecycleCommands(scope);
  if (!runtime.user) return null;
  return <section className="collection-sheet collection-sheet--blue" data-surface="market-lifecycle" aria-label={L('My listings and inquiries', 'آگهی‌ها و درخواست‌های من')} style={{ marginBottom: '16px' }}>
    <div className="collection-sheet-heading"><h2>{L('My listings and inquiries', 'آگهی‌ها و درخواست‌های من')}</h2></div>
    <p className="desk-notice">{L('The marketplace is an introduction surface — no payment, delivery or ownership transfer happens here. Status changes are versioned; a changed row is reloaded before your edit can land.', 'بازار فقط سطح آشنایی است — هیچ پرداخت، تحویل یا انتقال مالکیتی اینجا انجام نمی‌شود. تغییر وضعیت نسخه‌دار است؛ ردیف تغییرکرده پیش از اعمال ویرایش شما بازخوانی می‌شود.')}</p>
    {mine.phase === 'loading' ? <p role="status" className="desk-notice">{L('Loading your listings…', 'بارگذاری آگهی‌های شما…')}</p> : null}
    {mine.phase === 'forbidden' || mine.phase === 'unavailable' || mine.phase === 'error' ? <div role="alert" className="desk-notice"><p>{L('Your listing list is unavailable.', 'فهرست آگهی شما در دسترس نیست.')}</p><p dir="auto">{mine.reason}</p><Button small onClick={retry}>{L('Try loading again', 'تلاش دوباره')}</Button></div> : null}
    {mine.phase === 'empty' ? <p className="desk-notice">{L('You have no listings and no received inquiries yet.', 'هنوز آگهی یا درخواستی ندارید.')}</p> : null}
    {(mine.phase === 'ready' || mine.phase === 'reloading') && mine.listings.length ? <div className="table-scroll" tabIndex={0} aria-label={L('My listings', 'آگهی‌های من')} data-surface="market-seller-listings"><table className="horse-table"><thead><tr><th>{L('Horse', 'اسب')}</th><th>{L('Title', 'عنوان')}</th><th>{L('Status', 'وضعیت')}</th><th>{L('Actions', 'اقدامات')}</th></tr></thead><tbody>{mine.listings.map(row => { const lifecycle = listingLifecycleView({ listing: { status: row.status, expires_at: row.expires_at ?? null, seller_mandate_current: null }, viewerRole: 'seller' }); const allowed = (LISTING_LIFECYCLE[lifecycle.effectiveStatus] ?? []).filter(status => status !== 'expired'); return <tr key={row.id} data-surface="market-seller-listing"><td><a href={`#/horses/${row.horse_id}`} dir="auto">{nameOf(row, fa)}</a></td><td dir="auto">{row.title || '—'}</td><td>{lifecycle.effectiveStatus} · v{n(row.row_version ?? 0)}</td><td>{allowed.map(status => <Button key={status} small disabled={commands.setStatus.state.phase === 'submitting'} onClick={() => { void commands.setStatus.run(async () => { const result = await runtime.platform.modules.market.setStatus(row.id, status, { expectedVersion: row.row_version ?? 0 }); retry(); return result; }, { successMessage: L('Listing status updated (versioned).', 'وضعیت آگهی به‌روزرسانی شد (نسخه‌دار).') }); }}>{L(`Mark ${status}`, `علامت ${status}`)}</Button>)}</td></tr>; })}</tbody></table></div> : null}
    {(mine.phase === 'ready' || mine.phase === 'reloading') && mine.inquiries.length ? <div data-surface="market-inquiry-inbox" style={{ marginTop: '12px' }}>
      <h3>{L('Inquiries received on your listings', 'درخواست‌های دریافتی روی آگهی‌های شما')}</h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{mine.inquiries.map(inquiry => <RetroInquiryRow key={String(inquiry.id)} inquiry={inquiry} commands={commands} onDone={retry} seller />)}</ul>
    </div> : null}
    {commands.setStatus.state.phase === 'rejected' || commands.renew.state.phase === 'rejected' ? <p role="alert" dir="auto">{L('The listing changed elsewhere — the current version was reloaded; retry with the fresh version.', 'آگهی جای دیگر تغییر کرده — نسخه فعلی بازخوانی شد؛ با نسخه تازه دوباره تلاش کنید.')}</p> : null}
    <div data-surface="market-sent-inquiries" style={{ marginTop: '12px' }}>
      <h3>{L('My sent inquiries', 'درخواست‌های ارسالی من')}</h3>
      {sent.phase === 'loading' ? <p role="status" className="desk-notice">{L('Loading your sent inquiries…', 'بارگذاری درخواست‌های ارسالی شما…')}</p> : null}
      {sent.phase === 'forbidden' || sent.phase === 'unavailable' || sent.phase === 'error' ? <div role="alert" className="desk-notice"><p>{L('Your sent-inquiry list is unavailable.', 'فهرست درخواست‌های ارسالی شما در دسترس نیست.')}</p><p dir="auto">{sent.reason}</p><Button small onClick={retrySent}>{L('Try loading again', 'تلاش دوباره')}</Button></div> : null}
      {sent.phase === 'empty' ? <p className="desk-notice">{L('You have not sent any inquiries yet — open a listing and ask the seller a question.', 'هنوز درخواستی ارسال نکرده‌اید — یک آگهی را باز کنید و از فروشنده سؤال بپرسید.')}</p> : null}
      {(sent.phase === 'ready' || sent.phase === 'reloading') && sent.rows.length ? <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{(sent.rows as unknown as Array<Record<string, unknown>>).map(row => <RetroInquiryRow key={String(row.id)} inquiry={row} commands={commands} onDone={retrySent} seller={false} />)}</ul> : null}
      {(sent.phase === 'ready' || sent.phase === 'reloading') && sent.rows.length < sent.pagination.total ? <p className="desk-notice">{L(`Showing the newest ${sent.rows.length} of ${sent.pagination.total} sent inquiries.`, `نمایش ${sent.rows.length} درخواست آخر از ${sent.pagination.total} درخواست ارسالی.`)}</p> : null}
    </div>
    <div data-surface="market-watchlist" style={{ marginTop: '12px' }}>
      <h3>{L('My watchlist', 'فهرست پیگیری من')}</h3>
      {watchlist.phase === 'loading' ? <p role="status" className="desk-notice">{L('Loading your watchlist…', 'بارگذاری فهرست پیگیری شما…')}</p> : null}
      {watchlist.phase === 'empty' ? <p className="desk-notice">{L('No saved listings yet — watch a listing to keep it here.', 'هنوز آگهی ذخیره‌شده‌ای نیست — آگهی‌ای را دنبال کنید تا اینجا بماند.')}</p> : null}
      {(watchlist.phase === 'ready' || watchlist.phase === 'reloading') && watchlist.rows.length ? <div className="table-scroll" tabIndex={0} aria-label={L('My watchlist', 'فهرست پیگیری من')}><table className="horse-table"><thead><tr><th>{L('Horse', 'اسب')}</th><th>{L('Listing status', 'وضعیت آگهی')}</th><th>{L('Actions', 'اقدامات')}</th></tr></thead><tbody>{watchlist.rows.map(row => <tr key={String(row.listing_id ?? row.id)} data-surface="market-watchlist-row"><td dir="auto">{fa && row.name_native ? String(row.name_native) : String(row.name_latin ?? row.title ?? `#${row.listing_id ?? row.id}`)}</td><td>{String(row.status ?? '—')}</td><td><Button small disabled={commands.watch.state.phase === 'submitting'} onClick={() => { void commands.watch.run(async () => { const result = await runtime.platform.modules.market.unwatch(String(row.listing_id ?? row.id)); retryWatchlist(); return result; }, { successMessage: L('Removed from your watchlist.', 'از فهرست پیگیری شما حذف شد.') }); }}>{L('Unwatch', 'حذف پیگیری')}</Button></td></tr>)}</tbody></table></div> : null}
    </div>
  </section>;
}

/** ONE inquiry row (seller inbox or buyer sent) in Retro's design language:
 * the participant-only conversation with reply, the versioned inquiry status
 * for the seller, and the buyer's own close action. */
function RetroInquiryRow({ inquiry, commands, onDone, seller }: {
  inquiry: Record<string, unknown>; commands: ReturnType<typeof useMarketplaceLifecycleCommands>; onDone: () => void; seller: boolean;
}) {
  const { runtime } = useHorseDbAdapter(); const { language } = usePreferences(); const fa = language === 'fa'; const L = (en: string, native: string) => retroText(language, en, native);
  const [open, setOpen] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const conversationPlatform = useMemo(() => ({ market: runtime.platform.modules.market }), [runtime.platform]);
  const { state: conversation } = useInquiryConversation(conversationPlatform, String(inquiry.id ?? ''));
  const id = String(inquiry.id ?? ''); const status = String(inquiry.status ?? 'new'); const closed = status === 'closed';
  const listingTitle = inquiry.listing_title ? String(inquiry.listing_title) : '';
  const horseLabel = fa && inquiry.name_native ? String(inquiry.name_native) : (inquiry.name_latin ? String(inquiry.name_latin) : '');
  const listingStatus = inquiry.listing_status ? String(inquiry.listing_status) : null;
  const replyCount = Number(inquiry.reply_count ?? 0);
  return <li data-surface="market-inquiry-row" style={{ borderTop: '1px solid rgba(0,0,0,0.15)', padding: '8px 0' }}>
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
      <strong dir="auto">{seller ? String(inquiry.buyer_name ?? (listingTitle || horseLabel || id)) : (listingTitle || horseLabel || id)}</strong>
      <span className="desk-notice">{RETRO_INQUIRY_STATUS[status] ? L(...RETRO_INQUIRY_STATUS[status]!) : status}{listingStatus ? ` · ${L('listing', 'آگهی')} ${listingStatus}` : ''}{replyCount > 0 ? ` · ${replyCount} ${L('replies', 'پاسخ')}` : ''}{inquiry.created_at ? ` · ${String(inquiry.created_at).slice(0, 10)}` : ''}</span>
    </div>
    <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
      <Button small onClick={() => setOpen(value => !value)}>{open ? L('Hide conversation', 'پنهان‌کردن تبادل پیام') : L('Conversation', 'تبادل پیام')}</Button>
      {seller && !closed ? <Button small disabled={commands.setInquiryStatus.state.phase === 'submitting'} onClick={() => { void commands.setInquiryStatus.run(async () => { const result = await runtime.platform.modules.market.setInquiryStatus(id, status === 'new' ? 'contacted' : 'closed', { expectedVersion: Number(inquiry.row_version ?? 0) }); onDone(); return result; }, { successMessage: L('Inquiry status updated (versioned).', 'وضعیت درخواست به‌روزرسانی شد (نسخه‌دار).') }); }}>{status === 'new' ? L('Mark contacted', 'تماس‌گرفته‌شده') : L('Close inquiry', 'بستن درخواست')}</Button> : null}
      {!seller && !closed ? <Button small disabled={commands.closeOwnInquiry.state.phase === 'submitting'} onClick={() => { void commands.closeOwnInquiry.run(async () => { const result = await runtime.platform.modules.market.closeOwnInquiry(id, { expectedVersion: Number(inquiry.row_version ?? 0) }); onDone(); return result; }, { successMessage: L('Your inquiry is closed. No further replies are accepted.', 'درخواست شما بسته شد. پاسخ دیگری پذیرفته نمی‌شود.') }); }}>{L('Close my inquiry', 'بستن درخواست من')}</Button> : null}
    </div>
    {open ? <div data-surface="market-conversation" style={{ marginTop: '8px' }}>
      {conversation.phase === 'loading' ? <p role="status" className="desk-notice">{L('Loading the conversation…', 'بارگذاری تبادل پیام…')}</p> : null}
      {conversation.phase === 'forbidden' ? <p role="alert" className="desk-notice">{L('Only the participants can read this conversation.', 'فقط طرف‌های درخواست می‌توانند این تبادل پیام را بخوانند.')}</p> : null}
      {conversation.phase === 'not_found' ? <p role="alert" className="desk-notice">{L('This inquiry is no longer available.', 'این درخواست دیگر در دسترس نیست.')}</p> : null}
      {conversation.phase === 'error' ? <p role="alert" className="desk-notice">{conversation.error.kind === 'not_found' ? L('This inquiry is no longer available.', 'این درخواست دیگر در دسترس نیست.') : conversation.error.message}</p> : null}
      {(conversation.phase === 'ready' || conversation.phase === 'sending') ? (conversation.thread.entries.length ? <ul style={{ paddingLeft: '16px' }}>{conversation.thread.entries.map(entry => <li key={entry.id}><strong>{entry.side}</strong> <small>{entry.createdAt}</small><p dir="auto">{entry.body}</p></li>)}</ul> : <p className="desk-notice">{L('No messages yet.', 'هنوز پیامی نیست.')}</p>) : null}
      {!closed ? <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
        <input dir="auto" maxLength={4000} value={replyBody} disabled={commands.reply.state.phase === 'submitting'} onChange={event => setReplyBody(event.target.value)} placeholder={L('Reply', 'پاسخ')} style={{ flex: '1 1 240px' }} />
        <Button small disabled={commands.reply.state.phase === 'submitting' || replyBody.trim().length < 1} onClick={() => { void commands.reply.run(async () => { const result = await runtime.platform.modules.market.reply(id, { body: replyBody.trim() }); setReplyBody(''); onDone(); return result; }, { successMessage: L('Reply sent to the conversation.', 'پاسخ در تبادل پیام ارسال شد.') }); }}>{L('Send reply', 'ارسال پاسخ')}</Button>
      </div> : <p className="desk-notice">{L('This inquiry is closed — the conversation is read-only history.', 'این درخواست بسته است — تبادل پیام فقط تاریخچه خواندنی است.')}</p>}
      {commands.setInquiryStatus.state.phase === 'rejected' || commands.closeOwnInquiry.state.phase === 'rejected' ? <p role="alert" dir="auto">{L('The inquiry changed elsewhere — reload its current version and retry.', 'درخواست جای دیگر تغییر کرده — نسخه فعلی را بازخوانی و دوباره تلاش کنید.')}</p> : null}
    </div> : null}
  </li>;
}


type RetroCredentialStoriesState = import('../../../../../frontend-kit').CredentialStoriesSnapshot;
type RetroResourceState = import('../../../../../frontend-kit').ResourceState<unknown[]>;
function noticeStateOf(stories: RetroCredentialStoriesState): RetroResourceState {
  const phase: string = stories.phase;
  if (phase === 'loading') return { phase: 'loading' };
  if (phase === 'ready' || phase === 'reloading') return { phase: 'ready', data: (stories as { rows: unknown[] }).rows };
  if (phase === 'empty') return { phase: 'empty' };
  if (phase === 'forbidden' || phase === 'unavailable' || phase === 'error') return { phase: 'error', reason: (stories as { reason: string }).reason };
  return { phase: 'error', reason: '' };
}

/** R117-16 (Master AI R117 handoff D24): the truthful credential story desk —
 * the PUBLIC read projection + verification states for a chosen horse, the
 * member-scoped issue form, the owner-scoped revoke/supersede and the PRIVATE
 * snapshot review, bound to the ONE shared headless controller. No demo badge
 * implies real federation, ownership or laboratory approval. */
const RETRO_VERIFY_STATE_LABEL: Record<string, [string, string]> = {
  current: ['Current — sources unchanged since issuance', 'معتبر — منابع از زمان صدور تغییر نکرده‌اند'],
  expired: ['Expired — the validity window has passed; the recorded snapshot is preserved', 'منقضی — پنجره اعتبار گذشته است؛ تصویر ثبت‌شده حفظ می‌شود'],
  revoked: ['Revoked by the issuer; the recorded snapshot is preserved', 'لغوشده توسط مرجع؛ تصویر ثبت‌شده حفظ می‌شود'],
  superseded: ['Superseded by a newer attestation of the same record', 'جایگزین‌شده توسط تأیید جدیدتر همان رکورد'],
  source_changed: ['Source record changed after issuance — the attested snapshot no longer matches', 'رکورد منبع بعد از صدور تغییر کرده — تصویر تأییدشده دیگر منطبق نیست'],
  snapshot_tampered: ['Snapshot digest mismatch — the stored evidence fails its own integrity check', 'عدم تطابق چکیده تصویر — شواهد ذخیره‌شده در بررسی یکپارچگی خودش مردود است'],
  unbound_legacy: ['Legacy record without a bound snapshot; requires review', 'رکورد قدیمی بدون تصویر پیوند‌شده؛ نیازمند بررسی'],
};

export function CredentialDesk() {
  const { runtime } = useHorseDbAdapter();
  const { language, n } = usePreferences();
  const fa = language === 'fa'; const L = (en: string, native: string) => retroText(language, en, native);
  const scope = usePrincipalScope(runtime.user, runtime.permissions);
  const [horseInput, setHorseInput] = useState('');
  const [horseId, setHorseId] = useState<number | null>(null);
  const { stories, retry } = useHorseCredentialStories({ platform: runtime.platform, scope, horseId });
  const { directory } = useIssuerDirectory({ platform: runtime.platform, scope });
  const commands = useCredentialStoryCommands(scope);
  const [issuerId, setIssuerId] = useState('');
  const [recordKind, setRecordKind] = useState<'genetic_test' | 'horse_identity'>('genetic_test');
  const [recordId, setRecordId] = useState('');
  const [statement, setStatement] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  return <div data-surface="credential-stories">
    <form className="collection-toolbar" onSubmit={event => { event.preventDefault(); setHorseId(positiveId(horseInput) ? Number(horseInput) : null); }}>
      <Field label={L('Horse ID', 'شناسه اسب')}><input inputMode="numeric" pattern="[0-9]+" required value={horseInput} onChange={event => setHorseInput(event.target.value)} placeholder="900000017" /></Field>
      <Button small type="submit">{L('Show credentials', 'نمایش اعتبارنامه‌ها')}</Button>
    </form>
    <p className="desk-notice">{L('Issuer credentials demonstrate narrow approved scopes with immutable server-derived snapshots. Issuers on this synthetic instance are explicitly fictional — no badge implies real federation, ownership or laboratory approval.', 'اعتبارنامه‌های مرجع محدوده‌های تأییدشده محدود را با تصاویر تغییرناپذیر نشان می‌دهند. مراجع این نمونه ساختگی صراحتاً خیالی‌اند — هیچ نشان به معنای فدراسیون واقعی، مالکیت یا تأیید آزمایشگاهی نیست.')}</p>
    {!horseId && <p className="desk-notice">{L('Enter a horse ID to read its issuer credentials.', 'شناسه یک اسب را وارد کنید تا اعتبارنامه‌های مرجع آن را ببینید.')}</p>}
    {horseId != null && <>
      <DeskResourceNotice state={noticeStateOf(stories)} retry={retry} empty={['No issuer credential is recorded for this horse yet', 'هنوز اعتبارنامه‌ای از مرجع بیرونی برای این اسب ثبت نشده است']} />
      {(stories.phase === 'ready' || stories.phase === 'reloading') && stories.rows.length ? stories.rows.map(row => <RetroCredentialRow key={row.id} row={row} />) : null}
      {runtime.user ? <section className="collection-sheet collection-sheet--gold" data-surface="credential-issue" style={{ marginTop: '12px' }}>
        <div className="collection-sheet-heading"><h2>{L('Attest under an issuer (member-scoped)', 'صدور تأیید به نام یک مرجع (محدود به عضو)')}</h2></div>
        <p className="desk-notice">{L('You may attest only under an issuer that granted you an active membership, and only within its narrow approved scope — the server refuses anything else.', 'فقط مرجعی که به شما عضویت فعال داده و فقط در محدوده تأییدشده محدود آن می‌توانید تأیید صادر کنید — سرور هر چیز دیگر را رد می‌کند.')}</p>
        <form className="collection-toolbar" onSubmit={event => { event.preventDefault(); if (!issuerId || !recordId.trim()) return; void commands.issue.run(async () => {
          const result = await runtime.platform.modules.attestations.issue(issuerId, { record_kind: recordKind, record_id: recordId.trim(), statement: statement.trim() || null, expires_at: expiresAt.trim() || null });
          setStatement(''); setExpiresAt(''); retry(); return result;
        }, { successMessage: L('Credential issued with an immutable server-derived snapshot.', 'اعتبارنامه با تصویر برگرفته از سرور و تغییرناپذیر صادر شد.') }); }}>
          <Field label={L('Issuer', 'مرجع')}><select value={issuerId} onChange={event => setIssuerId(event.target.value)}>
            <option value="">{L('Choose an issuer…', 'یک مرجع انتخاب کنید…')}</option>
            {(directory.phase === 'ready' || directory.phase === 'reloading') ? directory.issuers.map(issuer => <option key={issuer.id} value={issuer.id}>{fa && issuer.name_native ? issuer.name_native : issuer.name}</option>) : null}
          </select></Field>
          <Field label={L('Record kind', 'نوع رکورد')}><select value={recordKind} onChange={event => setRecordKind(event.target.value as 'genetic_test' | 'horse_identity')}>
            <option value="genetic_test">{L('Reviewed genetic test', 'آزمون ژنتیکی بررسی‌شده')}</option>
            <option value="horse_identity">{L('Horse identity', 'هویت اسب')}</option>
          </select></Field>
          <Field label={L(recordKind === 'horse_identity' ? 'Horse id' : 'Genetic test id', recordKind === 'horse_identity' ? 'شناسه اسب' : 'شناسه آزمون ژنتیکی')}><input inputMode="numeric" value={recordId} onChange={event => setRecordId(event.target.value)} placeholder={recordKind === 'horse_identity' ? String(horseId) : '980000008'} /></Field>
          <Field label={L('Statement (optional)', 'اظهار (اختیاری)')}><input dir="auto" maxLength={2000} value={statement} onChange={event => setStatement(event.target.value)} /></Field>
          <Field label={L('Expires at (optional)', 'اعتبار تا (اختیاری)')}><input value={expiresAt} placeholder="2026-12-31T00:00:00Z" onChange={event => setExpiresAt(event.target.value)} /></Field>
          <Button small type="submit" disabled={commands.issue.state.phase === 'submitting' || !issuerId || !recordId.trim()}>{L('Issue credential', 'صدور اعتبارنامه')}</Button>
        </form>
        {commands.issue.state.phase === 'rejected' ? <p role="alert" className="desk-notice" dir="auto">{L('The issuer refused this issuance — membership, narrow scope, record or evidence rules.', 'مرجع این صدور را رد کرد — عضویت، محدوده محدود، رکورد یا قواعد شواهد.')}</p> : null}
      </section> : null}
    </>}
  </div>;

  function RetroCredentialRow({ row }: { row: import('../../../../../frontend-kit').CredentialStoryRow }) {
    const [verifyOpen, setVerifyOpen] = useState(false);
    const [actionsOpen, setActionsOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [replacement, setReplacement] = useState('');
    const [snapshot, setSnapshot] = useState<{ phase: 'idle' } | { phase: 'granted'; digest: string } | { phase: 'refused' }>({ phase: 'idle' });
    const { verification, retry: retryVerify } = useAttestationVerification({ platform: runtime.platform, scope: `credential:${row.id}`, attestationId: verifyOpen ? row.id : null });
    const effective = row.effective_status || row.status;
    return <section className="collection-sheet collection-sheet--blue" data-surface="credential-row" data-attestation-id={row.id} style={{ marginTop: '12px' }}>
      <div className="collection-sheet-heading"><h2 dir="auto">{fa && row.issuer.name_native ? row.issuer.name_native : row.issuer.name}</h2><span className="eyebrow">{row.issuer.kind}</span></div>
      <p className="desk-notice">{row.record_kind} #{n(Number(row.record_id) || 0)} · {effective}{row.expires_at ? ` · ${L('valid until', 'اعتبار تا')} ${row.expires_at.slice(0, 10)}` : ''} · {L('issued', 'صدور')} {row.issued_at.slice(0, 10)}</p>
      <p className="desk-notice">{L('Public metadata only — the statement and scope stay private to authorized review.', 'فقط فراداده عمومی — اظهار و محدوده برای بررسی مجاز خصوصی می‌ماند.')}</p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <Button small onClick={() => setVerifyOpen(value => !value)}>{verifyOpen ? L('Hide verification', 'پنهان‌کردن راستی‌آزمایی') : L('Verify', 'راستی‌آزمایی')}</Button>
        {runtime.user ? <Button small onClick={() => setActionsOpen(value => !value)}>{actionsOpen ? L('Hide owner actions', 'پنهان‌کردن اقدامات مالک') : L('Owner actions', 'اقدامات مالک')}</Button> : null}
        {runtime.user ? <Button small onClick={async () => { setSnapshot({ phase: 'idle' }); const outcome = await runSnapshotReview(runtime.platform, row.id); setSnapshot(outcome.phase === 'granted' ? { phase: 'granted', digest: String((outcome.review.snapshot as Record<string, unknown>).content_digest ?? '') } : { phase: 'refused' }); }}>{L('Review snapshot (private)', 'بازبینی تصویر (خصوصی)')}</Button> : null}
      </div>
      {verifyOpen ? <div data-surface="credential-verify" style={{ marginTop: '8px' }}>
        {verification.phase === 'loading' ? <p role="status">{L('Verifying…', 'در حال راستی‌آزمایی…')}</p> : null}
        {verification.phase === 'not_found' || verification.phase === 'forbidden' || verification.phase === 'unavailable' || verification.phase === 'error' ? <div role="alert"><p className="desk-notice">{L('Verification is unavailable right now.', 'راستی‌آزمایی الان در دسترس نیست.')}</p>{verification.phase !== 'not_found' ? <p dir="auto" className="desk-notice">{verification.reason}</p> : null}<Button small onClick={retryVerify}>{L('Retry', 'تلاش دوباره')}</Button></div> : null}
        {(verification.phase === 'ready' || verification.phase === 'reloading') ? <div>
          <p className="desk-notice"><b>{L('State', 'وضعیت')}:</b> {RETRO_VERIFY_STATE_LABEL[verification.verification.verification_state]?.[fa ? 1 : 0] ?? verification.verification.verification_state} · <b>{L('Effective', 'مؤثر')}:</b> {verification.verification.effective_status}{verification.verification.snapshot ? <> · <b>{L('Digest', 'چکیده')}:</b> <code>{verification.verification.snapshot.content_digest.slice(0, 16)}…</code></> : null}</p>
          {verification.verification.source_detail ? <p className="desk-notice"><b>{L('Changed sources', 'منابع تغییرکرده')}:</b> {(verification.verification.source_detail.changed_tables ?? []).join(', ')}</p> : null}
          <p className="desk-notice" dir="auto">{verification.verification.note}</p>
        </div> : null}
      </div> : null}
      {actionsOpen && runtime.user ? <div data-surface="credential-owner-actions" style={{ marginTop: '8px' }}>
        <p className="desk-notice">{L('Revocation and supersession are issuer-owner (or platform content-manager) commands. A reason is required; the recorded snapshot is never rewritten.', 'لغو و جایگزینی فرمان مالک مرجع (یا مدیر محتوای سامانه) است. دلیل الزامی است؛ تصویر ثبت‌شده هرگز بازنویسی نمی‌شود.')}</p>
        <Field label={L('Reason', 'دلیل')}><input dir="auto" maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></Field>
        <Field label={L('Replacement statement (for supersede)', 'اظهار جایگزین (برای جایگزینی)')}><input dir="auto" maxLength={2000} value={replacement} onChange={event => setReplacement(event.target.value)} /></Field>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
          <Button small disabled={commands.revoke.state.phase === 'submitting' || reason.trim().length < 3 || row.status !== 'active'} onClick={() => { void commands.revoke.run(async () => {
            const result = await runtime.platform.modules.attestations.revoke(row.id, { reason: reason.trim() });
            setReason(''); retry(); return result;
          }, { successMessage: L('Credential revoked — the current status changed; the snapshot is preserved.', 'اعتبارنامه لغو شد — وضعیت فعلی تغییر کرد؛ تصویر حفظ می‌شود.') }); }}>{L('Revoke', 'لغو')}</Button>
          <Button small disabled={commands.supersede.state.phase === 'submitting' || reason.trim().length < 3 || replacement.trim().length < 1 || row.status !== 'active'} onClick={() => { void commands.supersede.run(async () => {
            const result = await runtime.platform.modules.attestations.supersede(row.id, { reason: reason.trim(), replacement: { record_kind: row.record_kind, record_id: row.record_id, statement: replacement.trim() } });
            setReason(''); setReplacement(''); retry(); return result;
          }, { successMessage: L('Superseded — a replacement was issued; the history stays visible.', 'جایگزین شد — اعتبارنامه جدید صادر شد؛ تاریخچه قابل مشاهده می‌ماند.') }); }}>{L('Supersede with replacement', 'جایگزینی با نسخه جدید')}</Button>
        </div>
        {commands.revoke.state.phase === 'rejected' || commands.supersede.state.phase === 'rejected' ? <p role="alert" dir="auto">{L('The command was refused — authority, state or version rules. The recorded history is unchanged.', 'فرمان رد شد — قواعد اختیار، وضعیت یا نسخه. تاریخچه ثبت‌شده تغییر نکرد.')}</p> : null}
      </div> : null}
      {snapshot.phase !== 'idle' ? <div data-surface="credential-snapshot-review" style={{ marginTop: '8px' }}>
        {snapshot.phase === 'granted' ? <p className="desk-notice">{L('Private snapshot review: authorized — full bytes stay private; digest', 'بازبینی خصوصی تصویر: مجاز — بایت‌های کامل خصوصی می‌مانند؛ چکیده')} <code>{snapshot.digest.slice(0, 16)}…</code></p> : <p className="desk-notice" role="alert">{L('Refused — only platform content managers or the issuer\'s active owner may review the full snapshot.', 'رد شد — فقط مدیران محتوای سامانه یا مالک فعال مرجع می‌توانند تصویر کامل را بازبینی کنند.')}</p>}
      </div> : null}
    </section>;
  }
}
