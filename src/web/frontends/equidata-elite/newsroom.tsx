import React, { useEffect, useMemo, useState } from "react";
import type { ContentPost, ContentPostInput, ContentPostKind, ContentPostRevision, ContentPostStatus, ContentLanguageStatus, ContentMediaRights, AiContentModel } from "../../../frontend-kit";
import { hasPlatformPermission, usePrincipalScope, useScopedState } from "../../../frontend-kit";
import { resolveExternalImage } from "../../../frontend-kit";
import type { EquiDataRuntime } from "./adapter";
import { Eyebrow, Icon, Panel, SectionTitle } from "./components";
import { edxText } from "./i18n";
import { num } from "./format";

/**
 * R37 parity: the public newsroom reader + full Editorial Studio for
 * EquiData Elite. Mirrors the Heritage workflow (feed → reader; generate →
 * review → save/publish) inside the equidata visual language. Guests can use
 * the studio: the first privileged action transparently signs in the one-click
 * demo administrator and then proceeds — the same hands-free rule as Heritage.
 */

const MODELS: Array<{ value: AiContentModel; label: string }> = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
  { value: "deepseek-flash", label: "DeepSeek V4.1 Flash" },
  { value: "offline-test", label: "Offline sandbox draft (no API — test mode)" },
];
const KINDS: ContentPostKind[] = ["article", "news", "update"];

function emptyDraft(): ContentPostInput {
  return {
    kind: "article", status: "draft",
    title_en: "", title_fa: "", summary_en: "", summary_fa: "", body_en: "", body_fa: "",
    tags: [], sources: [],
    cover_image_url: null, cover_image_alt_en: null, cover_image_alt_fa: null,
    cover_image_credit: null, cover_image_source_url: null,
    ai_model: null, ai_grounding: false, ai_prompt: null,
  };
}
function text(post: ContentPost, fa: boolean, key: "title" | "summary" | "body") {
  const primary = key === "title" ? (fa ? post.title_fa : post.title_en) : key === "summary" ? (fa ? post.summary_fa : post.summary_en) : (fa ? post.body_fa : post.body_en);
  const fallback = key === "title" ? (fa ? post.title_en : post.title_fa) : key === "summary" ? (fa ? post.summary_en : post.summary_fa) : (fa ? post.body_en : post.body_fa);
  return primary || fallback;
}
function kindLabel(kind: ContentPostKind, fa: boolean) {
  return fa ? ({ article: "مقاله / وبلاگ", news: "خبر", update: "به‌روزرسانی" }[kind]) : ({ article: "Article / Blog", news: "News", update: "Update" }[kind]);
}
function statusLabel(status: ContentPostStatus, fa: boolean) {
  return fa ? ({ draft: "پیش‌نویس", published: "منتشرشده", archived: "بایگانی" }[status]) : ({ draft: "Draft", published: "Published", archived: "Archived" }[status]);
}
/** R117-17: per-language readiness (EN and FA separately) and media-publication
 * rights — two independent live indicators, never conflated with publication
 * status. A missing Persian edition is named as missing. */
function languageStatusOf(title: string, body: string): ContentLanguageStatus {
  const hasTitle = Boolean(title.trim());
  const hasBody = Boolean(body.trim());
  if (hasTitle && hasBody) return "complete";
  if (hasTitle || hasBody) return "partial";
  return "missing";
}
function languageLabel(status: ContentLanguageStatus, fa: boolean) {
  return fa ? ({ complete: "کامل", partial: "ناقص", missing: "وجود ندارد" }[status]) : ({ complete: "complete", partial: "partial", missing: "missing" }[status]);
}
function mediaRightsOf(url: string | null | undefined, credit: string | null | undefined, source: string | null | undefined): ContentMediaRights {
  if (!url || !url.trim()) return "no_media";
  return (credit && credit.trim()) || (source && source.trim()) ? "attributed" : "unattributed";
}
function mediaRightsLabel(rights: ContentMediaRights, fa: boolean) {
  return fa
    ? ({ no_media: "بدون تصویر", attributed: "تصویر دارای اعتبار", unattributed: "تصویر بدون اعتبار" }[rights])
    : ({ no_media: "No cover media", attributed: "Media attributed", unattributed: "Media unattributed" }[rights]);
}
function causeLabel(cause: ContentPostRevision["cause"], fa: boolean) {
  return fa
    ? ({ create: "ایجاد", update: "ویرایش", publish: "انتشار", retract: "بازپس‌گیری" }[cause])
    : ({ create: "Created", update: "Edited", publish: "Published", retract: "Retracted" }[cause]);
}
function linkify(message: string): React.ReactNode[] {
  return message.split(/(https?:\/\/[^\s,)]+)/g).map((part, index) =>
    /^https?:\/\//.test(part) ? <a key={index} href={part} target="_blank" rel="noreferrer noopener">{part}</a> : <React.Fragment key={index}>{part}</React.Fragment>,
  );
}

function SimpleMarkdown({ value }: { value: string }) {
  const blocks = value.split(/\n{2,}/).map(v => v.trim()).filter(Boolean);
  return <div className="edx-newsroom-markdown">{blocks.map((block, index) => {
    if (block.startsWith("### ")) return <h4 key={index}>{block.slice(4)}</h4>;
    if (block.startsWith("## ")) return <h3 key={index}>{block.slice(3)}</h3>;
    if (block.startsWith("# ")) return <h2 key={index}>{block.slice(2)}</h2>;
    const lines = block.split("\n");
    if (lines.every(line => /^[-*] /.test(line))) return <ul key={index}>{lines.map((line, i) => <li key={i}>{line.replace(/^[-*] /, "")}</li>)}</ul>;
    return <p key={index}>{lines.map((line, i) => <span key={i}>{line}{i < lines.length - 1 && <br />}</span>)}</p>;
  })}</div>;
}

export function NewsroomPage({ view }: { view: EquiDataRuntime }) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  const fa = view.locale === "fa";
  const canManage = Boolean(view.user && hasPlatformPermission(view.permissions, "content.manage"));
  const guestDemoAvailable = Boolean(!view.user && view.platformMeta?.demoAdminLoginAvailable);

  const [kind, setKind] = useState<ContentPostKind | "">("");
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<ContentPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"info" | "error">("info");
  // R107 NEXT-05: the admin feed, the open editor record and its draft are
  // PRINCIPAL-SCOPED — a scope change (account switch, logout, permission
  // revocation) masks them during render and clears them by effect, so the
  // previous manager's queue can never render under the next one.
  const principalScope = usePrincipalScope(view.user, view.permissions);
  const [adminPosts, setAdminPosts] = useScopedState<ContentPost[]>(principalScope, []);
  const [editing, setEditing] = useScopedState<ContentPost | null>(principalScope, null);
  const [draft, setDraft] = useScopedState<ContentPostInput>(principalScope, emptyDraft);
  const [model, setModel] = useState<AiContentModel>("gemini-2.5-flash");
  const [grounding, setGrounding] = useState(true);
  const [aiKind, setAiKind] = useState<ContentPostKind>("news");
  const [topic, setTopic] = useState("");
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [aiAttempts, setAiAttempts] = useState<string[]>([]);
  const [busy, setBusy] = useState<"generate" | "save" | "">("");
  // R117-17: the governed workflow state — editor-only preview, explicit
  // publish/retract, and the per-post version history.
  const [previewPost, setPreviewPost] = useState<ContentPost | null>(null);
  const [revisions, setRevisions] = useState<ContentPostRevision[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<"preview" | "publish" | "retract" | "history" | "">("");

  // R117-17: an open draft preview carries an explicit noindex robots rule.
  useEffect(() => {
    if (!previewPost) return;
    const meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", "noindex, nofollow");
    meta.dataset.r117Preview = "true";
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, [previewPost]);

  const ensureManageSession = async (): Promise<boolean> => {
    if (Boolean(view.user && hasPlatformPermission(view.permissions, "content.manage"))) return true;
    if (!guestDemoAvailable) return false;
    try {
      await view.platform.auth.demoAdmin();
      return true;
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const refreshPublic = async () => {
    setLoading(true);
    try {
      const result = await view.platform.content.list({ kind: kind || undefined, limit: 30 });
      setPosts(result.posts); setTotal(result.total);
      if (selected) { const next = result.posts.find(p => p.id === selected.id); if (next) setSelected(next); }
    } catch (error) { setMessageKind("error"); setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  };
  const refreshAdmin = async () => {
    if (!canManage) { setAdminPosts([]); return; }
    try { const result = await view.platform.admin.content.list({ limit: 100 }); setAdminPosts(result.posts); }
    catch { /* the public feed remains authoritative for guests */ }
  };
  useEffect(() => { void refreshPublic(); }, [kind]);
  useEffect(() => { void refreshAdmin(); }, [canManage, principalScope]);

  const featured = selected ?? posts[0] ?? null;
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
    requestAnimationFrame(() => document.getElementById("edx-news-editor")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
  };

  const runAi = async () => {
    setBusy("generate"); setMessage(""); setAiWarnings([]); setAiAttempts([]);
    try {
      if (!(await ensureManageSession())) return;
      const result = await view.platform.admin.content.generate({ model, grounding, kind: aiKind, topic: topic.trim() || undefined });
      setDraft(result.draft); setEditing(null);
      setAiWarnings(result.warnings ?? []); setAiAttempts(result.attempts ?? []);
      setMessageKind("info");
      setMessage(L("AI draft generated. Review it below, then save and publish when ready.", "پیش‌نویس هوش مصنوعی ساخته شد. آن را پایین بررسی، ذخیره و در صورت آمادگی منتشر کنید."));
      requestAnimationFrame(() => document.getElementById("edx-news-editor")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(""); }
  };

  const save = async () => {
    setBusy("save"); setMessage("");
    try {
      if (!(await ensureManageSession())) return;
      const result = editing ? await view.platform.admin.content.update(editing.id, editing.row_version, draft) : await view.platform.admin.content.create(draft);
      setEditing(result.post); setDraft({ ...draft, status: result.post.status });
      setMessageKind("info");
      setMessage(L("Post saved.", "مطلب ذخیره شد."));
      await Promise.all([refreshPublic(), refreshAdmin()]);
      if (result.post.status === "published") setSelected(result.post);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(""); }
  };

  const queueCount = (status: ContentPostStatus) => adminPosts.filter(post => post.status === status).length;

  // R117-17: live readiness indicators for the editor buffer.
  const draftLanguages = { en: languageStatusOf(draft.title_en, draft.body_en), fa: languageStatusOf(draft.title_fa, draft.body_fa), ar: languageStatusOf(draft.title_ar ?? "", draft.body_ar ?? ""), zh: languageStatusOf(draft.title_zh ?? "", draft.body_zh ?? "") };
  const draftMediaRights = mediaRightsOf(draft.cover_image_url, draft.cover_image_credit, draft.cover_image_source_url);

  const openPreview = async () => {
    setMessage("");
    if (!editing) {
      setPreviewPost({
        id: "unsaved", slug: "unsaved", kind: draft.kind, status: draft.status,
        title_en: draft.title_en, title_fa: draft.title_fa, title_ar: draft.title_ar ?? "", title_zh: draft.title_zh ?? "", summary_en: draft.summary_en, summary_fa: draft.summary_fa, summary_ar: draft.summary_ar ?? "", summary_zh: draft.summary_zh ?? "",
        body_en: draft.body_en, body_fa: draft.body_fa, body_ar: draft.body_ar ?? "", body_zh: draft.body_zh ?? "", tags: draft.tags, sources: draft.sources,
        cover_image_url: draft.cover_image_url ?? null, cover_image_alt_en: draft.cover_image_alt_en ?? null, cover_image_alt_fa: draft.cover_image_alt_fa ?? null,
        cover_image_credit: draft.cover_image_credit ?? null, cover_image_source_url: draft.cover_image_source_url ?? null,
        author_user_id: view.user?.id ?? null, author_label: view.user?.display_name ?? null,
        ai_model: draft.ai_model ?? null, ai_grounding: Boolean(draft.ai_grounding), ai_prompt: draft.ai_prompt ?? null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), published_at: null, row_version: 1,
        language_completeness: draftLanguages, media_publication_rights: draftMediaRights,
      });
      return;
    }
    setBusyAction("preview");
    try {
      if (!(await ensureManageSession())) return;
      const result = await view.platform.admin.content.preview(editing.id);
      setPreviewPost(result.post);
    } catch (error) {
      setMessageKind("error"); setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusyAction(""); }
  };

  const doPublish = async () => {
    if (!editing) return;
    setBusyAction("publish"); setMessage("");
    try {
      if (!(await ensureManageSession())) return;
      const result = await view.platform.admin.content.publish(editing.id, editing.row_version);
      setEditing(result.post); setDraft({ ...draft, status: result.post.status });
      setMessageKind("info");
      setMessage(L(`Published. Persian edition: ${languageLabel(result.post.language_completeness.fa, fa)}.`, `منتشر شد. نسخه فارسی: ${languageLabel(result.post.language_completeness.fa, fa)}.`));
      await Promise.all([refreshPublic(), refreshAdmin()]);
    } catch (error) {
      setMessageKind("error"); setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusyAction(""); }
  };

  const doRetract = async () => {
    if (!editing) return;
    setBusyAction("retract"); setMessage("");
    try {
      if (!(await ensureManageSession())) return;
      const result = await view.platform.admin.content.retract(editing.id, editing.row_version);
      setEditing(result.post); setDraft({ ...draft, status: result.post.status });
      setMessageKind("info");
      setMessage(L("Retracted. The public newsroom no longer serves this post; the retraction stays visible after reload.", "بازپس‌گیری شد. اتاق خبر عمومی دیگر این مطلب را نمایش نمی‌دهد و بازپس‌گیری پس از بارگذاری مجدد باقی می‌ماند."));
      await Promise.all([refreshPublic(), refreshAdmin()]);
    } catch (error) {
      setMessageKind("error"); setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusyAction(""); }
  };

  const loadHistory = async () => {
    if (!editing) return;
    if (historyOpen) { setHistoryOpen(false); return; }
    setBusyAction("history"); setMessage("");
    try {
      if (!(await ensureManageSession())) return;
      const result = await view.platform.admin.content.revisions(editing.id);
      setRevisions(result.revisions);
      setHistoryOpen(true);
    } catch (error) {
      setMessageKind("error"); setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusyAction(""); }
  };

  return <main className="edx-content edx-page edx-newsroom-page">
    <SectionTitle
      eyebrow={L("EDITORIAL SIGNAL FEED", "جریان مطالب تحریریه")}
      title={fa ? "خبرها، مقاله‌ها و به‌روزرسانی‌ها." : <>News, articles <span>& updates.</span></>}
      copy={L("The bilingual editorial desk of the registry: published intelligence, community articles and product updates.", "میز تحریریه دو زبانهٔ سامانه ثبت: تحلیل‌های منتشرشده، مقاله‌های جامعه و به‌روزرسانی‌های محصول.")}
      action={<span className="edx-newsroom-count"><strong>{num(total, view.locale)}</strong><small>{L("published", "منتشرشده")}{latestDate ? ` · ${new Date(latestDate).toLocaleDateString(fa ? "fa-IR" : "en-US", { day: "numeric", month: "short" })}` : ""}</small></span>}
    />
    <nav className="edx-newsroom-tabs" aria-label={L("Content types", "نوع محتوا")}>{(["", ...KINDS] as const).map(value => <button key={value || "all"} className={kind === value ? "active" : ""} onClick={() => setKind(value)}>{value ? kindLabel(value, fa) : L("All", "همه")}</button>)}</nav>

    {message && <div className={`edx-newsroom-message ${messageKind === "error" ? "is-error" : "is-info"}`} role={messageKind === "error" ? "alert" : "status"}>{linkify(message)}</div>}
    {(aiWarnings.length > 0 || aiAttempts.length > 0) && <div className="edx-newsroom-ai-feedback">
      {aiWarnings.map((warning, index) => <p key={`w${index}`}>⚠ {warning}</p>)}
      {aiAttempts.map((attempt, index) => <p key={`a${index}`}>↻ {attempt}</p>)}
    </div>}

    {loading ? <Panel><span className="edx-newsroom-empty">{L("Loading published posts…", "در حال بارگذاری مطالب…")}</span></Panel>
      : posts.length === 0 ? <Panel><div className="edx-newsroom-empty"><strong>{L("Nothing published here yet.", "هنوز مطلبی منتشر نشده است.")}</strong><span>{L("The editorial desk below can create the first post.", "میز تحریریه پایین می‌تواند نخستین مطلب را بسازد.")}</span></div></Panel>
      : <div className="edx-newsroom-layout">
        <div className="edx-newsroom-feed">{posts.map(post => <button key={post.id} className={`edx-newsroom-card ${featured?.id === post.id ? "selected" : ""}`} onClick={() => setSelected(post)}>
          {post.cover_image_url && <span className="edx-newsroom-card-image"><img src={resolveExternalImage(post.cover_image_url)} alt="" loading="lazy" referrerPolicy="no-referrer" /></span>}
          <span className="edx-newsroom-card-body">
            <span className="edx-newsroom-card-meta"><b className={`edx-newsroom-kind kind-${post.kind}`}>{kindLabel(post.kind, fa)}</b><time>{post.published_at ? new Date(post.published_at).toLocaleDateString(fa ? "fa-IR" : "en-US", { day: "numeric", month: "short", year: "numeric" }) : ""}</time>{post.ai_model && <small>{post.ai_model}</small>}</span>
            <strong dir="auto">{text(post, fa, "title")}</strong>
            <small dir="auto">{text(post, fa, "summary")}</small>
          </span>
        </button>)}</div>
        {featured && <article className="edx-newsroom-reader" data-edx-surface="panel">
          {featured.cover_image_url && <figure><img src={resolveExternalImage(featured.cover_image_url)} alt="" referrerPolicy="no-referrer" /></figure>}
          <header>
            <Eyebrow>{kindLabel(featured.kind, fa)}{featured.ai_grounding ? ` · ${L("Google grounded", "با جست‌وجوی گوگل")}` : ""}{featured.ai_model ? ` · ${featured.ai_model}` : ""}</Eyebrow>
            <h2 dir="auto">{text(featured, fa, "title")}</h2>
            <p dir="auto">{text(featured, fa, "summary")}</p>
            <small>{featured.author_label || L("Registry editorial desk", "میز تحریریه سامانه ثبت")}</small>
          </header>
          {/* R117-17: the fallback to the other language is labeled honestly. */}
          {featured.language_completeness[fa ? "fa" : "en"] !== "complete" && <p className="edx-newsroom-fallback-note" data-surface="editorial-fallback-note" dir="auto">{fa ? "ترجمه فارسی این مطلب هنوز کامل نشده است — در ادامه نسخه اصلی انگلیسی نمایش داده می‌شود." : "The English edition of this post is not complete yet — the Persian original is shown below."}</p>}
          <SimpleMarkdown value={text(featured, fa, "body")} />
          {featured.sources.length > 0 && <footer><strong>{L("Sources", "منابع")}</strong>{featured.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</footer>}
        </article>}
      </div>}

    {(canManage || guestDemoAvailable) && <div className="edx-newsroom-studio">
      <SectionTitle
        eyebrow={L("EDITORIAL STUDIO", "استودیوی تحریریه")}
        title={L("Generate, review & publish", "تولید، بازبینی و انتشار")}
        copy={guestDemoAvailable && !canManage
          ? L("Guest demo workspace — your first action signs in the one-click demo administrator automatically.", "فضای کاری دموی مهمان — نخستین اقدام شما به‌طور خودکار با مدیر دمو ورود می‌کند.")
          : L("AI-assisted bilingual drafting, a focused manual editor, and the complete editorial queue.", "پیش‌نویس دو زبانه با هوش مصنوعی، ویرایشگر دستی و صف کامل تحریریه.")}
      />
      <div className="edx-newsroom-columns">
        <Panel className="edx-newsroom-compose">
          <Eyebrow>AI EDITORIAL AGENT</Eyebrow>
          <h3>{L("Generate a bilingual draft", "ساخت پیش‌نویس دو زبانه")}</h3>
          <div className="edx-newsroom-ai-controls">
            <label>{L("Model", "مدل")}<select value={model} onChange={event => { const next = event.target.value as AiContentModel; setModel(next); if (next === "deepseek-flash") setGrounding(false); }}>{MODELS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label>{L("Post type", "نوع مطلب")}<select value={aiKind} onChange={event => setAiKind(event.target.value as ContentPostKind)}>{KINDS.map(value => <option key={value} value={value}>{kindLabel(value, fa)}</option>)}</select></label>
            <label className="edx-newsroom-ground"><input type="checkbox" checked={grounding} disabled={model === "deepseek-flash"} onChange={event => setGrounding(event.target.checked)} /><span><strong>{L("Google Grounding", "اتصال به جست‌وجوی گوگل")}</strong><small>{L("Use current web sources and save citations with the post.", "از منابع روز وب استفاده و لینک آن‌ها را با مطلب ذخیره می‌کند.")}</small></span></label>
            <label className="edx-newsroom-topic">{L("Topic / instruction (optional)", "موضوع / دستور (اختیاری)")}<textarea rows={3} value={topic} onChange={event => setTopic(event.target.value)} placeholder={L("Leave empty and the agent chooses a useful registry topic.", "خالی بگذارید تا عامل یک موضوع مفید مرتبط با سامانه ثبت انتخاب کند.")} /></label>
          </div>
          <div className="edx-newsroom-actions"><button className="edx-button primary" disabled={Boolean(busy)} onClick={() => void runAi()}><Icon name="ai" />{busy === "generate" ? L("Generating…", "در حال ساخت…") : L("Generate draft", "ساخت پیش‌نویس")}</button></div>

          <div id="edx-news-editor" className="edx-newsroom-editor">
            <header><Eyebrow>{editing ? L("EDIT POST", "ویرایش مطلب") : L("NEW POST", "مطلب جدید")}</Eyebrow><h4>{editing ? L("Edit the selected post", "ویرایش مطلب انتخاب‌شده") : L("Write a manual post", "نوشتن مطلب دستی")}</h4></header>
            <div className="edx-newsroom-editor-grid">
              <label>English title<input dir="ltr" value={draft.title_en} onChange={e => setDraft(v => ({ ...v, title_en: e.target.value }))} /></label>
              <label>عنوان فارسی<input dir="rtl" value={draft.title_fa} onChange={e => setDraft(v => ({ ...v, title_fa: e.target.value }))} /></label>
              <label>English summary<textarea dir="ltr" rows={3} value={draft.summary_en} onChange={e => setDraft(v => ({ ...v, summary_en: e.target.value }))} /></label>
              <label>خلاصه فارسی<textarea dir="rtl" rows={3} value={draft.summary_fa} onChange={e => setDraft(v => ({ ...v, summary_fa: e.target.value }))} /></label>
              <label>English body<textarea dir="ltr" rows={12} value={draft.body_en} onChange={e => setDraft(v => ({ ...v, body_en: e.target.value }))} /></label>
              <label>متن فارسی<textarea dir="rtl" rows={12} value={draft.body_fa} onChange={e => setDraft(v => ({ ...v, body_fa: e.target.value }))} /></label>
              <label>{L("Cover image URL", "نشانی تصویر شاخص")}<input dir="ltr" value={draft.cover_image_url ?? ""} onChange={e => setDraft(v => ({ ...v, cover_image_url: e.target.value || null }))} placeholder="https://…" /></label>
              <label>{L("Image credit", "اعتبار تصویر")}<input value={draft.cover_image_credit ?? ""} onChange={e => setDraft(v => ({ ...v, cover_image_credit: e.target.value || null }))} /></label>
              <label>{L("Type", "نوع")}<select value={draft.kind} onChange={e => setDraft(v => ({ ...v, kind: e.target.value as ContentPostKind }))}>{KINDS.map(value => <option key={value} value={value}>{kindLabel(value, fa)}</option>)}</select></label>
              <label>{L("Status", "وضعیت")}<select value={draft.status} onChange={e => setDraft(v => ({ ...v, status: e.target.value as ContentPostStatus }))}><option value="draft">{statusLabel("draft", fa)}</option><option value="published">{statusLabel("published", fa)}</option><option value="archived">{statusLabel("archived", fa)}</option></select></label>
              <label className="span-2">{L("Tags (comma separated)", "برچسب‌ها (با ویرگول)")}<input value={draft.tags.join(", ")} onChange={e => setDraft(v => ({ ...v, tags: e.target.value.split(",").map(part => part.trim()).filter(Boolean).slice(0, 12) }))} /></label>
            </div>
            {/* R117-17: language completeness and media-publication rights as
                two separate live indicators. */}
            <div className="edx-newsroom-readiness" data-surface="editorial-readiness">
              <span className={`readiness-lang is-${draftLanguages.en}`}>EN · {languageLabel(draftLanguages.en, fa)}</span>
              <span className={`readiness-lang is-${draftLanguages.fa}`}>FA · {languageLabel(draftLanguages.fa, fa)}</span>
              <span className={`readiness-media is-${draftMediaRights}`}>{mediaRightsLabel(draftMediaRights, fa)}</span>
            </div>
            <div className="edx-newsroom-actions">
              <button className="edx-button primary" disabled={Boolean(busy) || !draft.title_en.trim() || !draft.body_en.trim()} onClick={() => void save()}>{busy === "save" ? L("Saving…", "در حال ذخیره…") : L("Save post", "ذخیره مطلب")}</button>
              <button className="edx-button secondary" onClick={() => { setEditing(null); setDraft(emptyDraft()); setHistoryOpen(false); }}>{L("Clear", "پاک کردن")}</button>
              <span>{draft.status === "published" ? L("This will be visible to everyone.", "این مطلب برای همه قابل مشاهده خواهد بود.") : L("Drafts are visible only to editors.", "پیش‌نویس فقط برای تحریریه دیده می‌شود.")}</span>
            </div>
            {/* R117-17: the governed workflow actions. */}
            <div className="edx-newsroom-workflow" data-surface="editorial-workflow">
              <button className="edx-button secondary" disabled={Boolean(busyAction) || !draft.title_en.trim() || !draft.body_en.trim()} onClick={() => void openPreview()}>{busyAction === "preview" ? L("Opening…", "در حال بازگشایی…") : L("Preview", "پیش‌نمایش")}</button>
              {editing && editing.status !== "published" && <button className="edx-button primary" disabled={Boolean(busyAction) || editing.language_completeness.en !== "complete"} onClick={() => void doPublish()}>{busyAction === "publish" ? L("Publishing…", "در حال انتشار…") : L("Publish", "انتشار")}</button>}
              {editing && editing.status === "published" && <button className="edx-button secondary edx-button-danger" disabled={Boolean(busyAction)} onClick={() => void doRetract()}>{busyAction === "retract" ? L("Retracting…", "در حال بازپس‌گیری…") : L("Retract", "بازپس‌گیری")}</button>}
              {editing && <button className="edx-button secondary" disabled={Boolean(busyAction)} onClick={() => void loadHistory()}>{busyAction === "history" ? L("Loading…", "در حال بارگذاری…") : historyOpen ? L("Hide history", "پنهان کردن تاریخچه") : L("Version history", "تاریخچه نسخه‌ها")}</button>}
            </div>
          </div>
        </Panel>

        <Panel className="edx-newsroom-queue">
          <header className="edx-newsroom-queue-head"><Eyebrow>EDITORIAL QUEUE</Eyebrow><h4>{L("Editorial queue", "صف تحریریه")}</h4><button className="edx-button secondary" onClick={() => void refreshAdmin()} disabled={!canManage}>{L("Refresh", "تازه‌سازی")}</button></header>
          <div className="edx-newsroom-queue-filters">
            <span className="status-draft">{num(queueCount("draft"), view.locale)} {statusLabel("draft", fa)}</span>
            <span className="status-published">{num(queueCount("published"), view.locale)} {statusLabel("published", fa)}</span>
            <span className="status-archived">{num(queueCount("archived"), view.locale)} {statusLabel("archived", fa)}</span>
          </div>
          <div className="edx-newsroom-queue-list">
            {adminPosts.length === 0 ? <p className="edx-newsroom-queue-empty">{L("No saved posts yet. Generate a draft or write one manually.", "هنوز مطلبی ذخیره نشده است. یک پیش‌نویس بسازید یا دستی بنویسید.")}</p>
              : adminPosts.map(post => <button key={post.id} className={`edx-newsroom-queue-item${editing?.id === post.id ? " selected" : ""}`} onClick={() => { loadEditor(post); setHistoryOpen(false); }}>
                <span className="queue-item-kind">{kindLabel(post.kind, fa)}</span>
                <strong dir="auto">{text(post, fa, "title")}</strong>
                <small>{post.ai_model || L("Manual", "دستی")} · EN {languageLabel(post.language_completeness.en, fa)} · FA {languageLabel(post.language_completeness.fa, fa)}</small>
                <span className={`queue-item-status status-${post.status}`}>{statusLabel(post.status, fa)}</span>
              </button>)}
          </div>
          {/* R117-17: the immutable per-post version history. */}
          {editing && historyOpen && <div className="edx-newsroom-history" data-surface="editorial-history">
            <Eyebrow>VERSION HISTORY</Eyebrow>
            <h5>{L("Version history", "تاریخچه نسخه‌ها")} · v{num(editing.row_version, view.locale)}</h5>
            {revisions.length === 0 ? <p className="edx-newsroom-queue-empty">{L("No recorded revisions.", "نسخه‌ای ثبت نشده است.")}</p>
              : <ol className="edx-newsroom-history-list">{revisions.map(revision => (
                <li key={revision.id} className={`history-cause-${revision.cause}`}>
                  <span className="history-cause">{causeLabel(revision.cause, fa)}</span>
                  <span className="history-transition">{statusLabel(revision.from_status, fa)} → {statusLabel(revision.to_status, fa)} · v{num(revision.revision_no, view.locale)}</span>
                  <small>{revision.actor_label || revision.actor_user_id || "—"}</small>
                </li>
              ))}</ol>}
          </div>}
        </Panel>
      </div>
    </div>}

    {/* R117-17: the editor-only preview overlay — noindex while open. */}
    {previewPost && <div className="edx-preview-overlay" data-surface="editorial-preview" role="dialog" aria-modal="true">
      <div className="edx-preview-banner">
        <strong>{previewPost.status === "published" ? L("PREVIEW — published edition", "پیش‌نمایش — نسخه منتشرشده") : L("PREVIEW — unpublished; not on the public newsroom", "پیش‌نمایش — منتشرنشده؛ در اتاق خبر عمومی نیست")}</strong>
        <span>EN {languageLabel(previewPost.language_completeness.en, fa)} · FA {languageLabel(previewPost.language_completeness.fa, fa)} · {mediaRightsLabel(previewPost.media_publication_rights, fa)}</span>
        <button className="edx-button secondary" onClick={() => setPreviewPost(null)}>{L("Close preview", "بستن پیش‌نمایش")}</button>
      </div>
      <article className="edx-preview-reader">
        <header>
          <Eyebrow>{kindLabel(previewPost.kind, fa)}{previewPost.ai_grounding ? ` · ${L("Google grounded", "با جست‌وجوی گوگل")}` : ""}</Eyebrow>
          <h2 dir="auto">{text(previewPost, fa, "title")}</h2>
          <p dir="auto">{text(previewPost, fa, "summary")}</p>
          <small>{previewPost.author_label || L("Registry editorial desk", "میز تحریریه سامانه ثبت")}</small>
        </header>
        <SimpleMarkdown value={text(previewPost, fa, "body")} />
        {previewPost.sources.length > 0 && <footer><strong>{L("Sources", "منابع")}</strong>{previewPost.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</footer>}
      </article>
    </div>}
  </main>;
}
