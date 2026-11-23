import { uiText, uiNumberTag, type UiLocale } from "../../shared/uiLocale";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  ContentComment,
  ContentPost,
  ContentPostKind,
  PlatformClient,
  PlatformMetaResponse,
  PlatformPermission,
  PlatformUser,
} from "../../contracts/platform";
import { useI18n } from "../i18n";
import { resolveExternalImage } from "../../frontend-kit";
import { useHeritageMobileDock, type HeritageDockLayer } from "./MobileDock";
import { isHeritageCompactViewport, revealHeritageContent } from "./viewTransition";

type Props = {
  platform: PlatformClient;
  platformMeta: PlatformMetaResponse | null;
  user: PlatformUser | null;
  permissions: PlatformPermission[];
  navigate: (path: string, options?: { preserveScroll?: boolean }) => void;
};

const KINDS: ContentPostKind[] = ["article", "news", "update"];

function localText(post: ContentPost, fa: boolean, field: "title" | "summary" | "body") {
  const primary = field === "title" ? (fa ? post.title_fa : post.title_en) : field === "summary" ? (fa ? post.summary_fa : post.summary_en) : (fa ? post.body_fa : post.body_en);
  const fallback = field === "title" ? (fa ? post.title_en : post.title_fa) : field === "summary" ? (fa ? post.summary_en : post.summary_fa) : (fa ? post.body_en : post.body_fa);
  return primary || fallback;
}

function kindLabel(kind: ContentPostKind, locale: UiLocale) {
  const labels = { article: ["Article / Blog", "\u0645\u0642\u0627\u0644\u0647 / \u0648\u0628\u0644\u0627\u06af"], news: ["News", "\u062e\u0628\u0631"], update: ["Update", "\u0628\u0647\u200c\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06cc"] };
  return uiText(locale, labels[kind][0], labels[kind][1]);
}

function ArticleBody({ value }: { value: string }) {
  const blocks = value.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  return <div className="heritage-news-body">{blocks.map((block, index) => {
    // Turn 30: standalone markdown image — ![alt](url) — renders as a figure.
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

/** Turn 30: the reader conversation — published community comments under the
 * article, plus an open submission form whose output is honestly reported as
 * pending editorial approval (nothing publishes itself). */
function CommentSection({ platform, postId, locale }: { platform: PlatformClient; postId: string; locale: UiLocale }) {
  const L = (en: string, faText: string) => uiText(locale, en, faText);
  const { n } = useI18n();
  const fa = locale === "fa";
  const [comments, setComments] = useState<ContentComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    try {
      const result = await platform.content.comments(postId);
      setComments(result.comments);
    } catch { /* the section degrades silently — comments are additive */ }
    finally { setLoading(false); }
  };
  useEffect(() => { setComments([]); setLoading(true); setNotice(""); setError(""); void reload(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [postId]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (name.trim().length < 2 || body.trim().length < 3) {
      setError(L("Please enter a name and a comment.", "نام و متن دیدگاه را وارد کنید."));
      return;
    }
    setBusy(true);
    try {
      await platform.content.submitComment(postId, { author_name: name.trim(), body: body.trim(), locale: locale === "fa" || locale === "en" ? locale : "fa" });
      setBody("");
      setNotice(L("Your comment was submitted and will appear after editorial approval.", "دیدگاه شما ثبت شد و پس از تأیید تحریریه نمایش داده می‌شود."));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  };
  const relative = (value: string) => {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return "";
    const days = Math.floor((Date.now() - parsed.getTime()) / 86_400_000);
    if (days <= 0) return L("today", "امروز");
    if (days === 1) return L("yesterday", "دیروز");
    if (days < 30) return fa ? `${n(days)} روز پیش` : `${n(days)} days ago`;
    return new Intl.DateTimeFormat(uiNumberTag(locale), { year: "numeric", month: "short", day: "numeric" }).format(parsed);
  };
  return <section className="heritage-news-comments" aria-label={L("Reader comments", "دیدگاه خوانندگان")}>
    <h3 className="heritage-news-comments-title">{L("Comments", "دیدگاه‌ها")} <span>({n(comments.length)})</span></h3>
    {loading ? <p className="heritage-news-comments-empty">{L("Loading comments…", "در حال بارگذاری دیدگاه‌ها…")}</p>
      : comments.length === 0 ? <p className="heritage-news-comments-empty">{L("Be the first to share your view.", "نخستین کسی باشید که دیدگاهش را می‌نویسد.")}</p>
      : <ul className="heritage-news-comments-list">{comments.map(comment => <li key={comment.id} className="heritage-news-comment">
        <span className="heritage-news-comment-avatar" aria-hidden="true">{comment.author_name.trim().charAt(0).toUpperCase()}</span>
        <div className="heritage-news-comment-main" dir="auto">
          <div className="heritage-news-comment-head"><strong>{comment.author_name}</strong><small>{relative(comment.created_at)}</small></div>
          <p dir="auto">{comment.body}</p>
          {comment.likes > 0 && <small className="heritage-news-comment-likes">▲ {n(comment.likes)}</small>}
        </div>
      </li>)}</ul>}
    <form className="heritage-news-comment-form" onSubmit={event => { void submit(event); }}>
      <div className="heritage-news-comment-form-row">
        <input value={name} onChange={event => setName(event.target.value)} placeholder={L("Your name", "نام شما")} maxLength={60} aria-label={L("Your name", "نام شما")} />
        <button type="submit" disabled={busy || body.trim().length < 3}>{busy ? L("Sending…", "در حال ارسال…") : L("Send", "ارسال")}</button>
      </div>
      <textarea value={body} onChange={event => setBody(event.target.value)} placeholder={L("Write a comment…", "دیدگاه خود را بنویسید…")} rows={3} maxLength={2000} aria-label={L("Comment", "دیدگاه")} />
      {notice && <p className="heritage-news-comment-notice" role="status">{notice}</p>}
      {error && <p className="heritage-news-comment-error" role="alert">{error}</p>}
    </form>
  </section>;
}

/**
 * Heritage Newsroom — the public reader.
 *
 * R32 scroll architecture (user task 3b): the desktop page is an app-style
 * workspace with exactly TWO scroll layers — the article sidebar feed and the
 * article reader. The page itself never scrolls. Editorial/publishing controls
 * live on the dedicated /newsroom/studio route instead of below the article.
 */
export function HeritageNewsroomPage({ platform, platformMeta, user, permissions, navigate }: Props) {
  const { locale, n } = useI18n();
  const fa = locale === "fa";
  const L = (en: string, faText: string) => uiText(locale, en, faText);
  const canManage = Boolean(user && permissions.includes("content.manage"));
  const demoAvailable = Boolean(!user && platformMeta?.demoAdminLoginAvailable);
  const [kind, setKind] = useState<ContentPostKind | "">("");
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"login" | "">("");
  const feedScrollRef = useRef(0);
  const [mobileReaderOpen, setMobileReaderOpen] = useState(() => typeof location !== "undefined" && new URLSearchParams(location.search).has("post"));

  const refreshPublic = async () => {
    setLoading(true);
    try {
      const result = await platform.content.list({ kind: kind || undefined, limit: 50 });
      setPosts(result.posts);
      setTotal(result.total);
      if (selectedId && !result.posts.some(post => post.id === selectedId)) setSelectedId(null);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refreshPublic(); }, [kind]);

  useEffect(() => {
    const syncReaderFromUrl = () => {
      const postId = new URLSearchParams(location.search).get("post");
      if (postId) {
        setSelectedId(postId);
        setMobileReaderOpen(true);
        revealHeritageContent(".heritage-news-reader");
      } else {
        setMobileReaderOpen(false);
        const restore = feedScrollRef.current;
        requestAnimationFrame(() => window.scrollTo({ top: restore, behavior: "auto" }));
      }
    };
    addEventListener("popstate", syncReaderFromUrl);
    syncReaderFromUrl();
    return () => removeEventListener("popstate", syncReaderFromUrl);
  }, []);

  const selected = useMemo(() => posts.find(post => post.id === selectedId) ?? posts[0] ?? null, [posts, selectedId]);
  useEffect(() => {
    if (mobileReaderOpen && selected) revealHeritageContent(".heritage-news-reader");
  }, [mobileReaderOpen, selected?.id]);
  const date = (value: string | null | undefined) => {
    if (!value) return "";
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat(uiNumberTag(locale), { year: "numeric", month: "short", day: "numeric" }).format(parsed) : "\u2014";
  };
  const openPost = (postId: string) => {
    setSelectedId(postId);
    if (!isHeritageCompactViewport()) return;
    feedScrollRef.current = window.scrollY;
    const url = new URL(location.href);
    url.searchParams.set("post", postId);
    if (new URLSearchParams(location.search).get("post") !== postId) history.pushState({ ...(history.state ?? {}), horseDbNewsroomReader: postId }, "", `${url.pathname}${url.search}${url.hash}`);
    setMobileReaderOpen(true);
    revealHeritageContent(".heritage-news-reader");
  };
  const closeMobileReader = () => {
    if (history.state?.horseDbNewsroomReader) { history.back(); return; }
    const url = new URL(location.href);
    url.searchParams.delete("post");
    history.replaceState(history.state ?? {}, "", `${url.pathname}${url.search}${url.hash}`);
    setMobileReaderOpen(false);
    requestAnimationFrame(() => window.scrollTo({ top: feedScrollRef.current, behavior: "auto" }));
  };
  const chooseKind = (value: ContentPostKind | "") => {
    if (mobileReaderOpen) {
      const url = new URL(location.href);
      url.searchParams.delete("post");
      history.replaceState(history.state ?? {}, "", `${url.pathname}${url.search}${url.hash}`);
      setMobileReaderOpen(false);
    }
    setKind(value);
    revealHeritageContent(".heritage-news-tabs");
  };
  const newsroomDockLayers = useMemo<HeritageDockLayer[]>(() => mobileReaderOpen ? [] : [{
    id: "newsroom-types", level: "secondary", ariaLabel: L("Post types", "نوع مطلب"),
    items: (["", ...KINDS] as Array<ContentPostKind | "">).map(value => ({ id: value || "all", label: value ? kindLabel(value, locale) : L("All posts", "همه مطالب"), active: kind === value, onActivate: () => chooseKind(value), revealTarget: ".heritage-news-tabs" })),
  }], [fa, kind, locale, mobileReaderOpen]);
  useHeritageMobileDock("newsroom", newsroomDockLayers);

  const demoLogin = async () => {
    setBusy("login"); setMessage("");
    try {
      const session = await platform.auth.demoAdmin();
      setMessage(L(`Signed in as ${session.user?.display_name ?? "Demo Admin"}.`, `با حساب ${session.user?.display_name ?? "مدیر دمو"} وارد شدید.`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(""); }
  };

  return <main className={`heritage-newsroom page${mobileReaderOpen ? " is-reading" : ""}`}>
    {/* R33 (user feedback): the big page hero (eyebrow + h1 + subtitle) ate the
        reading area — replaced by a single-line topbar. The reader scrolls
        EVERYTHING (cover image included); only this bar and the tab rail stay. */}
    <section className="heritage-news-topbar" data-h-surface-role="major">
      <span className="heritage-news-topbar-title"><b>{L("Newsroom", "اتاق خبر")}</b><small>{L("News, articles & updates", "خبرها، مقاله‌ها و به‌روزرسانی‌ها")}</small></span>
      <span className="heritage-news-topbar-actions">
        <span className="heritage-news-count"><strong>{n(total)}</strong><small>{L("published", "منتشرشده")}</small></span>
        {(canManage || demoAvailable) && <button className="heritage-studio-cta" onClick={() => navigate("/newsroom/studio")}><span>✎</span><span>{L("Editorial Studio", "استودیوی تحریریه")}</span></button>}
        {demoAvailable && <button className="demo-admin-cta" onClick={() => void demoLogin()} disabled={busy === "login"}>{busy === "login" ? L("Signing in…", "در حال ورود…") : L("Demo Admin Login", "ورود مدیر دمو")}</button>}
        {user && <span className="heritage-news-session"><strong>{user.display_name}</strong><small>{user.role}</small></span>}
      </span>
    </section>

    <section className="heritage-tab-rail heritage-news-tabs" data-view-transition-anchor aria-label={L("Post types", "نوع مطلب")}>{(["", ...KINDS] as Array<ContentPostKind | "">).map(value => <button key={value || "all"} data-kind={value || "all"} className={kind === value ? "active" : ""} aria-current={kind === value ? "page" : undefined} onClick={() => chooseKind(value)}><i className="heritage-kind-dot" aria-hidden="true"></i>{value ? kindLabel(value, locale) : L("All posts", "همه مطالب")}</button>)}</section>

    {message && <div className="heritage-news-message" role="status">{message}</div>}
    {loading ? <section className="heritage-news-empty panel">{L("Loading newsroom…", "در حال بارگذاری اتاق خبر…")}</section>
      : posts.length === 0 ? <section className="heritage-news-empty panel"><strong>{L("No published posts yet.", "هنوز مطلب منتشرشده‌ای وجود ندارد.")}</strong><span>{L("Published posts appear here as soon as the editorial team releases them.", "مطالب منتشرشده به‌محض انتشار توسط تحریریه اینجا نمایش داده می‌شوند.")}</span></section>
      : <section className="heritage-news-grid">
        <aside className="heritage-news-feed" data-view-transition-anchor>{posts.map(post => <button className={`heritage-news-card kind-${post.kind} ${selected?.id === post.id ? "selected" : ""}`} key={post.id} onClick={() => openPost(post.id)}>
          {post.cover_image_url
            ? <img src={resolveExternalImage(post.cover_image_url)} alt={(fa ? post.cover_image_alt_fa : post.cover_image_alt_en) || localText(post, fa, "title")} loading="lazy" referrerPolicy="no-referrer" />
            : <span className={`heritage-news-thumb-fallback kind-${post.kind}`} aria-hidden="true"></span>}
          <span className="heritage-news-card-body">
            <span className={`heritage-news-kind kind-${post.kind}`}>{kindLabel(post.kind, locale)}</span>
            <strong dir="auto">{localText(post, fa, "title")}</strong>
            <p dir="auto">{localText(post, fa, "summary")}</p>
            <small>{date(post.published_at)}{post.ai_model ? ` · ${post.ai_model}` : ""}</small>
          </span>
        </button>)}</aside>
        {selected && <article className={`heritage-news-reader panel kind-${selected.kind}`} data-view-transition-anchor>
          <button className="heritage-news-reader-back" type="button" onClick={closeMobileReader}>← <span>{L("Back to Newsroom", "بازگشت به مطالب")}</span></button>
          <div className="heritage-news-reader-scroll">
            {/* R33: cover image lives INSIDE the scroll flow — everything in the
                article (image, title, subtitle, body, sources) scrolls together. */}
            {selected.cover_image_url && <figure className="heritage-news-reader-cover"><img src={resolveExternalImage(selected.cover_image_url)} alt={(fa ? selected.cover_image_alt_fa : selected.cover_image_alt_en) || localText(selected, fa, "title")} referrerPolicy="no-referrer" />{selected.cover_image_credit && <figcaption>{selected.cover_image_source_url ? <a href={selected.cover_image_source_url} target="_blank" rel="noreferrer">{selected.cover_image_credit}</a> : selected.cover_image_credit}</figcaption>}</figure>}
            <header><div><span className={`heritage-news-kind kind-${selected.kind}`}>{kindLabel(selected.kind, locale)}</span>{selected.ai_grounding && <span className="heritage-grounded">● {L("Google grounded", "دارای منبع گوگل")}</span>}</div><h2 dir="auto">{localText(selected, fa, "title")}</h2><p dir="auto">{localText(selected, fa, "summary")}</p><small>{selected.author_label || L("Horse DB Editorial", "تحریریه Horse DB")} · {date(selected.published_at)}</small></header>
            {/* R117-17: the reader never claims a translation that is not
                stored — when the current locale's edition is missing or
                partial, the fallback to the other language is labeled
                honestly instead of being presented as localized content. */}
            {selected.language_completeness[fa ? "fa" : "en"] !== "complete" && <p className="heritage-news-fallback-note" data-surface="editorial-fallback-note" dir="auto">{fa ? "ترجمه فارسی این مطلب هنوز کامل نشده است — در ادامه نسخه اصلی انگلیسی نمایش داده می‌شود." : "The English edition of this post is not complete yet — the Persian original is shown below."}</p>}
            <ArticleBody value={localText(selected, fa, "body")} />
            {selected.sources.length > 0 && <footer><strong>{L("Sources", "منابع")}</strong>{selected.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">↗ {source.title}</a>)}</footer>}
            <CommentSection platform={platform} postId={selected.id} locale={locale} />
          </div>
        </article>}
      </section>}

    {!user && demoAvailable && <section className="heritage-demo-admin panel"><div><span className="eyebrow">DEMO</span><h2>{L("Want to try publishing?", "می‌خواهید انتشار مطلب را امتحان کنید؟")}</h2><p>{L("Use the one-click local demo administrator, then open the Editorial Studio.", "با یک کلیک وارد حساب مدیر دمو شوید و استودیوی تحریریه را باز کنید.")}</p></div><button className="primary" onClick={() => void demoLogin()} disabled={busy === "login"}>{L("Login as Demo Admin", "ورود به‌عنوان مدیر دمو")}</button></section>}
  </main>;
}
