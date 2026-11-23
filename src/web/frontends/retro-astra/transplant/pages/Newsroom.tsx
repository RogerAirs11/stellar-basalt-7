import { useEffect, useMemo, useState } from 'react';
import { retroText } from '../i18n/messages';
import { Bot, Check, ExternalLink, Eye, FilePenLine, Globe2, History, Image as ImageIcon, LogIn, Newspaper, RefreshCw, Save, Send, Sparkles, Undo2 } from 'lucide-react';
import {
  hasPlatformPermission,
  usePrincipalScope,
  useScopedState,
  type ContentPost,
  type ContentPostInput,
  type ContentPostKind,
  type ContentPostRevision,
  type ContentPostStatus,
  type ContentLanguageStatus,
  type ContentMediaRights,
  type AiContentModel,
} from '../../../../../frontend-kit';
import { useHorseDbAdapter } from '../HorseDbAdapter';
import { resolveExternalImage } from '../../../../../frontend-kit';
import { Button, Field } from '../components/ui';
import { usePreferences } from '../preferences/PreferencesProvider';

const MODELS: { value: AiContentModel; label: string; note: string }[] = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: 'Fast and reliable (recommended)' },
  { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', note: 'Higher-quality agentic writing' },
  { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', note: 'Lightweight' },
  { value: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', note: 'Paid alternate / long-form' },
  { value: 'offline-test', label: 'Offline sandbox draft', note: 'No API — deterministic test mode' },
];
const KINDS: ContentPostKind[] = ['article', 'news', 'update'];

function emptyDraft(): ContentPostInput {
  return {
    kind: 'article', status: 'draft',
    title_en: '', title_fa: '', summary_en: '', summary_fa: '', body_en: '', body_fa: '',
    tags: [], sources: [],
    cover_image_url: null, cover_image_alt_en: null, cover_image_alt_fa: null,
    cover_image_credit: null, cover_image_source_url: null,
    ai_model: null, ai_grounding: false, ai_prompt: null,
  };
}
function text(post: ContentPost, fa: boolean, key: 'title' | 'summary' | 'body') {
  const primary = key === 'title' ? (fa ? post.title_fa : post.title_en) : key === 'summary' ? (fa ? post.summary_fa : post.summary_en) : (fa ? post.body_fa : post.body_en);
  const fallback = key === 'title' ? (fa ? post.title_en : post.title_fa) : key === 'summary' ? (fa ? post.summary_en : post.summary_fa) : (fa ? post.body_en : post.body_fa);
  return primary || fallback;
}
function imageAlt(post: ContentPost, fa: boolean) {
  return (fa ? post.cover_image_alt_fa : post.cover_image_alt_en) || (fa ? post.cover_image_alt_en : post.cover_image_alt_fa) || text(post, fa, 'title');
}
function kindLabel(kind: ContentPostKind, fa: boolean) {
  return fa ? ({ article: 'مقاله / وبلاگ', news: 'خبر', update: 'به‌روزرسانی' }[kind]) : ({ article: 'Article / Blog', news: 'News', update: 'Update' }[kind]);
}
function statusLabel(status: ContentPostStatus, fa: boolean) {
  return fa ? ({ draft: 'پیش‌نویس', published: 'منتشرشده', archived: 'بایگانی' }[status]) : ({ draft: 'Draft', published: 'Published', archived: 'Archived' }[status]);
}
/** R117-17: per-language readiness and media-publication rights — two
 * separate live indicators, never conflated with publication status. */
function languageStatusOf(title: string, body: string): ContentLanguageStatus {
  const hasTitle = Boolean(title.trim());
  const hasBody = Boolean(body.trim());
  if (hasTitle && hasBody) return 'complete';
  if (hasTitle || hasBody) return 'partial';
  return 'missing';
}
function languageLabel(status: ContentLanguageStatus, fa: boolean) {
  return fa ? ({ complete: 'کامل', partial: 'ناقص', missing: 'وجود ندارد' }[status]) : ({ complete: 'complete', partial: 'partial', missing: 'missing' }[status]);
}
function mediaRightsOf(url: string | null | undefined, credit: string | null | undefined, source: string | null | undefined): ContentMediaRights {
  if (!url || !url.trim()) return 'no_media';
  return (credit && credit.trim()) || (source && source.trim()) ? 'attributed' : 'unattributed';
}
function mediaRightsLabel(rights: ContentMediaRights, fa: boolean) {
  return fa
    ? ({ no_media: 'بدون تصویر', attributed: 'تصویر دارای اعتبار', unattributed: 'تصویر بدون اعتبار' }[rights])
    : ({ no_media: 'No cover media', attributed: 'Media attributed', unattributed: 'Media unattributed' }[rights]);
}
function causeLabel(cause: ContentPostRevision['cause'], fa: boolean) {
  return fa
    ? ({ create: 'ایجاد', update: 'ویرایش', publish: 'انتشار', retract: 'بازپس‌گیری' }[cause])
    : ({ create: 'Created', update: 'Edited', publish: 'Published', retract: 'Retracted' }[cause]);
}

function SimpleMarkdown({ value }: { value: string }) {
  const blocks = value.split(/\n{2,}/).map(v => v.trim()).filter(Boolean);
  return <div className="newsroom-markdown">{blocks.map((block, index) => {
    if (block.startsWith('### ')) return <h4 key={index}>{block.slice(4)}</h4>;
    if (block.startsWith('## ')) return <h3 key={index}>{block.slice(3)}</h3>;
    if (block.startsWith('# ')) return <h2 key={index}>{block.slice(2)}</h2>;
    const lines = block.split('\n');
    if (lines.every(line => /^[-*] /.test(line))) return <ul key={index}>{lines.map((line, i) => <li key={i}>{line.replace(/^[-*] /, '')}</li>)}</ul>;
    return <p key={index}>{lines.map((line, i) => <span key={i}>{line}{i < lines.length - 1 && <br />}</span>)}</p>;
  })}</div>;
}

function CoverImage({ post, fa, compact = false }: { post: ContentPost; fa: boolean; compact?: boolean }) {
  if (!post.cover_image_url) return null;
  return <figure className={compact ? 'newsroom-card-image' : 'newsroom-reader-cover'}>
    <img src={resolveExternalImage(post.cover_image_url)} alt={imageAlt(post, fa)} loading="lazy" referrerPolicy="no-referrer" />
    {!compact && post.cover_image_credit && <figcaption>
      <ImageIcon size={11} />
      {post.cover_image_source_url
        ? <a href={post.cover_image_source_url} target="_blank" rel="noreferrer">{post.cover_image_credit}</a>
        : <span>{post.cover_image_credit}</span>}
    </figcaption>}
  </figure>;
}

export function Newsroom() {
  const { runtime } = useHorseDbAdapter();
  const { language, date } = usePreferences();
  const fa = language === 'fa';
  const canManage = Boolean(runtime.user && hasPlatformPermission(runtime.permissions, 'content.manage'));
  const demoLoginAvailable = Boolean(runtime.platformMeta?.demoAdminLoginAvailable);
  const [kind, setKind] = useState<ContentPostKind | ''>('');
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<ContentPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  // R107 NEXT-05: the admin feed, the open editor record and its draft are
  // PRINCIPAL-SCOPED — a scope change (account switch, logout, permission
  // revocation) masks them during render and clears them by effect.
  const principalScope = usePrincipalScope(runtime.user, runtime.permissions);
  const [adminPosts, setAdminPosts] = useScopedState<ContentPost[]>(principalScope, []);
  const [editing, setEditing] = useScopedState<ContentPost | null>(principalScope, null);
  const [draft, setDraft] = useScopedState<ContentPostInput>(principalScope, emptyDraft);
  const [model, setModel] = useState<AiContentModel>('gemini-2.5-flash');
  const [grounding, setGrounding] = useState(true);
  const [aiKind, setAiKind] = useState<ContentPostKind>('news');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState<'generate' | 'publish' | 'save' | 'login' | ''>('');
  // R117-17: the governed workflow state — editor-only preview, explicit
  // publish/retract, and the per-post version history.
  const [previewPost, setPreviewPost] = useState<ContentPost | null>(null);
  const [revisions, setRevisions] = useState<ContentPostRevision[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<'preview' | 'publish' | 'retract' | 'history' | ''>('');

  // R117-17: an open draft preview carries an explicit noindex robots rule.
  useEffect(() => {
    if (!previewPost) return;
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'robots');
    meta.setAttribute('content', 'noindex, nofollow');
    meta.dataset.r117Preview = 'true';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, [previewPost]);

  const L = (en: string, faText: string) => fa ? faText : en;
  const refreshPublic = async () => {
    setLoading(true);
    try {
      const result = await runtime.platform.content.list({ kind: kind || undefined, limit: 30 });
      setPosts(result.posts); setTotal(result.total);
      if (selected) { const next = result.posts.find(p => p.id === selected.id); if (next) setSelected(next); }
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  };
  const refreshAdmin = async () => {
    if (!canManage) { setAdminPosts([]); return; }
    try { const result = await runtime.platform.admin.content.list({ limit: 100 }); setAdminPosts(result.posts); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => { refreshPublic(); }, [kind]);
  useEffect(() => { refreshAdmin(); }, [canManage, principalScope]);

  const featured = selected ?? posts[0] ?? null;
  const publishedCount = posts.length;
  const latestDate = useMemo(() => posts.find(p => p.published_at)?.published_at ?? null, [posts]);

  const loadEditor = (post: ContentPost) => {
    setEditing(post);
    setDraft({
      kind: post.kind, status: post.status,
      title_en: post.title_en, title_fa: post.title_fa, summary_en: post.summary_en, summary_fa: post.summary_fa,
      body_en: post.body_en, body_fa: post.body_fa, tags: [...post.tags], sources: [...post.sources],
      cover_image_url: post.cover_image_url ?? null, cover_image_alt_en: post.cover_image_alt_en ?? null,
      cover_image_alt_fa: post.cover_image_alt_fa ?? null, cover_image_credit: post.cover_image_credit ?? null,
      cover_image_source_url: post.cover_image_source_url ?? null,
      ai_model: post.ai_model ?? null, ai_grounding: post.ai_grounding, ai_prompt: post.ai_prompt ?? null,
    });
    window.setTimeout(() => document.getElementById('newsroom-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const resetEditor = () => { setEditing(null); setDraft(emptyDraft()); setMessage(''); };
  const demoLogin = async () => {
    setBusy('login'); setMessage('');
    try {
      const session = await runtime.platform.auth.demoAdmin();
      setMessage(L(`Demo administrator signed in${session.user ? ` as ${session.user.display_name}` : ''}.`, 'ورود مدیر دمو با موفقیت انجام شد.'));
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(''); }
  };
  // R37 hands-free rule: a guest's first privileged action signs in the demo
  // administrator transparently and then proceeds — same as the Heritage studio.
  const ensureManageSession = async (): Promise<boolean> => {
    if (Boolean(runtime.user && hasPlatformPermission(runtime.permissions, 'content.manage'))) return true;
    if (!demoLoginAvailable) return false;
    try { await runtime.platform.auth.demoAdmin(); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return false; }
  };
  const runAi = async () => {
    setBusy('generate'); setMessage('');
    try {
      if (!(await ensureManageSession())) return;
      const result = await runtime.platform.admin.content.generate({ model, grounding, kind: aiKind, topic: topic.trim() || undefined });
      setDraft(result.draft); setEditing(null);
      setMessage(L('Bilingual AI draft generated. Review it below, then save and publish when ready.', 'پیش‌نویس دو زبانه ساخته شد. آن را پایین بررسی، ذخیره و سپس در صورت آمادگی منتشر کنید.'));
      window.setTimeout(() => document.getElementById('newsroom-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(''); }
  };

  const save = async () => {
    setBusy('save'); setMessage('');
    try {
      if (!(await ensureManageSession())) return;
      const result = editing ? await runtime.platform.admin.content.update(editing.id, editing.row_version, draft) : await runtime.platform.admin.content.create(draft);
      setEditing(result.post); setDraft({ ...draft, status: result.post.status }); setMessage(L('Post saved.', 'مطلب ذخیره شد.'));
      await Promise.all([refreshPublic(), refreshAdmin()]); if (result.post.status === 'published') setSelected(result.post);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(''); }
  };

  // R117-17: the governed editorial workflow — preview (editor-only, noindex),
  // explicit publish, retract, and the immutable version history.
  const draftLanguages = { en: languageStatusOf(draft.title_en, draft.body_en), fa: languageStatusOf(draft.title_fa, draft.body_fa), ar: languageStatusOf(draft.title_ar ?? "", draft.body_ar ?? ""), zh: languageStatusOf(draft.title_zh ?? "", draft.body_zh ?? "") };
  const draftMediaRights = mediaRightsOf(draft.cover_image_url, draft.cover_image_credit, draft.cover_image_source_url);
  const openPreview = async () => {
    setMessage('');
    if (!editing) {
      setPreviewPost({
        id: 'unsaved', slug: 'unsaved', kind: draft.kind, status: draft.status,
        title_en: draft.title_en, title_fa: draft.title_fa, title_ar: draft.title_ar ?? "", title_zh: draft.title_zh ?? "", summary_en: draft.summary_en, summary_fa: draft.summary_fa, summary_ar: draft.summary_ar ?? "", summary_zh: draft.summary_zh ?? "",
        body_en: draft.body_en, body_fa: draft.body_fa, body_ar: draft.body_ar ?? "", body_zh: draft.body_zh ?? "", tags: draft.tags, sources: draft.sources,
        cover_image_url: draft.cover_image_url ?? null, cover_image_alt_en: draft.cover_image_alt_en ?? null, cover_image_alt_fa: draft.cover_image_alt_fa ?? null,
        cover_image_credit: draft.cover_image_credit ?? null, cover_image_source_url: draft.cover_image_source_url ?? null,
        author_user_id: runtime.user?.id ?? null, author_label: runtime.user?.display_name ?? null,
        ai_model: draft.ai_model ?? null, ai_grounding: Boolean(draft.ai_grounding), ai_prompt: draft.ai_prompt ?? null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), published_at: null, row_version: 1,
        language_completeness: draftLanguages, media_publication_rights: draftMediaRights,
      });
      return;
    }
    setBusyAction('preview');
    try {
      if (!(await ensureManageSession())) return;
      const result = await runtime.platform.admin.content.preview(editing.id);
      setPreviewPost(result.post);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusyAction(''); }
  };
  const doPublish = async () => {
    if (!editing) return;
    setBusyAction('publish'); setMessage('');
    try {
      if (!(await ensureManageSession())) return;
      const result = await runtime.platform.admin.content.publish(editing.id, editing.row_version);
      setEditing(result.post); setDraft({ ...draft, status: result.post.status });
      setMessage(L(`Published. Persian edition: ${languageLabel(result.post.language_completeness.fa, fa)}.`, `منتشر شد. نسخه فارسی: ${languageLabel(result.post.language_completeness.fa, fa)}.`));
      await Promise.all([refreshPublic(), refreshAdmin()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusyAction(''); }
  };
  const doRetract = async () => {
    if (!editing) return;
    setBusyAction('retract'); setMessage('');
    try {
      if (!(await ensureManageSession())) return;
      const result = await runtime.platform.admin.content.retract(editing.id, editing.row_version);
      setEditing(result.post); setDraft({ ...draft, status: result.post.status });
      setMessage(L('Retracted. The public newsroom no longer serves this post; the retraction stays visible after reload.', 'بازپس‌گیری شد. اتاق خبر عمومی دیگر این مطلب را نمایش نمی‌دهد و بازپس‌گیری پس از بارگذاری مجدد باقی می‌ماند.'));
      await Promise.all([refreshPublic(), refreshAdmin()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusyAction(''); }
  };
  const loadHistory = async () => {
    if (!editing) return;
    if (historyOpen) { setHistoryOpen(false); return; }
    setBusyAction('history'); setMessage('');
    try {
      if (!(await ensureManageSession())) return;
      const result = await runtime.platform.admin.content.revisions(editing.id);
      setRevisions(result.revisions);
      setHistoryOpen(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusyAction(''); }
  };

  return <div className="newsroom-page">
    <div className="page-heading newsroom-heading">
      <div><span className="eyebrow">HORSE DB · EDITORIAL DESK</span><h1>{L('News, articles & updates.', 'خبرها، مقاله‌ها و به‌روزرسانی‌ها.')}</h1><p>{L('One bilingual publishing desk for registry news, educational articles, and product updates.', 'یک میز انتشار دو زبانه برای خبرهای سامانه ثبت، مقاله‌های آموزشی و به‌روزرسانی‌های سامانه.')}</p></div>
      <div className="newsroom-stats"><span><strong>{total}</strong>{L('published', 'منتشرشده')}</span><span><strong>{publishedCount}</strong>{L('shown', 'نمایش')}</span>{latestDate && <span><strong>{date(new Date(latestDate), { day: 'numeric', month: 'short' })}</strong>{L('latest', 'تازه‌ترین')}</span>}</div>
    </div>

    <nav className="newsroom-kind-tabs" aria-label={L('Content types', 'نوع محتوا')}>{(['', ...KINDS] as const).map(value => <button key={value || 'all'} className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>{value ? kindLabel(value, fa) : L('All', 'همه')}</button>)}</nav>

    {!canManage && demoLoginAvailable && <section className="newsroom-demo-login">
      <div><Bot size={20} /><span><strong>{L('Demo the editorial desk as an administrator', 'دموی میز تحریریه با دسترسی مدیر')}</strong><small>{L('Local/demo shortcut only. Production keeps normal authentication unless explicitly enabled.', 'میان‌بُر مخصوص محیط محلی/دمو است؛ در محیط عملیاتی ورود عادی حفظ می‌شود مگر اینکه صریحاً فعال شود.')}</small></span></div>
      <Button variant="primary" disabled={Boolean(busy)} onClick={demoLogin}><LogIn size={15} />{busy === 'login' ? L('Signing in…', 'در حال ورود…') : L('Demo Admin Login', 'ورود مدیر دمو')}</Button>
    </section>}

    {loading ? <div className="newsroom-empty"><RefreshCw className="spin" size={18} />{L('Loading published posts…', 'در حال بارگذاری مطالب…')}</div> : posts.length === 0 ? <div className="newsroom-empty"><Newspaper size={30} /><strong>{L('Nothing published here yet.', 'هنوز مطلبی منتشر نشده است.')}</strong><span>{L('An administrator can publish manually or use the AI desk below.', 'مدیر می‌تواند دستی منتشر کند یا از میز هوش مصنوعی پایین استفاده کند.')}</span></div> : <div className="newsroom-layout">
      <section className="newsroom-feed">{posts.map(post => <article key={post.id} className={`newsroom-card ${featured?.id === post.id ? 'selected' : ''}`}><button onClick={() => setSelected(post)}><CoverImage post={post} fa={fa} compact /><div className="newsroom-card-body"><div className="newsroom-card-meta"><span className={`newsroom-kind kind-${post.kind}`}>{kindLabel(post.kind, fa)}</span><time>{post.published_at ? date(new Date(post.published_at), { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</time>{post.ai_model && <span className="newsroom-ai"><Sparkles size={11} />{post.ai_model}</span>}</div><h2 dir="auto">{text(post, fa, 'title')}</h2><p dir="auto">{text(post, fa, 'summary')}</p><div className="newsroom-tags">{post.tags.slice(0, 4).map(tag => <span key={tag}>{tag}</span>)}</div></div></button></article>)}</section>
      {featured && <article className="newsroom-reader"><CoverImage post={featured} fa={fa} /><header><div><span className={`newsroom-kind kind-${featured.kind}`}>{kindLabel(featured.kind, fa)}</span>{featured.ai_grounding && <span className="newsroom-grounded"><Globe2 size={12} />{L('Google grounded', 'با جست‌وجوی گوگل')}</span>}</div><h2 dir="auto">{text(featured, fa, 'title')}</h2><p dir="auto">{text(featured, fa, 'summary')}</p><small>{featured.author_label || L('Horse DB editorial desk', 'میز تحریریه Horse DB')}</small></header>{/* R117-17: the fallback to the other language is labeled honestly. */}{featured.language_completeness[language === 'fa' ? 'fa' : 'en'] !== 'complete' && <p className="newsroom-fallback-note" data-surface="editorial-fallback-note" dir="auto">{retroText(language, 'The English edition of this post is not complete yet — the Persian original is shown below.', 'ترجمه فارسی این مطلب هنوز کامل نشده است — در ادامه نسخه اصلی انگلیسی نمایش داده می‌شود.')}</p>}<SimpleMarkdown value={text(featured, fa, 'body')} />{featured.sources.length > 0 && <footer className="newsroom-sources"><strong>{L('Sources', 'منابع')}</strong>{featured.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer"><ExternalLink size={12} /><span>{source.title}</span></a>)}</footer>}</article>}
    </div>}

    {(canManage || demoLoginAvailable) && <section className="newsroom-admin">
      <div className="newsroom-admin-title"><Bot size={22} /><div><span className="eyebrow">AI EDITORIAL AGENT</span><h2>{L('Create a bilingual post with Gemini', 'ساخت مطلب دو زبانه با Gemini')}</h2><p>{L('One request produces matched English + Persian fields that Horse DB validates before saving.', 'یک درخواست، فیلدهای هماهنگ انگلیسی و فارسی می‌سازد و Horse DB پیش از ذخیره آن‌ها را اعتبارسنجی می‌کند.')}</p></div></div>
      <div className="newsroom-ai-grid"><Field label={L('Model', 'مدل')}><select value={model} onChange={event => { const next=event.target.value as AiContentModel; setModel(next); if(next==='deepseek-flash') setGrounding(false); }}>{MODELS.map(item => <option value={item.value} key={item.value}>{item.label} — {item.note}</option>)}</select></Field><Field label={L('Post type', 'نوع مطلب')}><select value={aiKind} onChange={event => setAiKind(event.target.value as ContentPostKind)}>{KINDS.map(value => <option value={value} key={value}>{kindLabel(value, fa)}</option>)}</select></Field><label className="newsroom-ground-toggle"><input type="checkbox" checked={grounding} disabled={model==='deepseek-flash'} onChange={event => setGrounding(event.target.checked)} /><span><Globe2 size={16} /><strong>{L('Google Grounding', 'اتصال به جست‌وجوی گوگل')}</strong><small>{L('Use current web sources and keep source links with the post.', 'استفاده از منابع وب روز و ذخیره لینک منابع همراه مطلب.')}</small></span></label><Field label={L('Topic / instruction (optional)', 'موضوع / دستور (اختیاری)')}><textarea rows={3} value={topic} onChange={event => setTopic(event.target.value)} placeholder={L('Leave empty for Gemini to choose a useful registry-related topic…', 'خالی بگذارید تا Gemini یک موضوع مفید مرتبط با سامانه ثبت انتخاب کند…')} /></Field></div>
      <div className="newsroom-ai-actions"><Button disabled={Boolean(busy)} onClick={() => runAi()}><Sparkles size={15} />{busy === 'generate' ? L('Generating…', 'در حال ساخت…') : L('Generate draft', 'ساخت پیش‌نویس')}</Button></div>

      <div id="newsroom-editor" className="newsroom-editor">
        <div className="newsroom-editor-head"><div><FilePenLine size={18} /><strong>{editing ? L('Edit post', 'ویرایش مطلب') : L('New post', 'مطلب جدید')}</strong>{editing && <span>{statusLabel(editing.status, fa)} · v{editing.row_version}</span>}</div><Button small onClick={resetEditor}>{L('Clear', 'پاک کردن')}</Button></div>
        <div className="newsroom-editor-grid">
          <Field label="English title"><input dir="ltr" value={draft.title_en} onChange={e => setDraft(v => ({ ...v, title_en: e.target.value }))} /></Field><Field label="عنوان فارسی"><input dir="rtl" value={draft.title_fa} onChange={e => setDraft(v => ({ ...v, title_fa: e.target.value }))} /></Field>
          <Field label="English summary"><textarea dir="ltr" rows={3} value={draft.summary_en} onChange={e => setDraft(v => ({ ...v, summary_en: e.target.value }))} /></Field><Field label="خلاصه فارسی"><textarea dir="rtl" rows={3} value={draft.summary_fa} onChange={e => setDraft(v => ({ ...v, summary_fa: e.target.value }))} /></Field>
          <Field label="English body"><textarea dir="ltr" rows={12} value={draft.body_en} onChange={e => setDraft(v => ({ ...v, body_en: e.target.value }))} /></Field><Field label="متن فارسی"><textarea dir="rtl" rows={12} value={draft.body_fa} onChange={e => setDraft(v => ({ ...v, body_fa: e.target.value }))} /></Field>
          <Field label={L('Cover image URL', 'نشانی تصویر شاخص')}><input dir="ltr" value={draft.cover_image_url ?? ''} onChange={e => setDraft(v => ({ ...v, cover_image_url: e.target.value || null }))} placeholder="https://…" /></Field><Field label={L('Image source / credit page', 'صفحه منبع / اعتبار تصویر')}><input dir="ltr" value={draft.cover_image_source_url ?? ''} onChange={e => setDraft(v => ({ ...v, cover_image_source_url: e.target.value || null }))} placeholder="https://commons.wikimedia.org/…" /></Field>
          <Field label="Image alt text (English)"><input dir="ltr" value={draft.cover_image_alt_en ?? ''} onChange={e => setDraft(v => ({ ...v, cover_image_alt_en: e.target.value || null }))} /></Field><Field label="متن جایگزین تصویر (فارسی)"><input dir="rtl" value={draft.cover_image_alt_fa ?? ''} onChange={e => setDraft(v => ({ ...v, cover_image_alt_fa: e.target.value || null }))} /></Field>
          <Field label={L('Image credit / license', 'اعتبار / مجوز تصویر')}><input value={draft.cover_image_credit ?? ''} onChange={e => setDraft(v => ({ ...v, cover_image_credit: e.target.value || null }))} placeholder="Photographer · License · Source" /></Field>
          <Field label={L('Type', 'نوع')}><select value={draft.kind} onChange={e => setDraft(v => ({ ...v, kind: e.target.value as ContentPostKind }))}>{KINDS.map(value => <option value={value} key={value}>{kindLabel(value, fa)}</option>)}</select></Field>
          <Field label={L('Status', 'وضعیت')}><select value={draft.status} onChange={e => setDraft(v => ({ ...v, status: e.target.value as ContentPostStatus }))}><option value="draft">{statusLabel('draft', fa)}</option><option value="published">{statusLabel('published', fa)}</option><option value="archived">{statusLabel('archived', fa)}</option></select></Field>
          <Field label={L('Tags (comma separated)', 'برچسب‌ها (با ویرگول)')}><input value={draft.tags.join(', ')} onChange={e => setDraft(v => ({ ...v, tags: e.target.value.split(',').map(x => x.trim()).filter(Boolean).slice(0, 12) }))} /></Field>
          <div className="newsroom-editor-provenance"><strong>{L('AI provenance', 'منشأ هوش مصنوعی')}</strong><span>{draft.ai_model || L('Manual post', 'مطلب دستی')}</span>{draft.ai_grounding && <span><Globe2 size={12} />{L('Grounded', 'دارای منبع وب')}</span>}<small>{draft.sources.length} {L('source links', 'لینک منبع')}</small></div>
        </div>
        {draft.cover_image_url && <div className="newsroom-editor-image-preview"><img src={resolveExternalImage(draft.cover_image_url)} alt={draft.cover_image_alt_en || draft.title_en || 'Cover preview'} referrerPolicy="no-referrer" /><span>{draft.cover_image_credit || L('Cover preview', 'پیش‌نمایش تصویر شاخص')}</span></div>}
        {/* R117-17: language completeness and media-publication rights as two
            separate live indicators. */}
        <div className="newsroom-readiness" data-surface="editorial-readiness"><span className={`readiness-lang is-${draftLanguages.en}`}>EN · {languageLabel(draftLanguages.en, fa)}</span><span className={`readiness-lang is-${draftLanguages.fa}`}>FA · {languageLabel(draftLanguages.fa, fa)}</span><span className={`readiness-media is-${draftMediaRights}`}>{mediaRightsLabel(draftMediaRights, fa)}</span></div>
        <div className="newsroom-editor-actions"><Button variant="primary" disabled={Boolean(busy) || !draft.title_en.trim() || !draft.body_en.trim()} onClick={save}><Save size={15} />{busy === 'save' ? L('Saving…', 'در حال ذخیره…') : editing ? L('Save changes', 'ذخیره تغییرات') : L('Save post', 'ذخیره مطلب')}</Button>{draft.status === 'published' && <span className="newsroom-publish-ready"><Check size={14} />{L('Visible in the public newsroom after save', 'پس از ذخیره در اتاق خبر عمومی دیده می‌شود')}</span>}</div>
        {/* R117-17: the governed workflow actions. */}
        <div className="newsroom-workflow" data-surface="editorial-workflow"><Button disabled={Boolean(busyAction) || !draft.title_en.trim() || !draft.body_en.trim()} onClick={() => void openPreview()}><Eye size={15} />{busyAction === 'preview' ? L('Opening…', 'در حال بازگشایی…') : L('Preview', 'پیش‌نمایش')}</Button>{editing && editing.status !== 'published' && <Button variant="primary" disabled={Boolean(busyAction) || editing.language_completeness.en !== 'complete'} onClick={() => void doPublish()}><Send size={15} />{busyAction === 'publish' ? L('Publishing…', 'در حال انتشار…') : L('Publish', 'انتشار')}</Button>}{editing && editing.status === 'published' && <Button disabled={Boolean(busyAction)} onClick={() => void doRetract()}><Undo2 size={15} />{busyAction === 'retract' ? L('Retracting…', 'در حال بازپس‌گیری…') : L('Retract', 'بازپس‌گیری')}</Button>}{editing && <Button disabled={Boolean(busyAction)} onClick={() => void loadHistory()}><History size={15} />{busyAction === 'history' ? L('Loading…', 'در حال بارگذاری…') : historyOpen ? L('Hide history', 'پنهان کردن تاریخچه') : L('Version history', 'تاریخچه نسخه‌ها')}</Button>}</div>
        {editing && historyOpen && <div className="newsroom-history" data-surface="editorial-history"><strong>{L('Version history', 'تاریخچه نسخه‌ها')} · v{editing.row_version}</strong>{revisions.length === 0 ? <p>{L('No recorded revisions.', 'نسخه‌ای ثبت نشده است.')}</p> : <ol className="newsroom-history-list">{revisions.map(revision => <li key={revision.id} className={`history-cause-${revision.cause}`}><span className="history-cause">{causeLabel(revision.cause, fa)}</span><span className="history-transition">{statusLabel(revision.from_status, fa)} → {statusLabel(revision.to_status, fa)} · v{revision.revision_no}</span><small>{revision.actor_label || revision.actor_user_id || '—'}</small></li>)}</ol>}</div>}
      </div>

      <div className="newsroom-admin-list"><div className="newsroom-editor-head"><strong>{L('Editorial queue', 'صف تحریریه')}</strong><Button small onClick={refreshAdmin}><RefreshCw size={13} />{L('Refresh', 'تازه‌سازی')}</Button></div>{adminPosts.length === 0 ? <p>{L('No saved posts yet.', 'هنوز مطلب ذخیره‌شده‌ای نیست.')}</p> : <div className="table-scroll"><table className="horse-table"><thead><tr><th>{L('Type', 'نوع')}</th><th>{L('Title', 'عنوان')}</th><th>{L('Status', 'وضعیت')}</th><th>{L('Origin', 'منشأ')}</th><th /></tr></thead><tbody>{adminPosts.map(post => <tr key={post.id}><td>{kindLabel(post.kind, fa)}</td><td dir="auto">{text(post, fa, 'title')}</td><td>{statusLabel(post.status, fa)}</td><td>{post.ai_model ? <><Sparkles size={11} /> {post.ai_model}</> : L('Manual', 'دستی')}</td><td><Button small onClick={() => loadEditor(post)}>{L('Edit', 'ویرایش')}</Button></td></tr>)}</tbody></table></div>}</div>
      {message && <div className="newsroom-message">{message}</div>}
    </section>}
    {/* R117-17: the editor-only preview overlay — noindex while open. */}
    {previewPost && <div className="newsroom-preview-overlay" data-surface="editorial-preview" role="dialog" aria-modal="true"><div className="newsroom-preview-banner"><strong>{previewPost.status === 'published' ? L('PREVIEW — published edition', 'پیش‌نمایش — نسخه منتشرشده') : L('PREVIEW — unpublished; not on the public newsroom', 'پیش‌نمایش — منتشرنشده؛ در اتاق خبر عمومی نیست')}</strong><span>EN {languageLabel(previewPost.language_completeness.en, fa)} · FA {languageLabel(previewPost.language_completeness.fa, fa)} · {mediaRightsLabel(previewPost.media_publication_rights, fa)}</span><Button small onClick={() => setPreviewPost(null)}>{L('Close preview', 'بستن پیش‌نمایش')}</Button></div><article className="newsroom-preview-reader"><CoverImage post={previewPost} fa={fa} /><header><div><span className={`newsroom-kind kind-${previewPost.kind}`}>{kindLabel(previewPost.kind, fa)}</span></div><h2 dir="auto">{text(previewPost, fa, 'title')}</h2><p dir="auto">{text(previewPost, fa, 'summary')}</p><small>{previewPost.author_label || L('Horse DB editorial desk', 'میز تحریریه Horse DB')}</small></header><SimpleMarkdown value={text(previewPost, fa, 'body')} />{previewPost.sources.length > 0 && <footer className="newsroom-sources"><strong>{L('Sources', 'منابع')}</strong>{previewPost.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer"><ExternalLink size={12} /><span>{source.title}</span></a>)}</footer>}</article></div>}
    {!canManage && message && <div className="newsroom-message">{message}</div>}
  </div>;
}
