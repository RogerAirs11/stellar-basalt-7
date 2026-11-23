import React, { useEffect, useState } from "react";
import type {
  AiContentGenerateInput,
  ContentLanguageStatus,
  ContentMediaRights,
  ContentPost,
  ContentPostInput,
  ContentPostKind,
  ContentPostRevision,
  ContentPostStatus,
  AiContentModel,
  PlatformClient,
  PlatformMetaResponse,
  PlatformPermission,
  PlatformUser,
} from "../../contracts/platform";
import { useI18n } from "../i18n";
import { resolveExternalImage } from "../../frontend-kit";

type Props = {
  platform: PlatformClient;
  platformMeta: PlatformMetaResponse | null;
  user: PlatformUser | null;
  permissions: PlatformPermission[];
  navigate: (path: string, options?: { preserveScroll?: boolean }) => void;
};

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
    kind: "article",
    status: "draft",
    title_en: "",
    title_fa: "",
    summary_en: "",
    summary_fa: "",
    body_en: "",
    body_fa: "",
    tags: [],
    sources: [],
    cover_image_url: null,
    cover_image_alt_en: null,
    cover_image_alt_fa: null,
    cover_image_credit: null,
    cover_image_source_url: null,
    ai_model: null,
    ai_grounding: false,
    ai_prompt: null,
  };
}

function localText(post: ContentPost, fa: boolean, field: "title" | "summary" | "body") {
  const primary = field === "title" ? (fa ? post.title_fa : post.title_en) : field === "summary" ? (fa ? post.summary_fa : post.summary_en) : (fa ? post.body_fa : post.body_en);
  const fallback = field === "title" ? (fa ? post.title_en : post.title_fa) : field === "summary" ? (fa ? post.summary_en : post.summary_fa) : (fa ? post.body_en : post.body_fa);
  return primary || fallback;
}
function kindLabel(kind: ContentPostKind, fa: boolean) {
  return fa ? ({ article: "مقاله / وبلاگ", news: "خبر", update: "به‌روزرسانی" }[kind]) : ({ article: "Article / Blog", news: "News", update: "Update" }[kind]);
}
function statusLabel(status: ContentPostStatus, fa: boolean) {
  return fa ? ({ draft: "پیش‌نویس", published: "منتشرشده", archived: "بایگانی" }[status]) : ({ draft: "Draft", published: "Published", archived: "Archived" }[status]);
}
/** R117-17: per-language readiness computed live from the editor buffer — the
 * same rule the server reports (title AND body = complete; exactly one =
 * partial; neither = missing). Persian readiness is shown on its own so an
 * English publication never claims a completed Persian translation. */
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
/** R117-17: media-publication rights, tracked separately from language
 * completeness — an unattributed cover image is reported as exactly that. */
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

/** Renders the body exactly like the public newsroom reader so the preview is
 * truthful about what a published edition would look like. Turn 30: markdown
 * images and blockquotes render here too, matching the reader. */
function ArticleBody({ value }: { value: string }) {
  const blocks = value.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  return <div className="heritage-news-body">{blocks.map((block, index) => {
    const imageMatch = block.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (imageMatch) {
      const src = resolveExternalImage(imageMatch[2]) ?? imageMatch[2];
      return <figure key={index} className="heritage-news-inline-figure"><img src={src} alt={imageMatch[1]} loading="lazy" referrerPolicy="no-referrer" />{imageMatch[1] && <figcaption>{imageMatch[1]}</figcaption>}</figure>;
    }
    if (block.startsWith("> ")) return <blockquote key={index} dir="auto">{block.split("\n").map((line, lineIndex) => <span key={lineIndex}>{line.replace(/^> ?/, "")}{lineIndex < block.split("\n").length - 1 && <br />}</span>)}</blockquote>;
    if (block.startsWith("### ")) return <h4 key={index}>{block.slice(4)}</h4>;
    if (block.startsWith("## ")) return <h3 key={index}>{block.slice(3)}</h3>;
    if (block.startsWith("# ")) return <h2 key={index}>{block.slice(2)}</h2>;
    const lines = block.split("\n");
    if (lines.every(line => /^[-*] /.test(line))) return <ul key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{line.replace(/^[-*] /, "")}</li>)}</ul>;
    return <p key={index}>{lines.map((line, lineIndex) => <React.Fragment key={lineIndex}>{line}{lineIndex < lines.length - 1 && <br />}</React.Fragment>)}</p>;
  })}</div>;
}

/** Turn bare URLs in an error/info message into clickable links (used for the
 *  actionable Gemini/Vertex enable links). */
function linkify(text: string): React.ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s,)]+)/g);
  return parts.map((part, index) =>
    /^https?:\/\//.test(part)
      ? <a key={index} href={part} target="_blank" rel="noreferrer noopener">{part}</a>
      : <React.Fragment key={index}>{part}</React.Fragment>,
  );
}

/**
 * Heritage Editorial Studio — the dedicated professional writing/publishing
 * workspace. Split from the public newsroom reader so publishing controls
 * never appear below reader content (R32), and rebuilt (R34) on a strict
 * four-level container hierarchy so nothing floats on the bare page:
 *
 *   Level 01  .heritage-studio-shell      — one framed workspace container
 *   Level 02  .heritage-studio-col        — compose column / queue column
 *   Level 03  .heritage-studio-card       — AI agent card, editor card, queue list
 *   Level 04  .heritage-*-fields/-actions — inset field wells & action bars
 */
export function HeritageEditorialStudioPage({ platform, platformMeta, user, permissions, navigate }: Props) {
  const { locale, n } = useI18n();
  const fa = locale === "fa";
  const L = (en: string, faText: string) => fa ? faText : en;
  const canManage = Boolean(user && permissions.includes("content.manage"));
  // R37 guest demo access: visitors who are not signed in still get the full
  // generation + editing workspace. The first privileged action transparently
  // signs in the one-click demo administrator (session cookie + CSRF) and then
  // proceeds — the button never dead-ends on a "sign in required" wall.
  const guestDemoAvailable = Boolean(!user && platformMeta?.demoAdminLoginAvailable);
  const [autoSigningIn, setAutoSigningIn] = useState(false);
  const ensureManageSession = async (): Promise<boolean> => {
    if (Boolean(user && permissions.includes("content.manage"))) return true;
    if (!guestDemoAvailable) return false;
    setAutoSigningIn(true);
    try {
      await platform.auth.demoAdmin();
      return true;
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setAutoSigningIn(false);
    }
  };
  const [adminPosts, setAdminPosts] = useState<ContentPost[]>([]);
  const [draft, setDraft] = useState<ContentPostInput>(emptyDraft);
  const [editing, setEditing] = useState<ContentPost | null>(null);
  const [model, setModel] = useState<AiContentModel>("gemini-2.5-flash");
  const [grounding, setGrounding] = useState(true);
  const [aiKind, setAiKind] = useState<ContentPostKind>("news");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState<"generate" | "save" | "">("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"info" | "error">("info");
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [aiAttempts, setAiAttempts] = useState<string[]>([]);
  // R117-17: the governed workflow state — editor-only preview, explicit
  // publish/retract actions, and the per-post version history.
  const [previewPost, setPreviewPost] = useState<ContentPost | null>(null);
  const [revisions, setRevisions] = useState<ContentPostRevision[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<"preview" | "publish" | "retract" | "history" | "">("");

  // R117-17: an open draft preview must never be indexed — while the preview
  // overlay is mounted the page carries an explicit noindex robots rule.
  useEffect(() => {
    if (!previewPost) return;
    const meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", "noindex, nofollow");
    meta.dataset.r117Preview = "true";
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, [previewPost]);

  const refreshAdmin = async () => {
    try {
      const result = await platform.admin.content.list({ limit: 100 });
      setAdminPosts(result.posts);
      return result.posts;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setMessageKind("error");
      return null;
    }
  };

  useEffect(() => { if (canManage) void refreshAdmin(); }, [canManage]);

  const loadEditor = (post: ContentPost) => {
    setEditing(post);
    setDraft({
      kind: post.kind,
      status: post.status,
      title_en: post.title_en,
      title_fa: post.title_fa,
      summary_en: post.summary_en,
      summary_fa: post.summary_fa,
      body_en: post.body_en,
      body_fa: post.body_fa,
      tags: [...post.tags],
      sources: [...post.sources],
      cover_image_url: post.cover_image_url ?? null,
      cover_image_alt_en: post.cover_image_alt_en ?? null,
      cover_image_alt_fa: post.cover_image_alt_fa ?? null,
      cover_image_credit: post.cover_image_credit ?? null,
      cover_image_source_url: post.cover_image_source_url ?? null,
      ai_model: post.ai_model ?? null,
      ai_grounding: post.ai_grounding,
      ai_prompt: post.ai_prompt ?? null,
    });
  };

  const runAi = async () => {
    setBusy("generate"); setMessage(""); setAiWarnings([]); setAiAttempts([]);
    try {
      if (!(await ensureManageSession())) {
        setMessageKind("error");
        setMessage(L("Editorial access is unavailable on this deployment.", "دسترسی تحریریه در این استقرار در دسترس نیست."));
        return;
      }
      const input: AiContentGenerateInput = { model, grounding, kind: aiKind, topic: topic.trim() || undefined };
      const result = await platform.admin.content.generate(input);
      setMessageKind("info");
      setMessage(L("AI draft generated. Review and save it before publishing.", "پیش‌نویس هوش مصنوعی ساخته شد. پیش از انتشار آن را بررسی و ذخیره کنید."));
      setAiWarnings(result.warnings ?? []);
      setAiAttempts(result.attempts ?? []);
      setEditing(null);
      setDraft(result.draft);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(""); }
  };

  const save = async () => {
    setBusy("save"); setMessage("");
    try {
      if (!(await ensureManageSession())) {
        setMessageKind("error");
        setMessage(L("Editorial access is unavailable on this deployment.", "دسترسی تحریریه در این استقرار در دسترس نیست."));
        return;
      }
      const result = editing
        ? await platform.admin.content.update(editing.id, editing.row_version, draft)
        : await platform.admin.content.create(draft);
      setEditing(result.post);
      setDraft({ ...draft, status: result.post.status });
      setMessageKind("info");
      setMessage(L("Post saved.", "مطلب ذخیره شد."));
      await refreshAdmin();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(""); }
  };

  const queueCount = (status: ContentPostStatus) => adminPosts.filter(post => post.status === status).length;

  // R117-17: live readiness indicators for the editor buffer — language
  // completeness (EN and FA separately) and media-publication rights.
  const draftLanguages = { en: languageStatusOf(draft.title_en, draft.body_en), fa: languageStatusOf(draft.title_fa, draft.body_fa), ar: languageStatusOf(draft.title_ar ?? "", draft.body_ar ?? ""), zh: languageStatusOf(draft.title_zh ?? "", draft.body_zh ?? "") };
  const draftMediaRights = mediaRightsOf(draft.cover_image_url, draft.cover_image_credit, draft.cover_image_source_url);

  const openPreview = async () => {
    setMessage("");
    // Unsaved buffers preview locally; saved posts preview through the real
    // editor-only preview route (drafts are never on the public read routes).
    if (!editing) {
      setPreviewPost({
        id: "unsaved", slug: "unsaved", kind: draft.kind, status: draft.status,
        title_en: draft.title_en, title_fa: draft.title_fa, title_ar: draft.title_ar ?? "", title_zh: draft.title_zh ?? "", summary_en: draft.summary_en, summary_fa: draft.summary_fa, summary_ar: draft.summary_ar ?? "", summary_zh: draft.summary_zh ?? "",
        body_en: draft.body_en, body_fa: draft.body_fa, body_ar: draft.body_ar ?? "", body_zh: draft.body_zh ?? "", tags: draft.tags, sources: draft.sources,
        cover_image_url: draft.cover_image_url ?? null, cover_image_alt_en: draft.cover_image_alt_en ?? null, cover_image_alt_fa: draft.cover_image_alt_fa ?? null,
        cover_image_credit: draft.cover_image_credit ?? null, cover_image_source_url: draft.cover_image_source_url ?? null,
        author_user_id: user?.id ?? null, author_label: user?.display_name ?? null,
        ai_model: draft.ai_model ?? null, ai_grounding: Boolean(draft.ai_grounding), ai_prompt: draft.ai_prompt ?? null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), published_at: null, row_version: 1,
        language_completeness: draftLanguages, media_publication_rights: draftMediaRights,
      });
      return;
    }
    setBusyAction("preview");
    try {
      if (!(await ensureManageSession())) return;
      const result = await platform.admin.content.preview(editing.id);
      setPreviewPost(result.post);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusyAction(""); }
  };

  const doPublish = async () => {
    if (!editing) return;
    setBusyAction("publish"); setMessage("");
    try {
      if (!(await ensureManageSession())) return;
      const result = await platform.admin.content.publish(editing.id, editing.row_version);
      setEditing(result.post);
      setDraft({ ...draft, status: result.post.status });
      setMessageKind("info");
      setMessage(L(`Published. The public newsroom serves it now (Persian edition: ${languageLabel(result.post.language_completeness.fa, fa)}).`, `منتشر شد. اتاق خبر عمومی از الان آن را نمایش می‌دهد (نسخه فارسی: ${languageLabel(result.post.language_completeness.fa, fa)}).`));
      await refreshAdmin();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusyAction(""); }
  };

  const doRetract = async () => {
    if (!editing) return;
    setBusyAction("retract"); setMessage("");
    try {
      if (!(await ensureManageSession())) return;
      const result = await platform.admin.content.retract(editing.id, editing.row_version);
      setEditing(result.post);
      setDraft({ ...draft, status: result.post.status });
      setMessageKind("info");
      setMessage(L("Retracted. The public newsroom no longer serves this post; the retraction stays visible after reload.", "بازپس‌گیری شد. اتاق خبر عمومی دیگر این مطلب را نمایش نمی‌دهد و بازپس‌گیری پس از بارگذاری مجدد هم باقی می‌ماند."));
      await refreshAdmin();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusyAction(""); }
  };

  const loadHistory = async () => {
    if (!editing) return;
    if (historyOpen) { setHistoryOpen(false); return; }
    setBusyAction("history"); setMessage("");
    try {
      if (!(await ensureManageSession())) return;
      const result = await platform.admin.content.revisions(editing.id);
      setRevisions(result.revisions);
      setHistoryOpen(true);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusyAction(""); }
  };

  return <main className="heritage-studio page">
    <section className="heritage-studio-shell" data-h-surface-role="major">
      <header className="heritage-studio-shell-head">
        <div className="heritage-studio-shell-title">
          <span className="eyebrow">{L("EDITORIAL STUDIO", "استودیوی تحریریه")}</span>
          <h1>{L("Write, generate & publish", "نوشتن، تولید و انتشار")}</h1>
          <p>{L("The professional bilingual publishing workspace: AI-assisted drafting, a focused manual editor, and the full editorial queue.", "فضای کاری حرفه‌ای انتشار دو زبانه: پیش‌نویس با هوش مصنوعی، ویرایشگر دستی و صف کامل تحریریه.")}</p>
        </div>
        <div className="heritage-studio-head-actions">
          <button className="ghost" onClick={() => navigate("/newsroom")}>← <span>{L("Back to Newsroom", "بازگشت به اتاق خبر")}</span></button>
        </div>
      </header>

      {!canManage && guestDemoAvailable && <section className="heritage-studio-notice heritage-studio-guest-note">{autoSigningIn ? L("Signing in the demo administrator…", "در حال ورود مدیر دمو…") : L("Guest demo workspace — you can generate, edit and publish right away. Your first action signs in the one-click demo administrator automatically.", "فضای کاری دموی مهمان — همین حالا می‌توانید تولید، ویرایش و انتشار کنید. نخستین اقدام شما به‌طور خودکار با مدیر دمو ورود می‌کند.")}</section>
      }
      {!canManage && !guestDemoAvailable && <section className="heritage-studio-notice">{L("You are not signed in as an editor. Publishing controls are hidden.", "شما به‌عنوان تحریریه وارد نشده‌اید. کنترل‌های انتشار مخفی شده‌اند.")}</section>}

      {message && <div className={`heritage-studio-message ${messageKind === "error" ? "is-error" : "is-info"}`} role={messageKind === "error" ? "alert" : "status"}>{linkify(message)}</div>}

      {canManage || guestDemoAvailable ? <div className="heritage-studio-columns">
        <section className="heritage-studio-col heritage-studio-col-compose">
          <article className="heritage-studio-card" data-h-surface-role="panel">
            <header><span className="eyebrow">AI EDITORIAL AGENT</span><h2>{L("Generate a bilingual draft", "ساخت پیش‌نویس دو زبانه")}</h2></header>
            <div className="heritage-ai-controls">
              <label>{L("Model", "مدل")}<select value={model} onChange={event => { const next = event.target.value as AiContentModel; setModel(next); if (next === "deepseek-flash") setGrounding(false); }}>{MODELS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>{L("Post type", "نوع مطلب")}<select value={aiKind} onChange={event => setAiKind(event.target.value as ContentPostKind)}>{KINDS.map(value => <option key={value} value={value}>{kindLabel(value, fa)}</option>)}</select></label>
              <label className="heritage-ground-toggle span-2"><input type="checkbox" checked={grounding} onChange={event => setGrounding(event.target.checked)} /><span><strong>{L("Google Grounding", "اتصال به جست‌وجوی گوگل")}</strong><small>{L("Use current sources and save citations with the post.", "از منابع روز استفاده و لینک منابع را همراه مطلب ذخیره می‌کند.")}</small></span></label>
              <label className="span-2">{L("Topic / instruction", "موضوع / دستور")}<textarea rows={3} value={topic} onChange={event => setTopic(event.target.value)} placeholder={L("Optional — leave blank and the agent will choose a useful Arabian-horse topic.", "اختیاری — خالی بگذارید تا عامل یک موضوع مفید درباره اسب عرب انتخاب کند.")} /></label>
            </div>
            <div className="heritage-ai-actions"><button className="primary" disabled={Boolean(busy)} onClick={() => void runAi()}>{busy === "generate" ? L("Generating…", "در حال ساخت…") : L("Generate draft", "ساخت پیش‌نویس")}</button></div>
            {(aiWarnings.length > 0 || aiAttempts.length > 0) && <div className="heritage-studio-ai-feedback">
              {aiWarnings.map((warning, index) => <p key={`w${index}`} className="warning">⚠ {warning}</p>)}
              {aiAttempts.map((attempt, index) => <p key={`a${index}`} className="attempt">↻ {attempt}</p>)}
            </div>}
          </article>

          <article className="heritage-studio-card" id="heritage-news-editor">
            <header><span className="eyebrow">{editing ? L("EDIT POST", "ویرایش مطلب") : L("NEW POST", "مطلب جدید")}</span><h2>{editing ? L("Edit the selected post", "ویرایش مطلب انتخاب‌شده") : L("Write a manual post", "نوشتن مطلب دستی")}</h2></header>
            <div className="heritage-editor-fields">
              <label>English title<input dir="ltr" value={draft.title_en} onChange={e => setDraft(v => ({ ...v, title_en: e.target.value }))} /></label>
              <label>عنوان فارسی<input dir="rtl" value={draft.title_fa} onChange={e => setDraft(v => ({ ...v, title_fa: e.target.value }))} /></label>
              <label>English summary<textarea dir="ltr" rows={3} value={draft.summary_en} onChange={e => setDraft(v => ({ ...v, summary_en: e.target.value }))} /></label>
              <label>خلاصه فارسی<textarea dir="rtl" rows={3} value={draft.summary_fa} onChange={e => setDraft(v => ({ ...v, summary_fa: e.target.value }))} /></label>
              <label>English body<textarea dir="ltr" rows={12} value={draft.body_en} onChange={e => setDraft(v => ({ ...v, body_en: e.target.value }))} /></label>
              <label>متن فارسی<textarea dir="rtl" rows={12} value={draft.body_fa} onChange={e => setDraft(v => ({ ...v, body_fa: e.target.value }))} /></label>
              <label>{L("Cover image URL", "نشانی تصویر شاخص")}<input dir="ltr" value={draft.cover_image_url ?? ""} onChange={e => setDraft(v => ({ ...v, cover_image_url: e.target.value || null }))} /></label>
              <label>{L("Image credit", "اعتبار تصویر")}<input value={draft.cover_image_credit ?? ""} onChange={e => setDraft(v => ({ ...v, cover_image_credit: e.target.value || null }))} /></label>
              <label>{L("Type", "نوع")}<select value={draft.kind} onChange={e => setDraft(v => ({ ...v, kind: e.target.value as ContentPostKind }))}>{KINDS.map(value => <option key={value} value={value}>{kindLabel(value, fa)}</option>)}</select></label>
              <label>{L("Status", "وضعیت")}<select value={draft.status} onChange={e => setDraft(v => ({ ...v, status: e.target.value as ContentPostStatus }))}><option value="draft">{statusLabel("draft", fa)}</option><option value="published">{statusLabel("published", fa)}</option><option value="archived">{statusLabel("archived", fa)}</option></select></label>
              <label className="span-2">{L("Tags (comma separated)", "برچسب‌ها (با ویرگول)")}<input value={draft.tags.join(", ")} onChange={e => setDraft(v => ({ ...v, tags: e.target.value.split(",").map(part => part.trim()).filter(Boolean).slice(0, 12) }))} /></label>
            </div>
            {/* R117-17: language completeness and media-publication rights are
                shown as SEPARATE live indicators — never conflated with the
                publication status, and a missing Persian edition is named as
                missing, not claimed as translated. */}
            <div className="heritage-editor-readiness" data-surface="editorial-readiness">
              <span className={`readiness-lang is-${draftLanguages.en}`}>EN · {languageLabel(draftLanguages.en, fa)}</span>
              <span className={`readiness-lang is-${draftLanguages.fa}`}>FA · {languageLabel(draftLanguages.fa, fa)}</span>
              <span className={`readiness-media is-${draftMediaRights}`}>{mediaRightsLabel(draftMediaRights, fa)}</span>
            </div>
            <div className="heritage-editor-save">
              <button className="primary" disabled={Boolean(busy) || !draft.title_en.trim() || !draft.body_en.trim()} onClick={() => void save()}>{busy === "save" ? L("Saving…", "در حال ذخیره…") : L("Save post", "ذخیره مطلب")}</button>
              <button className="ghost" onClick={() => { setEditing(null); setDraft(emptyDraft()); setHistoryOpen(false); }}>{L("Clear", "پاک کردن")}</button>
              <span>{draft.status === "published" ? L("This will be visible to everyone.", "این مطلب برای همه کاربران قابل مشاهده خواهد بود.") : L("Drafts are visible only to editors.", "پیش‌نویس فقط برای تحریریه دیده می‌شود.")}</span>
            </div>
            {/* R117-17: the governed workflow actions — preview (editor-only,
                never indexed), explicit publish, retract, and the immutable
                version history. */}
            <div className="heritage-editor-workflow" data-surface="editorial-workflow">
              <button className="ghost" disabled={Boolean(busyAction) || !draft.title_en.trim() || !draft.body_en.trim()} onClick={() => void openPreview()}>{busyAction === "preview" ? L("Opening…", "در حال بازگشایی…") : L("Preview", "پیش‌نمایش")}</button>
              {editing && editing.status !== "published" && <button className="primary" disabled={Boolean(busyAction) || editing.language_completeness.en !== "complete"} onClick={() => void doPublish()}>{busyAction === "publish" ? L("Publishing…", "در حال انتشار…") : L("Publish", "انتشار")}</button>}
              {editing && editing.status === "published" && <button className="danger" disabled={Boolean(busyAction)} onClick={() => void doRetract()}>{busyAction === "retract" ? L("Retracting…", "در حال بازپس‌گیری…") : L("Retract", "بازپس‌گیری")}</button>}
              {editing && <button className="ghost" disabled={Boolean(busyAction)} onClick={() => void loadHistory()}>{busyAction === "history" ? L("Loading…", "در حال بارگذاری…") : historyOpen ? L("Hide history", "پنهان کردن تاریخچه") : L("Version history", "تاریخچه نسخه‌ها")}</button>}
            </div>
          </article>
        </section>

        <aside className="heritage-studio-col heritage-studio-col-queue">
          <header className="heritage-studio-queue-head">
            <span><span className="eyebrow">EDITORIAL QUEUE</span><h2>{L("Editorial queue", "صف تحریریه")}</h2></span>
            <button className="ghost" onClick={() => void refreshAdmin()}>{L("Refresh", "تازه‌سازی")}</button>
          </header>
          <div className="heritage-studio-queue-filters">
            <span className="status-draft">{n(queueCount("draft"))} {statusLabel("draft", fa)}</span>
            <span className="status-published">{n(queueCount("published"))} {statusLabel("published", fa)}</span>
            <span className="status-archived">{n(queueCount("archived"))} {statusLabel("archived", fa)}</span>
          </div>
          <div className="heritage-studio-queue-list">
            {adminPosts.length === 0 ? <p className="heritage-studio-queue-empty">{L("No saved posts yet. Generate a draft or write one manually.", "هنوز مطلبی ذخیره نشده است. یک پیش‌نویس بسازید یا دستی بنویسید.")}</p>
              : adminPosts.map(post => (
                <button key={post.id} className={`heritage-studio-queue-item${editing?.id === post.id ? " selected" : ""}`} onClick={() => { loadEditor(post); setHistoryOpen(false); }}>
                  <span className="queue-item-kind">{kindLabel(post.kind, fa)}</span>
                  <strong dir="auto">{localText(post, fa, "title")}</strong>
                  <small>{post.ai_model || L("Manual", "دستی")} · EN {languageLabel(post.language_completeness.en, fa)} · FA {languageLabel(post.language_completeness.fa, fa)}</small>
                  <span className={`queue-item-status status-${post.status}`}>{statusLabel(post.status, fa)}</span>
                </button>
              ))}
          </div>
          {/* R117-17: the immutable per-post version history — every governed
              transition (create / edit / publish / retract) with its honest
              status pair and the acting editor. */}
          {editing && historyOpen && <div className="heritage-studio-history" data-surface="editorial-history">
            <header><span className="eyebrow">VERSION HISTORY</span><h3>{L("Version history", "تاریخچه نسخه‌ها")} · v{n(editing.row_version)}</h3></header>
            {revisions.length === 0 ? <p className="heritage-studio-queue-empty">{L("No recorded revisions.", "نسخه‌ای ثبت نشده است.")}</p>
              : <ol className="heritage-studio-history-list">{revisions.map(revision => (
                <li key={revision.id} className={`history-cause-${revision.cause}`}>
                  <span className="history-cause">{causeLabel(revision.cause, fa)}</span>
                  <span className="history-transition">{statusLabel(revision.from_status, fa)} → {statusLabel(revision.to_status, fa)} · v{n(revision.revision_no)}</span>
                  <small>{revision.actor_label || revision.actor_user_id || "—"} · {new Intl.DateTimeFormat(fa ? "fa-IR" : "en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(revision.created_at))}</small>
                </li>
              ))}</ol>}
          </div>}
        </aside>
      </div> : null}
    </section>
    {/* R117-17: the editor-only preview overlay — renders exactly like the
        public reader, clearly marked as an unpublished preview, and carries a
        noindex robots rule while open so it can never be indexed. */}
    {previewPost && <div className="heritage-preview-overlay" data-surface="editorial-preview" role="dialog" aria-modal="true">
      <div className="heritage-preview-banner">
        <strong>{previewPost.status === "published" ? L("PREVIEW — published edition", "پیش‌نمایش — نسخه منتشرشده") : L("PREVIEW — unpublished; not on the public newsroom", "پیش‌نمایش — منتشرنشده؛ در اتاق خبر عمومی نیست")}</strong>
        <span>EN {languageLabel(previewPost.language_completeness.en, fa)} · FA {languageLabel(previewPost.language_completeness.fa, fa)} · {mediaRightsLabel(previewPost.media_publication_rights, fa)}</span>
        <button className="ghost" onClick={() => setPreviewPost(null)}>{L("Close preview", "بستن پیش‌نمایش")}</button>
      </div>
      <article className="heritage-preview-reader">
        <header>
          <div><span className={`heritage-news-kind kind-${previewPost.kind}`}>{kindLabel(previewPost.kind, fa)}</span>{previewPost.ai_grounding && <span className="heritage-grounded">● {L("Google grounded", "دارای منبع گوگل")}</span>}</div>
          <h2 dir="auto">{localText(previewPost, fa, "title")}</h2>
          <p dir="auto">{localText(previewPost, fa, "summary")}</p>
          <small>{previewPost.author_label || L("Horse DB Editorial", "تحریریه Horse DB")}</small>
        </header>
        <ArticleBody value={localText(previewPost, fa, "body")} />
        {previewPost.sources.length > 0 && <footer><strong>{L("Sources", "منابع")}</strong>{previewPost.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">↗ {source.title}</a>)}</footer>}
      </article>
    </div>}
  </main>;
}
