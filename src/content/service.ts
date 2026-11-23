import type { ContentPost, ContentPostInput, ContentPostKind, ContentPostStatus, ContentLanguageStatus, ContentMediaRights, ContentPostRevision, ContentRevisionCause, ContentSource, ContentComment } from "../contracts/platform";

interface ContentPostRow {
  id: string;
  slug: string;
  kind: ContentPostKind;
  status: ContentPostStatus;
  title_en: string;
  title_fa: string;
  title_ar: string;
  title_zh: string;
  summary_en: string;
  summary_fa: string;
  summary_ar: string;
  summary_zh: string;
  body_en: string;
  body_fa: string;
  body_ar: string;
  body_zh: string;
  tags_json: string;
  sources_json: string;
  cover_image_url: string | null;
  cover_image_alt_en: string | null;
  cover_image_alt_fa: string | null;
  cover_image_credit: string | null;
  cover_image_source_url: string | null;
  author_user_id: string | null;
  author_label: string | null;
  ai_model: string | null;
  ai_grounding: number;
  ai_prompt: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  row_version: number;
}

export function decodeContentPost(row: Record<string, unknown>): ContentPost {
  const r = row as unknown as ContentPostRow;
  const title_en = r.title_en ?? "";
  const title_fa = r.title_fa ?? "";
  const title_ar = r.title_ar ?? "";
  const title_zh = r.title_zh ?? "";
  const body_en = r.body_en ?? "";
  const body_fa = r.body_fa ?? "";
  const body_ar = r.body_ar ?? "";
  const body_zh = r.body_zh ?? "";
  const cover_image_url = r.cover_image_url ?? null;
  const cover_image_credit = r.cover_image_credit ?? null;
  const cover_image_source_url = r.cover_image_source_url ?? null;
  return {
    id: r.id,
    slug: r.slug,
    kind: r.kind,
    status: r.status,
    title_en,
    title_fa,
    title_ar,
    title_zh,
    summary_en: r.summary_en ?? "",
    summary_fa: r.summary_fa ?? "",
    summary_ar: r.summary_ar ?? "",
    summary_zh: r.summary_zh ?? "",
    body_en,
    body_fa,
    body_ar,
    body_zh,
    tags: parseStringArray(r.tags_json),
    sources: parseSources(r.sources_json),
    cover_image_url,
    cover_image_alt_en: r.cover_image_alt_en ?? null,
    cover_image_alt_fa: r.cover_image_alt_fa ?? null,
    cover_image_credit,
    cover_image_source_url,
    author_user_id: r.author_user_id,
    author_label: r.author_label,
    ai_model: r.ai_model,
    ai_grounding: Boolean(r.ai_grounding),
    ai_prompt: r.ai_prompt,
    created_at: r.created_at,
    updated_at: r.updated_at,
    published_at: r.published_at,
    row_version: Number(r.row_version || 1),
    language_completeness: {
      en: contentLanguageStatus(title_en, body_en),
      fa: contentLanguageStatus(title_fa, body_fa),
      ar: contentLanguageStatus(title_ar, body_ar),
      zh: contentLanguageStatus(title_zh, body_zh),
    },
    media_publication_rights: contentMediaRights(cover_image_url, cover_image_credit, cover_image_source_url),
  };
}

/** R117-17: honest per-language readiness — "complete" needs BOTH title and
 * body; "partial" exactly one; "missing" neither. Never inferred from the
 * publication status, so an English publication cannot claim a finished
 * Persian translation. */
export function contentLanguageStatus(title: string, body: string): ContentLanguageStatus {
  const hasTitle = Boolean(title && title.trim());
  const hasBody = Boolean(body && body.trim());
  if (hasTitle && hasBody) return "complete";
  if (hasTitle || hasBody) return "partial";
  return "missing";
}

/** R117-17: media-publication rights tracked separately from language
 * completeness — an unattributed cover image is reported as exactly that. */
export function contentMediaRights(coverImageUrl: string | null, coverImageCredit: string | null, coverImageSourceUrl: string | null): ContentMediaRights {
  if (!coverImageUrl || !coverImageUrl.trim()) return "no_media";
  return (coverImageCredit && coverImageCredit.trim()) || (coverImageSourceUrl && coverImageSourceUrl.trim()) ? "attributed" : "unattributed";
}

/** R117-17: append one immutable version-history row for a governed editorial
 * transition. The snapshot stores the RAW database row (tags_json/sources_json
 * intact) so decodeContentPost round-trips it exactly; revision_no mirrors the
 * post's row_version AFTER the change, keeping history aligned with the
 * optimistic-concurrency counter. */
export async function recordContentRevision(db: D1Database, rawRow: Record<string, unknown>, cause: ContentRevisionCause, fromStatus: ContentPostStatus, actorUserId: string | null, actorLabel: string | null): Promise<void> {
  await db.prepare(
    "INSERT INTO content_post_revisions(id, post_id, revision_no, cause, from_status, to_status, actor_user_id, actor_label, snapshot_json) VALUES(?,?,?,?,?,?,?,?,?)",
  ).bind(
    crypto.randomUUID(), String(rawRow.id), Number(rawRow.row_version || 1), cause, fromStatus, String(rawRow.status),
    actorUserId ?? null, actorLabel ?? null, JSON.stringify(rawRow),
  ).run();
}

interface ContentRevisionRow {
  id: string;
  post_id: string;
  revision_no: number;
  cause: ContentRevisionCause;
  from_status: ContentPostStatus;
  to_status: ContentPostStatus;
  actor_user_id: string | null;
  actor_label: string | null;
  snapshot_json: string;
  created_at: string;
}

export function decodeContentRevision(row: Record<string, unknown>): ContentPostRevision {
  const r = row as unknown as ContentRevisionRow;
  // Snapshots are written by recordContentRevision from our own SELECT — a
  // corrupt snapshot is a server integrity failure and must fail loud, not
  // silently render a null post.
  const snapshot = decodeContentPost(JSON.parse(r.snapshot_json) as Record<string, unknown>);
  return {
    id: r.id,
    post_id: r.post_id,
    revision_no: Number(r.revision_no || 0),
    cause: r.cause,
    from_status: r.from_status,
    to_status: r.to_status,
    actor_user_id: r.actor_user_id ?? null,
    actor_label: r.actor_label ?? null,
    created_at: r.created_at,
    post: snapshot,
  };
}

export function contentJson(value: unknown): string {
  return JSON.stringify(value ?? []);
}

/** Turn 30: decode a content_comments row into the public contract shape. */
export function decodeContentComment(row: Record<string, unknown>): ContentComment {
  const r = row as unknown as Record<string, string | number | null>;
  const locale = r.locale === "en" || r.locale === "ar" || r.locale === "zh" ? r.locale : "fa";
  return {
    id: String(r.id),
    post_id: String(r.post_id),
    author_name: String(r.author_name ?? ""),
    body: String(r.body ?? ""),
    locale,
    likes: Number(r.likes || 0),
    status: (r.status === "pending" || r.status === "hidden" ? r.status : "published") as ContentComment["status"],
    created_at: String(r.created_at ?? ""),
  };
}

export function makeCommentId(): string {
  return `cmt_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

export function makeContentId(): string {
  return crypto.randomUUID();
}

export function makeContentSlug(title: string, id: string): string {
  const ascii = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
  const prefix = ascii || "horse-db-post";
  return `${prefix}-${id.replaceAll("-", "").slice(0, 8)}`;
}

export function normalizeContentInput(input: ContentPostInput): ContentPostInput {
  return {
    ...input,
    title_en: input.title_en.trim(),
    title_fa: input.title_fa.trim(),
    title_ar: (input.title_ar ?? "").trim(),
    title_zh: (input.title_zh ?? "").trim(),
    summary_en: input.summary_en.trim(),
    summary_fa: input.summary_fa.trim(),
    summary_ar: (input.summary_ar ?? "").trim(),
    summary_zh: (input.summary_zh ?? "").trim(),
    body_en: input.body_en.trim(),
    body_fa: input.body_fa.trim(),
    body_ar: (input.body_ar ?? "").trim(),
    body_zh: (input.body_zh ?? "").trim(),
    tags: [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))].slice(0, 12),
    sources: dedupeSources(input.sources).slice(0, 12),
    cover_image_url: cleanOptional(input.cover_image_url),
    cover_image_alt_en: cleanOptional(input.cover_image_alt_en),
    cover_image_alt_fa: cleanOptional(input.cover_image_alt_fa),
    cover_image_credit: cleanOptional(input.cover_image_credit),
    cover_image_source_url: cleanOptional(input.cover_image_source_url),
  };
}

function parseStringArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function parseSources(raw: string): ContentSource[] {
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ContentSource => Boolean(item && typeof item === "object" && typeof item.url === "string" && typeof item.title === "string"));
  } catch { return []; }
}

function dedupeSources(sources: ContentSource[]): ContentSource[] {
  const seen = new Set<string>();
  return sources.filter(source => {
    const url = source.url.trim();
    if (!url || seen.has(url)) return false;
    seen.add(url);
    source.url = url;
    source.title = source.title.trim() || url;
    return true;
  });
}

function cleanOptional(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}
