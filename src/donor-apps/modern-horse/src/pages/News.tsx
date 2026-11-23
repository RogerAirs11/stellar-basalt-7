import { useEffect, useMemo, useState } from 'react';
import { Clock, Newspaper, Search, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { Chip, Pill, Split, inputCls } from '../components/ui';
import { Page } from '../components/Shell';
import { PHASE } from '../theme';
import { go } from '../lib';
import { fetchContentPosts, type LivePost } from '../live';
import { cn } from '../utils/cn';



/**
 * R161 DATA PARITY — the feed is served live from GET /api/content/posts
 * (the same bilingual, editorially-versioned newsroom the core interface
 * renders at /newsroom). The mockup's sample articles remain only as the
 * offline fallback and are then clearly labelled as samples.
 */
export function NewsPage({ sel }: { sel: string | null }) {
  const { tx, tr, n, date } = useI18n();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [posts, setPosts] = useState<LivePost[] | null>(null);
  const [liveFailed, setLiveFailed] = useState(false);

  const [attempt,setAttempt] = useState(0);
  useEffect(() => {
    setLiveFailed(false);
    let live = true;
    (async () => {
      const res = await fetchContentPosts(12, 0);
      if (!live) return;
      if (res) setPosts(res.posts);
      else setLiveFailed(true);
    })();
    return () => { live = false; };
  }, [attempt]);

  const liveList = useMemo(() => {
    if (!posts) return [];
    const s = q.trim().toLowerCase();
    return posts.filter((p) => (cat === 'all' || p.kind === cat) && (!s || p.title.en.toLowerCase().includes(s) || p.title.fa.includes(s) || tr(p.summary).toLowerCase().includes(s)));
  }, [posts, q, cat,tr]);
  const usingLive = posts !== null;
  const curLive = liveList.find(x=>x.id===sel) || liveList[0];
  const kinds = [...new Set((posts??[]).map(x=>x.kind))];
  const name=(k:string)=>({news:tx('News','خبر'),article:tx('Article','مقاله'),update:tx('Update','به‌روزرسانی')}[k]||k);

  return (
    <Page phase="news" fill title={tx('News & updates', 'اخبار و به‌روزرسانی‌ها')} subtitle={usingLive ? tx('Published by the registry\u2019s editorial team — same newsroom as the core interface.', 'منتشرشده توسط تیم تحریریه ثبت — همان خبرخانه رابط اصلی.') : tx('Announcements from the registry, federation and genetics lab.', 'اطلاعیه‌های ثبت، فدراسیون و آزمایشگاه ژنتیک.')}
      toolbar={
        <div className="panel flex flex-wrap items-center gap-2 p-2">
          <div className="relative min-w-[170px] flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('Search news…', 'جستجوی اخبار…')} className={cn(inputCls, 'ps-9')} />
            {q && <button onClick={() => setQ('')} className="absolute end-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-navy-400 hover:bg-surface-2" aria-label="Clear"><X className="h-3.5 w-3.5" /></button>}
          </div>
          <div className="hide-scroll flex gap-1.5 overflow-x-auto">
            <Chip phase="news" active={cat === 'all'} onClick={() => setCat('all')}>{tx('All', 'همه')}</Chip>
            {kinds.map(k=><Chip key={k} phase="news" active={cat===k} onClick={()=>setCat(k)}>{name(k)}</Chip>)}
          </div>
        </div>
      }
    >
      {usingLive ? (
        <Split
          hasSel={!!sel}
          onBack={() => go('/news')}
          listW="lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,480px)_minmax(0,1fr)]"
          list={
            <ul className="space-y-1.5">
              {liveList.map((x, i) => {
                const ph = PHASE.news;
                return (
                  <li key={x.id}>
                    <a href={`#/news?n=${x.id}`} aria-current={curLive?.id === x.id} className={cn('flex gap-2.5 rounded-xl border p-1.5 transition-all', curLive?.id === x.id ? cn('bg-surface shadow-md', ph.border) : 'border-transparent bg-surface/60 hover:border-line hover:bg-surface')} style={{ animation: `enter .35s ${i * 40}ms both` }}>
                      {x.cover
                        ? <img src={x.cover} alt="" loading="lazy" className="h-[68px] w-24 shrink-0 rounded-lg object-cover" />
                        : <span className={cn('grid h-[68px] w-24 shrink-0 place-items-center rounded-lg', ph.soft)}><Newspaper className={cn('h-6 w-6', ph.text)} /></span>}
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"><span className={cn('h-2 w-2 rounded-full', ph.dot)} /><span className={ph.text}>{name(x.kind)}</span><span className="font-medium normal-case tracking-normal text-navy-400">· {x.publishedAt ? date(x.publishedAt) : ''}</span></span>
                        <span className="mt-0.5 line-clamp-2 text-[13px] font-bold text-fg-navy-900">{tr(x.title)}</span>
                      </span>
                    </a>
                  </li>
                );
              })}
              {!liveList.length && <li className="panel p-8 text-center text-sm text-fg-navy-500">{tx('No news found', 'خبری یافت نشد')}</li>}
            </ul>
          }
          detail={curLive ? (
            <article key={curLive.id} className="panel animate-enter overflow-hidden">
              <div className={cn('relative', curLive.cover ? 'h-52 sm:h-64' : 'h-20')}>
                {curLive.cover && <img src={curLive.cover} alt="" className="h-full w-full object-cover" />}
                {!curLive.cover && <div className={cn('h-full w-full', PHASE.news.soft)} />}
                <div className="absolute inset-x-4 bottom-3 text-white [text-shadow:0_1px_8px_rgb(0_0_0/.5)]">
                  <Pill tone="sky" className="mb-1.5 !bg-surface/90">{name(curLive.kind)}</Pill>
                  <h2 className="font-display text-2xl font-semibold leading-tight sm:text-3xl">{tr(curLive.title)}</h2>
                </div>
              </div>
              <div className="p-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line pb-3 text-xs text-fg-navy-500">
                  {curLive.author && <span className="flex items-center gap-1.5"><Newspaper className="h-3.5 w-3.5" />{curLive.author}</span>}
                  {curLive.publishedAt && <span>{date(curLive.publishedAt, 'long')}</span>}
                  <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{n(Math.max(1, Math.round(tr(curLive.body).split(/\s+/).length / 200)))} {tx('min read', 'دقیقه مطالعه')}</span>
                </div>
                {tr(curLive.summary) && <p className="mt-3 rounded-xl bg-surface-2/70 p-3 text-[13px] font-semibold leading-relaxed text-fg-navy-700">{tr(curLive.summary)}</p>}
                <p className="mt-3 max-w-3xl whitespace-pre-line text-[15px] leading-relaxed text-fg-navy-800">{tr(curLive.body)}</p>
                <div className="mt-5 flex flex-wrap gap-2">{liveList.filter((x) => x.kind === curLive.kind && x.id !== curLive.id).slice(0, 2).map((x) => <a key={x.id} href={`#/news?n=${x.id}`} className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-semibold text-fg-navy-700 transition hover:bg-slate-200">{tr(x.title)}</a>)}</div>
              </div>
            </article>
          ) : <div className="panel grid place-items-center p-8 text-sm text-fg-navy-500">…</div>}
        />
      ) : <section className="panel p-4" role="status">{liveFailed ? <><p>{tx('Published news is unavailable.','اخبار منتشرشده در دسترس نیست.')}</p><button className="mt-2 min-h-11" onClick={()=>setAttempt(n=>n+1)}>{tx('Try again','تلاش دوباره')}</button></> : tx('Loading published news…','در حال بارگذاری اخبار…')}</section>}
    </Page>
  );
}
