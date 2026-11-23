import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  createAdminContent, updateAdminContent, previewAdminContent, publishAdminContent, retractAdminContent,
  listAdminContentRevisions, listAdminContent, listPublicContent, getPublicContent,
} from "../../src/content/api";
import { openRealDatabase, seedUser, makeSession, authedRequest, type AuthedSession } from "../helpers/realDatabase";
import type { ContentPost, ContentPostInput, ContentPostRevision } from "../../src/contracts/platform";

/**
 * R117-17 evidence (Master AI R117 handoff D26) — the complete bilingual
 * editorial workflow on a REAL database with every migration applied
 * (including 0090 content_post_revisions).
 *
 * Acceptance pins (per the reviewed ticket):
 *  1. Public reads show only the proper publication state — drafts never
 *     appear on the public list/read routes; a retracted post disappears from
 *     both and the retraction stays visible after reload.
 *  2. Stale saves preserve drafts — a CAS conflict refuses with the current
 *     row_version and the stored draft is exactly the winning editor's write;
 *     the losing editor's buffer is never partially applied.
 *  3. EN publication does not claim a completed Persian translation —
 *     language_completeness reports the Persian edition honestly (missing /
 *     partial / complete) on every surface, and media-publication rights are
 *     shown separately from language completeness.
 *  4. Draft preview is editor-only and never exposed through public read
 *     routes; publish and retract are explicit, versioned human actions with
 *     an immutable per-post version history (create/update/publish/retract).
 */

const envOf = (db: D1Database): Env => ({ DB: db, SESSION_COOKIE_NAME: "hr_session", ASSETS: undefined as unknown as Fetcher, APP_ENV: "test" });

interface World {
  db: D1Database; env: Env;
  editor: AuthedSession; editorB: AuthedSession; stranger: AuthedSession;
}

async function world(): Promise<World> {
  const db = await openRealDatabase();
  await seedUser(db, "r17-editor", "admin");
  await seedUser(db, "r17-editor-b", "admin");
  await seedUser(db, "r17-stranger", "user");
  return {
    db, env: envOf(db),
    editor: await makeSession(db, "r17-editor"),
    editorB: await makeSession(db, "r17-editor-b"),
    stranger: await makeSession(db, "r17-stranger"),
  };
}

function englishOnlyDraft(overrides: Partial<ContentPostInput> = {}): ContentPostInput {
  return {
    kind: "news", status: "draft",
    title_en: "R117-17 English headline", title_fa: "", summary_en: "English summary.", summary_fa: "",
    body_en: "English body for the staged bilingual editorial workflow.", body_fa: "",
    tags: ["r117-17"], sources: [],
    cover_image_url: null, cover_image_alt_en: null, cover_image_alt_fa: null,
    cover_image_credit: null, cover_image_source_url: null,
    ai_model: null, ai_grounding: false, ai_prompt: null,
    ...overrides,
  };
}

async function createPost(w: World, input: ContentPostInput, session: AuthedSession = w.editor): Promise<ContentPost> {
  const response = await createAdminContent(authedRequest("/api/admin/content/posts", input, { session }), w.env);
  expect(response.status).toBe(201);
  return (await response.json() as { post: ContentPost }).post;
}

async function publicSlugs(w: World): Promise<string[]> {
  const response = await listPublicContent(w.db, new URL("https://registry.example/api/content/posts?limit=50"));
  const body = await response.json() as { posts: ContentPost[] };
  return body.posts.map(post => post.slug);
}

async function adminRows(w: World): Promise<ContentPost[]> {
  const response = await listAdminContent(authedRequest("/api/admin/content/posts?limit=100", undefined, { session: w.editor }), w.env, new URL("https://registry.example/api/admin/content/posts?limit=100"));
  const body = await response.json() as { posts: ContentPost[] };
  return body.posts;
}

async function revisionsOf(w: World, id: string): Promise<ContentPostRevision[]> {
  const response = await listAdminContentRevisions(authedRequest(`/api/admin/content/posts/${id}/revisions`, undefined, { session: w.editor }), w.env, id);
  expect(response.status).toBe(200);
  return (await response.json() as { revisions: ContentPostRevision[] }).revisions;
}

describe("R117-17 1. staged bilingual drafting with honest, separate indicators", () => {
  it("an English-only draft is valid and reports fa as missing — never claimed complete", async () => {
    const w = await world();
    const post = await createPost(w, englishOnlyDraft());
    expect(post.status).toBe("draft");
    expect(post.language_completeness).toEqual({ en: "complete", fa: "missing", ar: "missing", zh: "missing" });
  });

  it("a partial Persian edition (title only) is reported as partial, not complete", async () => {
    const w = await world();
    const post = await createPost(w, englishOnlyDraft({ title_fa: "تیتر فارسی بدون متن" }));
    expect(post.language_completeness).toEqual({ en: "complete", fa: "partial", ar: "missing", zh: "missing" });
  });

  it("media-publication rights are tracked separately from language completeness", async () => {
    const w = await world();
    const noMedia = await createPost(w, englishOnlyDraft());
    expect(noMedia.media_publication_rights).toBe("no_media");
    const unattributed = await createPost(w, englishOnlyDraft({ cover_image_url: "https://images.example.test/cover.jpg" }));
    expect(unattributed.media_publication_rights).toBe("unattributed");
    expect(unattributed.language_completeness).toEqual({ en: "complete", fa: "missing", ar: "missing", zh: "missing" });
    const attributed = await createPost(w, englishOnlyDraft({
      cover_image_url: "https://images.example.test/cover.jpg",
      cover_image_credit: "Demo Photographer · CC BY 4.0",
      cover_image_source_url: "https://commons.example.test/photo",
    }));
    expect(attributed.media_publication_rights).toBe("attributed");
  });

  it("the old both-languages-required contract is genuinely loosened only for Persian", async () => {
    const w = await world();
    // Persian-only editions are still refused: the canonical English edition is required.
    await expect(createAdminContent(authedRequest("/api/admin/content/posts", englishOnlyDraft({ title_en: "", body_en: "" }), { session: w.editor }), w.env))
      .rejects.toMatchObject({ status: 400, code: "invalid_content_post" });
  });
});

describe("R117-17 2. preview is editor-only; public reads never expose drafts", () => {
  it("the editor can preview a draft; the public list and slug read exclude it", async () => {
    const w = await world();
    const post = await createPost(w, englishOnlyDraft());
    const preview = await previewAdminContent(authedRequest(`/api/admin/content/posts/${post.id}/preview`, undefined, { session: w.editor }), w.env, post.id);
    expect(preview.status).toBe(200);
    const body = await preview.json() as { post: ContentPost; preview: true };
    expect(body.preview).toBe(true);
    expect(body.post.id).toBe(post.id);
    expect(body.post.status).toBe("draft");
    expect(await publicSlugs(w)).not.toContain(post.slug);
    await expect(getPublicContent(w.db, post.slug)).rejects.toMatchObject({ status: 404, code: "content_not_found" });
  });

  it("a principal without content.manage cannot preview, publish, retract or read history", async () => {
    const w = await world();
    const post = await createPost(w, englishOnlyDraft());
    await expect(previewAdminContent(authedRequest(`/api/admin/content/posts/${post.id}/preview`, undefined, { session: w.stranger }), w.env, post.id))
      .rejects.toMatchObject({ status: 403 });
    await expect(publishAdminContent(authedRequest(`/api/admin/content/posts/${post.id}/publish`, { expected_row_version: post.row_version }, { session: w.stranger }), w.env, post.id))
      .rejects.toMatchObject({ status: 403 });
    await expect(retractAdminContent(authedRequest(`/api/admin/content/posts/${post.id}/retract`, { expected_row_version: post.row_version }, { session: w.stranger }), w.env, post.id))
      .rejects.toMatchObject({ status: 403 });
    await expect(listAdminContentRevisions(authedRequest(`/api/admin/content/posts/${post.id}/revisions`, undefined, { session: w.stranger }), w.env, post.id))
      .rejects.toMatchObject({ status: 403 });
    // Anonymous callers are refused identically (no session at all).
    await expect(previewAdminContent(authedRequest(`/api/admin/content/posts/${post.id}/preview`, undefined), w.env, post.id))
      .rejects.toMatchObject({ status: 401 });
  });
});

describe("R117-17 3. publish is an explicit, guarded human action", () => {
  it("publishing a complete English edition serves it publicly while the Persian edition is honestly missing", async () => {
    const w = await world();
    const draft = await createPost(w, englishOnlyDraft());
    const response = await publishAdminContent(authedRequest(`/api/admin/content/posts/${draft.id}/publish`, { expected_row_version: draft.row_version }, { session: w.editor }), w.env, draft.id);
    expect(response.status).toBe(200);
    const published = (await response.json() as { post: ContentPost }).post;
    expect(published.status).toBe("published");
    expect(published.row_version).toBe(draft.row_version + 1);
    expect(published.published_at).toBeTruthy();
    // THE acceptance pin: the English publication does not claim a completed
    // Persian translation — the public projection reports it as missing.
    expect(published.language_completeness).toEqual({ en: "complete", fa: "missing", ar: "missing", zh: "missing" });
    expect(await publicSlugs(w)).toContain(draft.slug);
    const publicRead = await getPublicContent(w.db, draft.slug);
    const publicBody = await publicRead.json() as { post: ContentPost };
    expect(publicBody.post.language_completeness).toEqual({ en: "complete", fa: "missing", ar: "missing", zh: "missing" });
  });

  it("completing the Persian edition later is an honest update, not a re-claim", async () => {
    const w = await world();
    const draft = await createPost(w, englishOnlyDraft());
    await publishAdminContent(authedRequest(`/api/admin/content/posts/${draft.id}/publish`, { expected_row_version: draft.row_version }, { session: w.editor }), w.env, draft.id);
    const updated = await updateAdminContent(authedRequest(`/api/admin/content/posts/${draft.id}`, {
      expected_row_version: 2,
      post: englishOnlyDraft({ status: "published", title_fa: "تیتر فارسی", body_fa: "متن کامل فارسی" }),
    }, { session: w.editor }), w.env, draft.id);
    expect(updated.status).toBe(200);
    const post = (await updated.json() as { post: ContentPost }).post;
    expect(post.language_completeness).toEqual({ en: "complete", fa: "complete", ar: "missing", zh: "missing" });
    const publicRead = await getPublicContent(w.db, draft.slug);
    const publicBody = await publicRead.json() as { post: ContentPost };
    expect(publicBody.post.language_completeness).toEqual({ en: "complete", fa: "complete", ar: "missing", zh: "missing" });
  });

  it("already-published posts refuse a second publish; drafts refuse retract", async () => {
    const w = await world();
    const draft = await createPost(w, englishOnlyDraft());
    await expect(retractAdminContent(authedRequest(`/api/admin/content/posts/${draft.id}/retract`, { expected_row_version: draft.row_version }, { session: w.editor }), w.env, draft.id))
      .rejects.toMatchObject({ status: 409, code: "content_invalid_transition" });
    const published = (await (await publishAdminContent(authedRequest(`/api/admin/content/posts/${draft.id}/publish`, { expected_row_version: draft.row_version }, { session: w.editor }), w.env, draft.id)).json() as { post: ContentPost }).post;
    await expect(publishAdminContent(authedRequest(`/api/admin/content/posts/${draft.id}/publish`, { expected_row_version: published.row_version }, { session: w.editor }), w.env, draft.id))
      .rejects.toMatchObject({ status: 409, code: "content_invalid_transition" });
  });

  it("an English-incomplete row (defense-in-depth: direct DB corruption) can never be published", async () => {
    const w = await world();
    const draft = await createPost(w, englishOnlyDraft());
    // The HTTP schema always requires the English edition; this simulates a
    // corrupted row to prove the server-side publish guard is real.
    await w.db.prepare("UPDATE content_posts SET body_en='' WHERE id=?").bind(draft.id).run();
    await expect(publishAdminContent(authedRequest(`/api/admin/content/posts/${draft.id}/publish`, { expected_row_version: draft.row_version }, { session: w.editor }), w.env, draft.id))
      .rejects.toMatchObject({ status: 400, code: "content_publish_incomplete" });
  });

  it("publish requires the CSRF token", async () => {
    const w = await world();
    const draft = await createPost(w, englishOnlyDraft());
    const request = new Request(`https://registry.example/api/admin/content/posts/${draft.id}/publish`, {
      method: "POST", headers: { "content-type": "application/json", origin: "https://registry.example", cookie: w.editor.cookie }, body: JSON.stringify({ expected_row_version: draft.row_version }),
    });
    await expect(publishAdminContent(request, w.env, draft.id)).rejects.toMatchObject({ status: 403, code: "csrf_failed" });
  });
});

describe("R117-17 4. retract stays visible after reload; public state is honest", () => {
  it("a retracted post leaves the public routes and reads archived after a full reload", async () => {
    const w = await world();
    const draft = await createPost(w, englishOnlyDraft());
    const published = (await (await publishAdminContent(authedRequest(`/api/admin/content/posts/${draft.id}/publish`, { expected_row_version: draft.row_version }, { session: w.editor }), w.env, draft.id)).json() as { post: ContentPost }).post;
    expect(await publicSlugs(w)).toContain(draft.slug);
    const retracted = await retractAdminContent(authedRequest(`/api/admin/content/posts/${draft.id}/retract`, { expected_row_version: published.row_version }, { session: w.editor }), w.env, draft.id);
    expect(retracted.status).toBe(200);
    const post = (await retracted.json() as { post: ContentPost }).post;
    expect(post.status).toBe("archived");
    // After the "reload" (fresh queries) the retraction is durable.
    expect(await publicSlugs(w)).not.toContain(draft.slug);
    await expect(getPublicContent(w.db, draft.slug)).rejects.toMatchObject({ status: 404, code: "content_not_found" });
    const reloaded = (await adminRows(w)).find(row => row.id === draft.id);
    expect(reloaded?.status).toBe("archived");
    expect(reloaded?.row_version).toBe(published.row_version + 1);
  });

  it("a retracted post can be republished through the explicit action", async () => {
    const w = await world();
    const draft = await createPost(w, englishOnlyDraft());
    const published = (await (await publishAdminContent(authedRequest(`/api/admin/content/posts/${draft.id}/publish`, { expected_row_version: draft.row_version }, { session: w.editor }), w.env, draft.id)).json() as { post: ContentPost }).post;
    const retracted = (await (await retractAdminContent(authedRequest(`/api/admin/content/posts/${draft.id}/retract`, { expected_row_version: published.row_version }, { session: w.editor }), w.env, draft.id)).json() as { post: ContentPost }).post;
    const republished = await publishAdminContent(authedRequest(`/api/admin/content/posts/${draft.id}/publish`, { expected_row_version: retracted.row_version }, { session: w.editor }), w.env, draft.id);
    expect(republished.status).toBe(200);
    expect(await publicSlugs(w)).toContain(draft.slug);
  });
});

describe("R117-17 5. stale saves preserve drafts (optimistic concurrency)", () => {
  it("a stale update refuses 409 with the current version and applies none of the loser's edit", async () => {
    const w = await world();
    const post = await createPost(w, englishOnlyDraft());
    // Editor A saves first (v1 -> v2).
    const aSave = await updateAdminContent(authedRequest(`/api/admin/content/posts/${post.id}`, {
      expected_row_version: 1, post: englishOnlyDraft({ title_en: "Editor A headline" }),
    }, { session: w.editor }), w.env, post.id);
    expect(aSave.status).toBe(200);
    // Editor B still holds v1 — refused with the current version; the stored
    // draft stays exactly editor A's write.
    await expect(updateAdminContent(authedRequest(`/api/admin/content/posts/${post.id}`, {
      expected_row_version: 1, post: englishOnlyDraft({ title_en: "Editor B headline" }),
    }, { session: w.editorB }), w.env, post.id))
      .rejects.toMatchObject({ status: 409, code: "edit_conflict", details: { current_row_version: 2 } });
    const reloaded = (await adminRows(w)).find(row => row.id === post.id);
    expect(reloaded?.title_en).toBe("Editor A headline");
    expect(reloaded?.row_version).toBe(2);
    // B reloads, re-applies the edit on the current version, and wins cleanly.
    const bRetry = await updateAdminContent(authedRequest(`/api/admin/content/posts/${post.id}`, {
      expected_row_version: 2, post: englishOnlyDraft({ title_en: "Editor B headline", title_fa: "تیتر ب" }),
    }, { session: w.editorB }), w.env, post.id);
    expect(bRetry.status).toBe(200);
    const after = (await bRetry.json() as { post: ContentPost }).post;
    expect(after.title_en).toBe("Editor B headline");
    expect(after.row_version).toBe(3);
  });

  it("a stale publish after a concurrent write refuses 409 and never publishes", async () => {
    const w = await world();
    const post = await createPost(w, englishOnlyDraft());
    // A concurrent edit advances the version first.
    await updateAdminContent(authedRequest(`/api/admin/content/posts/${post.id}`, {
      expected_row_version: 1, post: englishOnlyDraft({ title_en: "Editor A headline" }),
    }, { session: w.editor }), w.env, post.id);
    await expect(publishAdminContent(authedRequest(`/api/admin/content/posts/${post.id}/publish`, { expected_row_version: 1 }, { session: w.editorB }), w.env, post.id))
      .rejects.toMatchObject({ status: 409, code: "edit_conflict", details: { current_row_version: 2 } });
    expect(await publicSlugs(w)).not.toContain(post.slug);
  });
});

describe("R117-17 6. the immutable version history records every transition", () => {
  it("create, update, publish and retract each append one honest revision, newest first", async () => {
    const w = await world();
    const post = await createPost(w, englishOnlyDraft());
    await updateAdminContent(authedRequest(`/api/admin/content/posts/${post.id}`, {
      expected_row_version: 1, post: englishOnlyDraft({ title_en: "Updated headline" }),
    }, { session: w.editor }), w.env, post.id);
    await publishAdminContent(authedRequest(`/api/admin/content/posts/${post.id}/publish`, { expected_row_version: 2 }, { session: w.editor }), w.env, post.id);
    await retractAdminContent(authedRequest(`/api/admin/content/posts/${post.id}/retract`, { expected_row_version: 3 }, { session: w.editorB }), w.env, post.id);

    const revisions = await revisionsOf(w, post.id);
    expect(revisions.length).toBe(4);
    // Newest first.
    expect(revisions.map(revision => revision.cause)).toEqual(["retract", "publish", "update", "create"]);
    expect(revisions.map(revision => revision.revision_no)).toEqual([4, 3, 2, 1]);
    // Each transition records the honest status pair.
    expect([revisions[0]!.from_status, revisions[0]!.to_status]).toEqual(["published", "archived"]);
    expect([revisions[1]!.from_status, revisions[1]!.to_status]).toEqual(["draft", "published"]);
    expect([revisions[2]!.from_status, revisions[2]!.to_status]).toEqual(["draft", "draft"]);
    // Actors are recorded per action.
    expect(revisions[0]!.actor_user_id).toBe("r17-editor-b");
    expect(revisions[1]!.actor_user_id).toBe("r17-editor");
    // Snapshots decode to the exact stored content at that point in time.
    expect(revisions[3]!.post.title_en).toBe("R117-17 English headline");
    expect(revisions[2]!.post.title_en).toBe("Updated headline");
    expect(revisions[1]!.post.language_completeness).toEqual({ en: "complete", fa: "missing", ar: "missing", zh: "missing" });
    expect(revisions[0]!.post.status).toBe("archived");
  });

  it("revisions of an unknown post are refused, not empty", async () => {
    const w = await world();
    await expect(listAdminContentRevisions(authedRequest("/api/admin/content/posts/unknown/revisions", undefined, { session: w.editor }), w.env, "unknown"))
      .rejects.toMatchObject({ status: 404, code: "content_not_found" });
  });
});
