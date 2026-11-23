import { z } from "zod";
import { HttpError, json, readJson, requestId } from "../api/http";
import { requireCsrf, requirePermission } from "../auth/guards";
import type {
  AiContentGenerateInput,
  ContentListResponse,
  ContentPost,
  ContentPostInput,
  ContentPostKind,
  ContentPostStatus,
  ContentPreviewResponse,
  ContentRevisionsResponse,
  ContentCommentsResponse,
  ContentCommentSubmitResponse,
  ContentAdminCommentsResponse,
} from "../contracts/platform";
import { generateBilingualContent } from "./generate";
import { AI_CONTENT_MODELS } from "./aiShared";
import { contentJson, contentLanguageStatus, decodeContentPost, decodeContentRevision, decodeContentComment, makeContentId, makeContentSlug, makeCommentId, normalizeContentInput, recordContentRevision } from "./service";

const ContentInputSchema = z.object({
  kind: z.enum(["article", "news", "update"]),
  status: z.enum(["draft", "published", "archived"]),
  title_en: z.string().trim().min(1).max(220),
  // R117-17: the Persian edition may legitimately be unfinished while the
  // English edition is complete — staged bilingual publishing. The Persian
  // readiness is reported honestly (language_completeness), never fabricated.
  // Turn 28: ar/zh editions join the same honest-readiness model.
  title_fa: z.string().trim().max(220),
  title_ar: z.string().trim().max(220).optional(),
  title_zh: z.string().trim().max(220).optional(),
  summary_en: z.string().trim().max(1000),
  summary_fa: z.string().trim().max(1000),
  summary_ar: z.string().trim().max(600).optional(),
  summary_zh: z.string().trim().max(600).optional(),
  body_en: z.string().trim().min(1).max(50000),
  body_fa: z.string().trim().max(50000),
  body_ar: z.string().trim().max(50000).optional(),
  body_zh: z.string().trim().max(50000).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(12),
  sources: z.array(z.object({ title: z.string().trim().min(1).max(300), url: z.string().url().max(2000) })).max(12),
  cover_image_url: z.string().trim().max(2000).nullable().optional(),
  cover_image_alt_en: z.string().trim().max(500).nullable().optional(),
  cover_image_alt_fa: z.string().trim().max(500).nullable().optional(),
  cover_image_credit: z.string().trim().max(500).nullable().optional(),
  cover_image_source_url: z.string().trim().max(2000).nullable().optional(),
  ai_model: z.string().trim().max(120).nullable().optional(),
  ai_grounding: z.boolean().optional(),
  ai_prompt: z.string().trim().max(4000).nullable().optional(),
});

const ContentUpdateSchema = z.object({
  expected_row_version: z.number().int().positive(),
  post: ContentInputSchema,
});

/** R117-17: the CAS payload for the explicit publish/retract actions. */
const ContentTransitionSchema = z.object({
  expected_row_version: z.number().int().positive(),
}).strict();

const AiGenerateSchema = z.object({
  model: z.enum(AI_CONTENT_MODELS),
  grounding: z.boolean(),
  kind: z.enum(["article", "news", "update"]),
  topic: z.string().trim().max(4000).optional(),
});

/** Turn 30: public visitor comment submission — validated, queued as 'pending',
 * never auto-published. The comment section shows only approved rows. */
const CommentSubmitSchema = z.object({
  author_name: z.string().trim().min(2).max(60),
  body: z.string().trim().min(3).max(2000),
  locale: z.enum(["fa", "en", "ar", "zh"]).optional(),
});

export async function listPublicContent(db: D1Database, url: URL): Promise<Response> {
  const kind = parseKind(url.searchParams.get("kind"));
  const limit = bounded(url.searchParams.get("limit"), 12, 1, 50);
  const offset = bounded(url.searchParams.get("offset"), 0, 0, 1000000);
  const { posts, total } = await queryPosts(db, { kind, status: "published", limit, offset });
  return json({ posts, total, limit, offset } satisfies ContentListResponse);
}

export async function getPublicContent(db: D1Database, slug: string): Promise<Response> {
  const row = await db.prepare("SELECT * FROM content_posts WHERE slug=? AND status='published'").bind(slug).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, "content_not_found", "Post not found");
  return json({ post: decodeContentPost(row) });
}

/** Turn 30: published comments for a post, oldest first (conversation order). */
export async function listPublicComments(db: D1Database, postId: string, url: URL): Promise<Response> {
  const post = await db.prepare("SELECT id FROM content_posts WHERE id=? AND status='published'").bind(postId).first<{ id: string }>();
  if (!post) throw new HttpError(404, "content_not_found", "Post not found");
  // bounded() maps Number(null)=0 to its min bound — an absent ?limit must hit
  // the DEFAULT, so parse the absent case before bounded().
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw === null ? 200 : bounded(limitRaw, 200, 1, 500);
  const result = await db.prepare(
    "SELECT * FROM content_comments WHERE post_id=? AND status='published' ORDER BY created_at ASC LIMIT ?"
  ).bind(postId, limit).all();
  const comments = (result.results ?? []).map(row => decodeContentComment(row as Record<string, unknown>));
  return json({ comments, total: comments.length } satisfies ContentCommentsResponse);
}

/** Turn 30: open visitor submission — lands as 'pending' (invisible publicly
 * until an editor approves it through the admin moderation route). */
export async function createPublicComment(request: Request, env: Env, postId: string): Promise<Response> {
  const post = await env.DB.prepare("SELECT id FROM content_posts WHERE id=? AND status='published'").bind(postId).first<{ id: string }>();
  if (!post) throw new HttpError(404, "content_not_found", "Post not found");
  const parsed = CommentSubmitSchema.safeParse(await readJson<unknown>(request, 32 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_comment", "Comment failed validation", parsed.error.flatten());
  const id = makeCommentId();
  const row = {
    id, post_id: postId, author_name: parsed.data.author_name, body: parsed.data.body,
    locale: parsed.data.locale ?? "fa", likes: 0, status: "pending", created_at: new Date().toISOString(),
  };
  await env.DB.prepare(
    "INSERT INTO content_comments(id,post_id,author_name,body,locale,likes,status,created_at) VALUES(?,?,?,?,?,?,?,?)"
  ).bind(row.id, row.post_id, row.author_name, row.body, row.locale, row.likes, row.status, row.created_at).run();
  return json({ ok: true as const, comment: decodeContentComment(row), moderation: "pending" as const } satisfies ContentCommentSubmitResponse, { status: 201 });
}

/** Turn 30: admin moderation queue (newest first, filterable by status). */
export async function listAdminComments(request: Request, env: Env, url: URL): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
  const statusParam = url.searchParams.get("status");
  const status = statusParam === "pending" || statusParam === "hidden" || statusParam === "published" ? statusParam : undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw === null ? 100 : bounded(limitRaw, 100, 1, 500);
  const result = status
    ? await env.DB.prepare("SELECT * FROM content_comments WHERE status=? ORDER BY created_at DESC LIMIT ?").bind(status, limit).all()
    : await env.DB.prepare("SELECT * FROM content_comments ORDER BY created_at DESC LIMIT ?").bind(limit).all();
  const comments = (result.results ?? []).map(row => decodeContentComment(row as Record<string, unknown>));
  return json({ comments, total: comments.length } satisfies ContentAdminCommentsResponse);
}

/** Turn 30: admin moderation action — approve (pending/hidden -> published),
 * hide (-> hidden), or delete the row outright. */
export async function moderateAdminComment(request: Request, env: Env, commentId: string): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
  requireCsrf(request, auth);
  const parsed = z.object({ action: z.enum(["approve", "hide", "delete"]) }).safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_comment_moderation", "Moderation action failed validation", parsed.error.flatten());
  if (parsed.data.action === "delete") {
    const result = await env.DB.prepare("DELETE FROM content_comments WHERE id=?").bind(commentId).run();
    if (!result.meta.changes) throw new HttpError(404, "comment_not_found", "Comment not found");
    return json({ ok: true });
  }
  const nextStatus = parsed.data.action === "approve" ? "published" : "hidden";
  const result = await env.DB.prepare("UPDATE content_comments SET status=? WHERE id=?").bind(nextStatus, commentId).run();
  if (!result.meta.changes) throw new HttpError(404, "comment_not_found", "Comment not found");
  return json({ ok: true });
}

export async function listAdminContent(request: Request, env: Env, url: URL): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
  const kind = parseKind(url.searchParams.get("kind"));
  const status = parseStatus(url.searchParams.get("status"));
  const limit = bounded(url.searchParams.get("limit"), 50, 1, 100);
  const offset = bounded(url.searchParams.get("offset"), 0, 0, 1000000);
  const { posts, total } = await queryPosts(env.DB, { kind, status, limit, offset });
  return json({ posts, total, limit, offset } satisfies ContentListResponse);
}

export async function createAdminContent(request: Request, env: Env): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
  requireCsrf(request, auth);
  const parsed = ContentInputSchema.safeParse(await readJson<unknown>(request, 128 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_content_post", "Post data failed validation", parsed.error.flatten());
  const input = normalizeContentInput(parsed.data);
  // R117-17: one publication policy, no bypass — publishing (directly or via
  // the explicit action) requires a complete English edition; the Persian
  // edition may still be incomplete and is reported honestly.
  assertEnglishEditionComplete(input);
  const { post, row } = await insertPost(env.DB, input, auth.user.id, auth.user.display_name);
  await recordContentRevision(env.DB, row, "create", post.status, auth.user.id, auth.user.display_name);
  await auditContent(env.DB, auth.user.id, "content.create", post, request);
  return json({ post }, { status: 201 });
}

export async function updateAdminContent(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
  requireCsrf(request, auth);
  const parsed = ContentUpdateSchema.safeParse(await readJson<unknown>(request, 128 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_content_post", "Post data failed validation", parsed.error.flatten());
  const current = await env.DB.prepare("SELECT * FROM content_posts WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!current) throw new HttpError(404, "content_not_found", "Post not found");
  const before = decodeContentPost(current);
  if (before.row_version !== parsed.data.expected_row_version) throw new HttpError(409, "edit_conflict", "This post was changed by someone else. Reload before saving.", { current_row_version: before.row_version });
  const input = normalizeContentInput(parsed.data.post);
  // R117-17: the update path cannot smuggle an incomplete English edition into
  // the public state — the same guard as the explicit publish action.
  assertEnglishEditionComplete(input);
  const result = await env.DB.prepare(`
    UPDATE content_posts SET
      kind=?,status=?,title_en=?,title_fa=?,title_ar=?,title_zh=?,summary_en=?,summary_fa=?,summary_ar=?,summary_zh=?,body_en=?,body_fa=?,body_ar=?,body_zh=?,tags_json=?,sources_json=?,
      cover_image_url=?,cover_image_alt_en=?,cover_image_alt_fa=?,cover_image_credit=?,cover_image_source_url=?,
      ai_model=?,ai_grounding=?,ai_prompt=?,author_user_id=?,author_label=?,
      published_at=CASE WHEN ?='published' THEN COALESCE(published_at,CURRENT_TIMESTAMP) ELSE published_at END,
      updated_at=CURRENT_TIMESTAMP,row_version=row_version+1
    WHERE id=? AND row_version=?
  `).bind(
    input.kind,input.status,input.title_en,input.title_fa,input.title_ar??"",input.title_zh??"",input.summary_en,input.summary_fa,input.summary_ar??"",input.summary_zh??"",input.body_en,input.body_fa,input.body_ar??"",input.body_zh??"",
    contentJson(input.tags),contentJson(input.sources),input.cover_image_url??null,input.cover_image_alt_en??null,input.cover_image_alt_fa??null,input.cover_image_credit??null,input.cover_image_source_url??null,input.ai_model??null,input.ai_grounding?1:0,input.ai_prompt??null,
    auth.user.id,auth.user.display_name,input.status,id,parsed.data.expected_row_version,
  ).run();
  if (!result.meta.changes) throw new HttpError(409, "edit_conflict", "This post changed before your save completed");
  const row = await env.DB.prepare("SELECT * FROM content_posts WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, "content_not_found", "Post not found");
  const post = decodeContentPost(row);
  await recordContentRevision(env.DB, row, "update", before.status, auth.user.id, auth.user.display_name);
  await auditContent(env.DB, auth.user.id, "content.update", post, request, before);
  return json({ post });
}

/** R117-17: the editor-only preview — any saved post (including drafts) is
 * rendered for a content manager, while the public read routes keep serving
 * only the published projection. Never indexed: the preview surface is gated
 * behind content.manage and carries no public URL. */
export async function previewAdminContent(request: Request, env: Env, id: string): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
  const row = await env.DB.prepare("SELECT * FROM content_posts WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, "content_not_found", "Post not found");
  const post = decodeContentPost(row);
  return json({ post, preview: true } satisfies ContentPreviewResponse);
}

/** R117-17: the explicit human publish action — draft/archived -> published
 * under optimistic concurrency, recording the version-history row. */
export async function publishAdminContent(request: Request, env: Env, id: string): Promise<Response> {
  return transitionAdminContent(request, env, id, "publish");
}

/** R117-17: retract a publication — published -> archived under optimistic
 * concurrency; public reads stop serving the post immediately and the
 * retraction stays visible after reload. */
export async function retractAdminContent(request: Request, env: Env, id: string): Promise<Response> {
  return transitionAdminContent(request, env, id, "retract");
}

async function transitionAdminContent(request: Request, env: Env, id: string, action: "publish" | "retract"): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
  requireCsrf(request, auth);
  const parsed = ContentTransitionSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_content_transition", `${action === "publish" ? "Publish" : "Retract"} request failed validation`, parsed.error.flatten());
  const current = await env.DB.prepare("SELECT * FROM content_posts WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!current) throw new HttpError(404, "content_not_found", "Post not found");
  const before = decodeContentPost(current);
  if (before.row_version !== parsed.data.expected_row_version) {
    throw new HttpError(409, "edit_conflict", `This post was changed by someone else. Reload before ${action === "publish" ? "publishing" : "retracting"}.`, { current_row_version: before.row_version });
  }
  if (action === "publish") {
    if (before.status === "published") throw new HttpError(409, "content_invalid_transition", "This post is already published");
    // The stored English edition is the publishable one — never the editor's
    // unsaved buffer. An English publication never claims a completed Persian
    // translation: language_completeness reports the Persian edition as-is.
    if (before.language_completeness.en !== "complete") {
      throw new HttpError(400, "content_publish_incomplete", "A complete English edition (title and body) is required before publishing", { language_completeness: before.language_completeness });
    }
  } else if (before.status !== "published") {
    throw new HttpError(409, "content_invalid_transition", "Only a published post can be retracted");
  }
  const nextStatus: ContentPostStatus = action === "publish" ? "published" : "archived";
  const result = await env.DB.prepare(`
    UPDATE content_posts SET
      status=?,
      published_at=CASE WHEN ?='published' THEN COALESCE(published_at,CURRENT_TIMESTAMP) ELSE published_at END,
      updated_at=CURRENT_TIMESTAMP,row_version=row_version+1
    WHERE id=? AND row_version=?
  `).bind(nextStatus, nextStatus, id, parsed.data.expected_row_version).run();
  if (!result.meta.changes) throw new HttpError(409, "edit_conflict", "This post changed before your action completed");
  const row = await env.DB.prepare("SELECT * FROM content_posts WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, "content_not_found", "Post not found");
  const post = decodeContentPost(row);
  await recordContentRevision(env.DB, row, action, before.status, auth.user.id, auth.user.display_name);
  await auditContent(env.DB, auth.user.id, `content.${action}`, post, request, before);
  return json({ post });
}

/** R117-17: the immutable per-post version history, newest first. */
export async function listAdminContentRevisions(request: Request, env: Env, id: string): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
  const post = await env.DB.prepare("SELECT id FROM content_posts WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!post) throw new HttpError(404, "content_not_found", "Post not found");
  const result = await env.DB.prepare("SELECT * FROM content_post_revisions WHERE post_id=? ORDER BY revision_no DESC LIMIT 200").bind(id).all();
  const revisions = (result.results ?? []).map(row => decodeContentRevision(row as Record<string, unknown>));
  return json({ revisions, total: revisions.length } satisfies ContentRevisionsResponse);
}

export async function generateAdminContent(request: Request, env: Env): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
  requireCsrf(request, auth);
  const parsed = AiGenerateSchema.safeParse(await readJson<unknown>(request, 32 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_ai_content_request", "AI content request failed validation", parsed.error.flatten());
  const input = parsed.data satisfies AiContentGenerateInput;
  const generated = await generateBilingualContent(input, env);
  // AI generation is draft-only. Publishing remains a separate human editor action.
  const draft = normalizeContentInput({ ...generated.draft, status: "draft" });
  return json({ draft, post: null, sources: generated.sources, warnings: generated.warnings ?? [], attempts: generated.attempts ?? [] });
}

async function insertPost(db: D1Database, input: ContentPostInput, authorUserId: string, authorLabel: string): Promise<{ post: ContentPost; row: Record<string, unknown> }> {
  const id = makeContentId();
  const slug = makeContentSlug(input.title_en, id);
  await db.prepare(`
    INSERT INTO content_posts(
      id,slug,kind,status,title_en,title_fa,title_ar,title_zh,summary_en,summary_fa,summary_ar,summary_zh,body_en,body_fa,body_ar,body_zh,tags_json,sources_json,
      cover_image_url,cover_image_alt_en,cover_image_alt_fa,cover_image_credit,cover_image_source_url,
      author_user_id,author_label,ai_model,ai_grounding,ai_prompt,published_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='published' THEN CURRENT_TIMESTAMP ELSE NULL END)
  `).bind(
    id,slug,input.kind,input.status,input.title_en,input.title_fa,input.title_ar??"",input.title_zh??"",input.summary_en,input.summary_fa,input.summary_ar??"",input.summary_zh??"",input.body_en,input.body_fa,input.body_ar??"",input.body_zh??"",
    contentJson(input.tags),contentJson(input.sources),input.cover_image_url??null,input.cover_image_alt_en??null,input.cover_image_alt_fa??null,input.cover_image_credit??null,input.cover_image_source_url??null,authorUserId,authorLabel,input.ai_model??null,input.ai_grounding?1:0,input.ai_prompt??null,input.status,
  ).run();
  const row = await db.prepare("SELECT * FROM content_posts WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!row) throw new HttpError(500, "content_create_failed", "Post was created but could not be reloaded");
  return { post: decodeContentPost(row), row };
}

/** R117-17: the single publication policy — a post may only enter the public
 * state (published, via create, update or the explicit publish action) with a
 * complete English edition. The Persian edition is independently tracked so an
 * English publication never claims a completed Persian translation. */
function assertEnglishEditionComplete(input: ContentPostInput): void {
  if (input.status === "published" && contentLanguageStatus(input.title_en, input.body_en) !== "complete") {
    throw new HttpError(400, "content_publish_incomplete", "A complete English edition (title and body) is required before publishing", {
      language_completeness: {
        en: contentLanguageStatus(input.title_en, input.body_en),
        fa: contentLanguageStatus(input.title_fa, input.body_fa),
        ar: contentLanguageStatus(input.title_ar ?? "", input.body_ar ?? ""),
        zh: contentLanguageStatus(input.title_zh ?? "", input.body_zh ?? ""),
      },
    });
  }
}

async function queryPosts(db: D1Database, params: { kind?: ContentPostKind; status?: ContentPostStatus; limit: number; offset: number }): Promise<{ posts: ContentPost[]; total: number }> {
  const clauses: string[] = [];
  const bindings: unknown[] = [];
  if (params.kind) { clauses.push("kind=?"); bindings.push(params.kind); }
  if (params.status) { clauses.push("status=?"); bindings.push(params.status); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [countResult, listResult] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS count FROM content_posts ${where}`).bind(...bindings),
    db.prepare(`SELECT * FROM content_posts ${where} ORDER BY CASE WHEN published_at IS NULL THEN 1 ELSE 0 END, published_at DESC, created_at DESC LIMIT ? OFFSET ?`).bind(...bindings, params.limit, params.offset),
  ]);
  const total = Number((countResult.results[0] as { count?: number } | undefined)?.count ?? 0);
  return { posts: listResult.results.map(row => decodeContentPost(row as Record<string, unknown>)), total };
}

async function auditContent(db: D1Database, actorUserId: string, action: string, post: ContentPost, request: Request, before?: ContentPost): Promise<void> {
  await db.prepare("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) VALUES(?,?,?,?,?,?,?)")
    .bind(actorUserId, action, "content_post", post.id, before ? JSON.stringify(before) : null, JSON.stringify(post), requestId(request)).run();
}

function parseKind(value: string | null): ContentPostKind | undefined {
  return value === "article" || value === "news" || value === "update" ? value : undefined;
}
function parseStatus(value: string | null): ContentPostStatus | undefined {
  return value === "draft" || value === "published" || value === "archived" ? value : undefined;
}
function bounded(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
