import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  createAdminContent, listPublicComments, createPublicComment, listAdminComments, moderateAdminComment,
} from "../../src/content/api";
import { openRealDatabase, seedUser, makeSession, authedRequest, type AuthedSession } from "../helpers/realDatabase";
import type { ContentComment, ContentPost, ContentPostInput } from "../../src/contracts/platform";

/**
 * Turn 30 evidence — the newsroom comment surface on a REAL database with every
 * migration applied (including 0099 content_comments).
 *
 * Acceptance pins:
 *  1. The public comments route serves ONLY published comments of a published
 *     post, oldest first — pending and hidden rows never leak.
 *  2. An open visitor submission lands as 'pending' and is NOT visible on the
 *     public route until an editor approves it (no self-publishing path).
 *  3. The admin moderation queue lists rows filterable by status and the
 *     approve/hide/delete actions change visibility accordingly.
 *  4. Comments for an unknown/unpublished post 404.
 */

const envOf = (db: D1Database): Env => ({ DB: db, SESSION_COOKIE_NAME: "hr_session", ASSETS: undefined as unknown as Fetcher, APP_ENV: "test" });

interface World {
  db: D1Database; env: Env;
  editor: AuthedSession;
}

async function world(): Promise<World> {
  const db = await openRealDatabase();
  await seedUser(db, "t30-editor", "admin");
  return { db, env: envOf(db), editor: await makeSession(db, "t30-editor") };
}

function postInput(overrides: Partial<ContentPostInput> = {}): ContentPostInput {
  return {
    kind: "news", status: "published",
    title_en: "Turn 30 comment fixture post", title_fa: "پست نمونه دیدگاه‌های نوبت ۳۰",
    summary_en: "Fixture summary.", summary_fa: "خلاصه نمونه.",
    body_en: "Fixture body with enough substance for the comment workflow test.", body_fa: "متن نمونه با موضوع اسب ایرانی.",
    tags: ["turn30"], sources: [],
    cover_image_url: null, cover_image_alt_en: null, cover_image_alt_fa: null,
    cover_image_credit: null, cover_image_source_url: null,
    ai_model: null, ai_grounding: false, ai_prompt: null,
    ...overrides,
  };
}

async function createPublishedPost(w: World, input: ContentPostInput = postInput()): Promise<ContentPost> {
  const response = await createAdminContent(authedRequest("/api/admin/content/posts", input, { session: w.editor }), w.env);
  expect(response.status).toBe(201);
  return (await response.json() as { post: ContentPost }).post;
}

async function getComments(w: World, postId: string): Promise<{ status: number; comments: ContentComment[] }> {
  try {
    const response = await listPublicComments(w.db, postId, new URL(`https://registry.example/api/content/posts/${postId}/comments`));
    const body = await response.json() as { comments: ContentComment[] };
    return { status: response.status, comments: body.comments };
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    expect(status).toBe(404);
    return { status, comments: [] };
  }
}

async function submit(w: World, postId: string, body: Record<string, unknown>): Promise<{ status: number; body?: Record<string, unknown> }> {
  try {
    const response = await createPublicComment(new Request("https://registry.example/api/content/posts/x/comments", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), w.env, postId);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } catch (err) {
    return { status: (err as { status?: number }).status ?? 500 };
  }
}

describe("turn 30: newsroom comments", () => {
  it("keeps pending visitor submissions invisible until an editor approves them", async () => {
    const w = await world();
    const post = await createPublishedPost(w);
    const submitted = await submit(w, post.id, { author_name: "امیر رضایی", body: "تبریک به قهرمان و همه داوران، رقابت سختی بود." });
    expect(submitted.status).toBe(201);
    const submittedBody = submitted.body as unknown as { ok: true; comment: ContentComment; moderation: "pending" };
    expect(submittedBody.moderation).toBe("pending");
    expect(submittedBody.comment.status).toBe("pending");

    // not public yet
    const before = await getComments(w, post.id);
    expect(before.comments).toHaveLength(0);

    // editor approves through the moderation route
    const approve = await moderateAdminComment(
      authedRequest(`/api/admin/content/comments/${submittedBody.comment.id}/moderate`, { action: "approve" }, { session: w.editor }),
      w.env, submittedBody.comment.id,
    );
    expect(approve.status).toBe(200);
    const after = await getComments(w, post.id);
    expect(after.comments).toHaveLength(1);
    expect(after.comments[0]!.status).toBe("published");
    expect(after.comments[0]!.author_name).toBe("امیر رضایی");
  });

  it("serves published rows oldest-first and never leaks pending or hidden", async () => {
    const w = await world();
    const post = await createPublishedPost(w);
    // seed directly: two published + one hidden + one pending
    await w.db.prepare("INSERT INTO content_comments(id,post_id,author_name,body,locale,likes,status,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind("cmt-b", post.id, "زهرا محمدی", "گزارش خوبی بود، ممنون", "fa", 3, "published", "2026-10-02T08:00:00Z").run();
    await w.db.prepare("INSERT INTO content_comments(id,post_id,author_name,body,locale,likes,status,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind("cmt-a", post.id, "مهدی صادقی", "دنبال نتیجه این کورس بودم", "fa", 0, "published", "2026-10-01T07:30:00Z").run();
    await w.db.prepare("INSERT INTO content_comments(id,post_id,author_name,body,locale,likes,status,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind("cmt-h", post.id, "تست پنهان", "این دیدگاه مخفی است", "fa", 0, "hidden", "2026-10-01T09:00:00Z").run();
    await w.db.prepare("INSERT INTO content_comments(id,post_id,author_name,body,locale,likes,status,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind("cmt-p", post.id, "تست در انتظار", "این دیدگاه در انتظار است", "fa", 0, "pending", "2026-10-01T10:00:00Z").run();
    const { comments } = await getComments(w, post.id);
    expect(comments.map(c => c.id)).toEqual(["cmt-a", "cmt-b"]);
  });

  it("404s comments for an unknown post and validates submissions", async () => {
    const w = await world();
    const missing = await getComments(w, "no-such-post");
    expect(missing.status).toBe(404);
    const tooShort = await submit(w, "no-such-post", { author_name: "الف", body: "ک" });
    expect(tooShort.status).toBe(404); // unknown post wins over validation
    const post = await createPublishedPost(w);
    const invalid = await submit(w, post.id, { author_name: "ب", body: "کو" });
    expect(invalid.status).toBe(400);
  });

  it("supports hide + delete moderation actions and status-filtered queues", async () => {
    const w = await world();
    const post = await createPublishedPost(w);
    await w.db.prepare("INSERT INTO content_comments(id,post_id,author_name,body,locale,likes,status,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind("cmt-1", post.id, "رضا قاسمی", "دیدگاه نخست", "fa", 1, "pending", "2026-10-03T10:00:00Z").run();
    await w.db.prepare("INSERT INTO content_comments(id,post_id,author_name,body,locale,likes,status,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind("cmt-2", post.id, "نیلوفر احمدی", "دیدگاه دوم", "fa", 2, "published", "2026-10-03T11:00:00Z").run();
    const queue = await listAdminComments(
      authedRequest("/api/admin/content/comments?status=pending", undefined, { session: w.editor }), w.env,
      new URL("https://registry.example/api/admin/content/comments?status=pending"),
    );
    const queueBody = await queue.json() as { comments: ContentComment[] };
    expect(queueBody.comments.map(c => c.id)).toEqual(["cmt-1"]);

    await moderateAdminComment(authedRequest("/api/admin/content/comments/cmt-1/moderate", { action: "hide" }, { session: w.editor }), w.env, "cmt-1");
    await moderateAdminComment(authedRequest("/api/admin/content/comments/cmt-2/moderate", { action: "delete" }, { session: w.editor }), w.env, "cmt-2");
    const { comments } = await getComments(w, post.id);
    expect(comments).toHaveLength(0);
  });
});
