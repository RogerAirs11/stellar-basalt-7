import { withAiReservation } from "../../db/aiReservation";
import { AiRuntimeError } from "../core/errors";
import { isD1WriteQuotaError, isEphemeralConversationId, markWritesDegraded, newEphemeralConversationId } from "./storageHealth";
import type {
  AiConversationDetail,
  AiConversationMessage,
  AiConversationSummary,
  AiEvidenceReference,
  AiEntityReference,
  AiExecutionMode,
  AiImageReference,
  AiProviderId,
  AiUsage,
} from "../core/types";

interface ConversationRow {
  id: string;
  owner_key: string;
  title: string | null;
  locale: string;
  execution_mode: AiExecutionMode;
  preferred_provider: AiProviderId | null;
  preferred_model: string | null;
  active_provider: AiProviderId | null;
  active_model: string | null;
  provider_interaction_id: string | null;
  provider_state_json: string | null;
  effective_context_tokens: number;
  last_input_tokens: number;
  last_output_tokens: number;
  last_thought_tokens: number;
  last_cached_tokens: number;
  active_turn_id: string | null;
  active_turn_started_at: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: AiConversationMessage["role"];
  text: string;
  client_message_id: string | null;
  provider: AiProviderId | null;
  model: string | null;
  evidence_json: string;
  entity_refs_json: string;
  status: AiConversationMessage["status"];
  created_at: string;
}

interface AttachmentRow {
  id: string;
  message_id: string;
  kind: "image";
  url: string;
  mime_type: string | null;
  alt_text: string | null;
}

export interface ConversationProviderState {
  provider: AiProviderId | null;
  model: string | null;
  interactionId: string | null;
  state: unknown;
  effectiveContextTokens: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  lastThoughtTokens: number;
  lastCachedTokens: number;
}

export interface RequestLedgerAttempt {
  id: string;
  conversationId: string | null;
  provider: AiProviderId | null;
  model: string | null;
  estimatedInputTokens: number;
  estimatedCostUsd?: number;
  requestKind?: string;
}

const REQUIRED_TABLES = ["ai_conversations", "ai_messages", "ai_request_ledger", "ai_message_attachments", "ai_cost_reservations"] as const;

/* ── Quota-resilience overlay ──────────────────────────────────────────────
 * When the free-tier D1 daily row-write quota is exhausted (bulk seeding,
 * heavy import days), conversation writes degrade to this per-isolate,
 * owner-scoped overlay. New conversations become "ephemeral:" ones that live
 * only for the browser session; turns appended to durable conversations are
 * parked here and merged into reads. Answers are never blocked by storage.
 * Everything is re-tried against D1 on later turns, so the overlay drains and
 * disappears automatically once the quota resets (00:00 UTC). */
interface OverlayEntry {
  conversationId: string;
  ownerKey: string;
  title: string | null;
  locale: string;
  executionMode: AiExecutionMode;
  preferredProvider: AiProviderId | null;
  preferredModel: string | null;
  messages: AiConversationMessage[];
  updatedAt: string;
  lastActivityAt: string;
  lease: { turnId: string; at: number } | null;
}

const OVERLAY_TTL_MS = 6 * 60 * 60 * 1000;
const OVERLAY_MAX_CONVERSATIONS = 400;
const overlay = new Map<string, OverlayEntry>();

function overlayKey(ownerKey: string, conversationId: string): string {
  return `${ownerKey}::${conversationId}`;
}

function overlayEntry(ownerKey: string, conversationId: string): OverlayEntry | null {
  const entry = overlay.get(overlayKey(ownerKey, conversationId));
  if (!entry) return null;
  if (parseMessageTs(entry.lastActivityAt) + OVERLAY_TTL_MS < Date.now()) {
    overlay.delete(overlayKey(ownerKey, conversationId));
    return null;
  }
  return entry;
}

function ensureOverlayEntry(ownerKey: string, conversationId: string, seed: Partial<OverlayEntry> = {}): OverlayEntry {
  const existing = overlayEntry(ownerKey, conversationId);
  if (existing) {
    if (seed.title && !existing.title) existing.title = seed.title;
    if (seed.locale) existing.locale = seed.locale;
    if (seed.executionMode) existing.executionMode = seed.executionMode;
    if (seed.preferredProvider !== undefined) existing.preferredProvider = seed.preferredProvider;
    if (seed.preferredModel !== undefined) existing.preferredModel = seed.preferredModel;
    return existing;
  }
  sweepOverlay();
  const now = new Date().toISOString();
  const entry: OverlayEntry = {
    conversationId,
    ownerKey,
    title: seed.title ?? null,
    locale: seed.locale ?? "auto",
    executionMode: seed.executionMode ?? "auto",
    preferredProvider: seed.preferredProvider ?? null,
    preferredModel: seed.preferredModel ?? null,
    messages: [],
    updatedAt: now,
    lastActivityAt: now,
    lease: null,
  };
  overlay.set(overlayKey(ownerKey, conversationId), entry);
  return entry;
}

function sweepOverlay(): void {
  const now = Date.now();
  for (const [key, entry] of overlay) {
    if (parseMessageTs(entry.lastActivityAt) + OVERLAY_TTL_MS < now) overlay.delete(key);
  }
  while (overlay.size > OVERLAY_MAX_CONVERSATIONS) {
    let oldest: string | null = null;
    let oldestAt = Infinity;
    for (const [key, entry] of overlay) {
      const at = parseMessageTs(entry.lastActivityAt);
      if (at < oldestAt) { oldestAt = at; oldest = key; }
    }
    if (!oldest) break;
    overlay.delete(oldest);
  }
}

function overlayToSummary(entry: OverlayEntry): AiConversationSummary {
  return {
    id: entry.conversationId,
    title: entry.title,
    locale: entry.locale,
    executionMode: entry.executionMode,
    preferredProvider: entry.preferredProvider,
    preferredModel: entry.preferredModel,
    activeProvider: null,
    activeModel: null,
    updatedAt: entry.updatedAt,
    lastActivityAt: entry.lastActivityAt,
    messageCount: entry.messages.length,
    busy: Boolean(entry.lease),
    ephemeral: true,
  };
}

/** Merge overlay (non-persisted) messages into durable ones, ordered by time. */
function mergeOverlayMessages(ownerKey: string, conversationId: string, durable: AiConversationMessage[]): AiConversationMessage[] {
  const entry = overlayEntry(ownerKey, conversationId);
  if (!entry || !entry.messages.length) return durable;
  const seen = new Set(durable.map(message => message.clientMessageId ?? message.id));
  const extra = entry.messages.filter(message => !seen.has(message.clientMessageId ?? message.id));
  if (!extra.length) return durable;
  return [...durable, ...extra].sort((a, b) => parseMessageTs(a.createdAt) - parseMessageTs(b.createdAt));
}

/** Lenient timestamp parser: handles both ISO and SQLite "YYYY-MM-DD HH:MM:SS". */
function parseMessageTs(value: string): number {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
    const iso = Date.parse(`${value.slice(0, 10)}T${value.slice(11, 19)}Z`);
    if (!Number.isNaN(iso)) return iso;
  }
  const direct = Date.parse(value);
  return Number.isNaN(direct) ? 0 : direct;
}

function appendOverlayUserMessage(entry: OverlayEntry, input: {
  clientMessageId: string;
  text: string;
  attachments?: AiImageReference[];
}): { user: AiConversationMessage; existingAssistant: AiConversationMessage | null; inserted: boolean } {
  const existingUser = entry.messages.find(message => message.role === "user" && message.clientMessageId === input.clientMessageId);
  const existingAssistant = [...entry.messages].reverse().find(message => message.role === "assistant" && message.clientMessageId === input.clientMessageId && message.status === "complete") ?? null;
  if (existingUser) return { user: existingUser, existingAssistant, inserted: false };
  const user: AiConversationMessage = {
    id: crypto.randomUUID(),
    role: "user",
    text: input.text,
    clientMessageId: input.clientMessageId,
    status: "complete",
    attachments: input.attachments ?? [],
    createdAt: new Date().toISOString(),
  };
  entry.messages.push(user);
  entry.lastActivityAt = user.createdAt;
  return { user, existingAssistant: null, inserted: true };
}

function appendOverlayAssistantMessage(entry: OverlayEntry, input: {
  clientMessageId: string;
  text: string;
  provider: AiProviderId | null;
  model: string | null;
  evidence: AiEvidenceReference[];
  entityRefs: AiEntityReference[];
  titleIfEmpty?: string;
}): AiConversationMessage {
  const existing = [...entry.messages].reverse().find(message => message.role === "assistant" && message.clientMessageId === input.clientMessageId && message.status === "complete");
  if (existing) return existing;
  const message: AiConversationMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    text: input.text,
    clientMessageId: input.clientMessageId,
    provider: input.provider,
    model: input.model,
    status: "complete",
    evidence: input.evidence,
    entityRefs: input.entityRefs,
    attachments: [],
    createdAt: new Date().toISOString(),
  };
  entry.messages.push(message);
  if (!entry.title && input.titleIfEmpty?.trim()) entry.title = input.titleIfEmpty.trim().slice(0, 100);
  entry.lastActivityAt = message.createdAt;
  return message;
}

export async function aiStorageReady(db: D1Database): Promise<boolean> {
  try {
    const placeholders = REQUIRED_TABLES.map(() => "?").join(",");
    const rows = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`).bind(...REQUIRED_TABLES).all<{ name: string }>();
    if (new Set(rows.results.map(row => row.name)).size !== REQUIRED_TABLES.length) return false;
    // 0018 and 0020 add columns rather than new tables. Probe them explicitly so
    // a partially migrated deployment can never advertise a broken assistant.
    await db.batch([
      db.prepare("SELECT active_turn_id,active_turn_started_at FROM ai_conversations LIMIT 0"),
      db.prepare("SELECT client_message_id FROM ai_messages LIMIT 0"),
      db.prepare("SELECT reserved_cost_usd,estimated_billed_cost_usd,status FROM ai_cost_reservations LIMIT 0"),
      db.prepare("SELECT estimated_billed_cost_usd FROM ai_request_ledger LIMIT 0"),
    ]);
    return true;
  } catch {
    try {
      // Compatibility path for D1-like adapters that do not expose sqlite_master.
      await db.prepare("SELECT id,active_turn_id,active_turn_started_at FROM ai_conversations LIMIT 0").all();
      await db.prepare("SELECT id,client_message_id FROM ai_messages LIMIT 0").all();
      await db.prepare("SELECT id,reserved_cost_usd,estimated_billed_cost_usd,status FROM ai_cost_reservations LIMIT 0").all();
      await db.prepare("SELECT id,estimated_billed_cost_usd FROM ai_request_ledger LIMIT 0").all();
      await db.prepare("SELECT id FROM ai_request_ledger LIMIT 0").all();
      await db.prepare("SELECT id FROM ai_message_attachments LIMIT 0").all();
      return true;
    } catch {
      return false;
    }
  }
}

export async function assertAiStorageReady(db: D1Database): Promise<void> {
  if (!await aiStorageReady(db)) throw new AiRuntimeError("configuration", "ai_storage_not_ready", "AI storage migrations 0016-0022 are not applied", undefined, false);
}

export async function createConversation(db: D1Database, ownerKey: string, input: { mode: AiExecutionMode; locale?: string; provider?: AiProviderId | null; model?: string | null }): Promise<AiConversationSummary> {
  await assertAiStorageReady(db);
  const id = crypto.randomUUID();
  try {
    await db.prepare(`INSERT INTO ai_conversations(id,owner_key,locale,execution_mode,preferred_provider,preferred_model) VALUES(?,?,?,?,?,?)`)
      .bind(id, ownerKey, input.locale ?? "auto", input.mode, input.provider ?? null, input.model ?? null).run();
  } catch (error) {
    if (!isD1WriteQuotaError(error)) throw error;
    // Daily write quota exhausted: continue as an in-browser-session conversation.
    // Answers are unaffected; history saving resumes automatically after the
    // UTC reset. The browser is told via the `ephemeral` flag on the summary.
    markWritesDegraded();
    const ephemeralId = newEphemeralConversationId();
    const entry = ensureOverlayEntry(ownerKey, ephemeralId, {
      locale: input.locale ?? "auto",
      executionMode: input.mode,
      preferredProvider: input.provider ?? null,
      preferredModel: input.model ?? null,
    });
    return overlayToSummary(entry);
  }
  const row = await getConversationRow(db, id, ownerKey);
  if (!row) throw new AiRuntimeError("storage", "conversation_create_failed", "Conversation could not be reloaded");
  return rowToSummary(row, 0);
}


export async function updateConversationPreferences(db: D1Database, input: {
  conversationId: string;
  ownerKey: string;
  mode: AiExecutionMode;
  provider: AiProviderId | null;
  model: string | null;
}): Promise<void> {
  if (isEphemeralConversationId(input.conversationId)) {
    const entry = overlayEntry(input.ownerKey, input.conversationId);
    if (!entry) throw new AiRuntimeError("storage", "conversation_not_found", "Conversation not found");
    entry.executionMode = input.mode;
    entry.preferredProvider = input.provider;
    entry.preferredModel = input.model;
    return;
  }
  try {
    const result = await db.prepare(`
    UPDATE ai_conversations
    SET execution_mode=?,preferred_provider=?,preferred_model=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND owner_key=?
  `).bind(input.mode,input.provider,input.model,input.conversationId,input.ownerKey).run();
    if (Number(result.meta.changes ?? 0) < 1) throw new AiRuntimeError("storage", "conversation_not_found", "Conversation not found");
  } catch (error) {
    if (!isD1WriteQuotaError(error)) throw error;
    markWritesDegraded();
  }
}

export async function listConversations(db: D1Database, ownerKey: string, limit = 30): Promise<AiConversationSummary[]> {
  await assertAiStorageReady(db);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = await db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id=c.id) AS message_count
    FROM ai_conversations c WHERE c.owner_key=? ORDER BY c.last_activity_at DESC LIMIT ?
  `).bind(ownerKey, safeLimit).all<ConversationRow & { message_count: number }>();
  const durable = rows.results.map(row => rowToSummary(row, Number(row.message_count ?? 0)));
  // Session-only conversations (created while the write quota was exhausted)
  // join the list so the chat's "Recent" picker stays coherent. Overlay
  // entries parked for DURABLE conversations are internal and never listed.
  const ephemeral: AiConversationSummary[] = [];
  for (const entry of overlay.values()) {
    if (entry.ownerKey !== ownerKey || !isEphemeralConversationId(entry.conversationId)) continue;
    if (parseMessageTs(entry.lastActivityAt) + OVERLAY_TTL_MS < Date.now()) continue;
    ephemeral.push(overlayToSummary(entry));
  }
  const merged = [...durable, ...ephemeral].sort((a, b) => parseMessageTs(b.lastActivityAt) - parseMessageTs(a.lastActivityAt));
  return merged.slice(0, safeLimit);
}

export async function getConversation(db: D1Database, id: string, ownerKey: string): Promise<AiConversationDetail | null> {
  if (isEphemeralConversationId(id)) {
    // Session-only conversation. If the isolate recycled, hand back a DETACHED
    // empty shell (never stored, never listed) so the browser's refresh() stays
    // harmless — the browser owns the transcript for session-only chats anyway.
    // Storing here would wrongly register foreign owners against this id.
    const entry = overlayEntry(ownerKey, id);
    if (!entry) {
      const now = new Date().toISOString();
      return {
        id, title: null, locale: "auto", executionMode: "auto", preferredProvider: null, preferredModel: null,
        activeProvider: null, activeModel: null, updatedAt: now, lastActivityAt: now,
        messageCount: 0, busy: false, ephemeral: true, messages: [],
      };
    }
    return { ...overlayToSummary(entry), messages: [...entry.messages] };
  }
  await assertAiStorageReady(db);
  const row = await getConversationRow(db, id, ownerKey);
  if (!row) return null;
  const messages = await getConversationMessages(db, id);
  const merged = mergeOverlayMessages(ownerKey, id, messages);
  return { ...rowToSummary(row, merged.length), messages: merged };
}

export async function getConversationProviderState(db: D1Database, id: string, ownerKey: string): Promise<ConversationProviderState | null> {
  // Session-only conversations never persist provider continuation state; each
  // turn replays the transcript (the overlay keeps it small and coherent).
  if (isEphemeralConversationId(id)) return null;
  const row = await getConversationRow(db, id, ownerKey);
  if (!row) return null;
  return {
    provider: row.active_provider,
    model: row.active_model,
    interactionId: row.provider_interaction_id,
    state: parseJson(row.provider_state_json, null),
    effectiveContextTokens: Number(row.effective_context_tokens ?? 0),
    lastInputTokens: Number(row.last_input_tokens ?? 0),
    lastOutputTokens: Number(row.last_output_tokens ?? 0),
    lastThoughtTokens: Number(row.last_thought_tokens ?? 0),
    lastCachedTokens: Number(row.last_cached_tokens ?? 0),
  };
}

export async function getConversationMessages(db: D1Database, conversationId: string): Promise<AiConversationMessage[]> {
  const [messagesResult, attachmentsResult] = await db.batch([
    db.prepare(`SELECT * FROM ai_messages WHERE conversation_id=? ORDER BY created_at,id`).bind(conversationId),
    db.prepare(`SELECT a.* FROM ai_message_attachments a JOIN ai_messages m ON m.id=a.message_id WHERE m.conversation_id=? ORDER BY a.created_at,a.id`).bind(conversationId),
  ]);
  const messages = messagesResult.results as unknown as MessageRow[];
  const attachments = attachmentsResult.results as unknown as AttachmentRow[];
  const byMessage = new Map<string, AiImageReference[]>();
  for (const attachment of attachments) {
    const current = byMessage.get(attachment.message_id) ?? [];
    current.push({ kind: "image", url: attachment.url, mimeType: attachment.mime_type, altText: attachment.alt_text });
    byMessage.set(attachment.message_id, current);
  }
  return messages.map(row => ({
    id: row.id,
    role: row.role,
    text: row.text,
    clientMessageId: row.client_message_id,
    provider: row.provider,
    model: row.model,
    status: row.status ?? "complete",
    evidence: parseJson<AiEvidenceReference[]>(row.evidence_json, []),
    entityRefs: parseJson<AiEntityReference[]>(row.entity_refs_json, []),
    attachments: byMessage.get(row.id) ?? [],
    createdAt: row.created_at,
  }));
}

/** Look up an idempotent browser turn without mutating the transcript. */
export async function findIdempotentTurn(db: D1Database, input: {
  conversationId: string;
  ownerKey: string;
  clientMessageId: string;
}): Promise<{ user: AiConversationMessage; existingAssistant: AiConversationMessage | null } | null> {
  if (isEphemeralConversationId(input.conversationId)) {
    const entry = overlayEntry(input.ownerKey, input.conversationId);
    if (!entry) return null;
    const user = entry.messages.find(message => message.role === "user" && message.clientMessageId === input.clientMessageId);
    if (!user) return null;
    const existingAssistant = [...entry.messages].reverse().find(message => message.role === "assistant" && message.clientMessageId === input.clientMessageId && message.status === "complete") ?? null;
    return { user, existingAssistant };
  }
  const conversation = await getConversationRow(db, input.conversationId, input.ownerKey);
  if (!conversation) throw new AiRuntimeError("storage", "conversation_not_found", "Conversation not found");
  const existing = await db.prepare(`SELECT * FROM ai_messages WHERE conversation_id=? AND role='user' AND client_message_id=? LIMIT 1`)
    .bind(input.conversationId, input.clientMessageId).first<MessageRow>();
  if (!existing) return null;
  const assistant = await db.prepare(`SELECT * FROM ai_messages WHERE conversation_id=? AND role='assistant' AND client_message_id=? AND status='complete' ORDER BY created_at DESC,id DESC LIMIT 1`)
    .bind(input.conversationId, input.clientMessageId).first<MessageRow>();
  return { user: await hydrateSingleMessage(db, existing), existingAssistant: assistant ? await hydrateSingleMessage(db, assistant) : null };
}

/**
 * Insert a user turn idempotently. The unique client-message index is the final
 * race guard; INSERT OR IGNORE means simultaneous browser retries converge on
 * one durable user message instead of surfacing a duplicate-key error.
 */
export async function ensureUserMessage(db: D1Database, input: {
  conversationId: string;
  ownerKey: string;
  clientMessageId: string;
  text: string;
  attachments?: AiImageReference[];
}): Promise<{ user: AiConversationMessage; existingAssistant: AiConversationMessage | null; inserted: boolean }> {
  if (isEphemeralConversationId(input.conversationId)) {
    const entry = overlayEntry(input.ownerKey, input.conversationId);
    if (!entry) throw new AiRuntimeError("storage", "conversation_not_found", "Conversation not found");
    return appendOverlayUserMessage(entry, input);
  }
  const conversation = await getConversationRow(db, input.conversationId, input.ownerKey);
  if (!conversation) throw new AiRuntimeError("storage", "conversation_not_found", "Conversation not found");

  const id = crypto.randomUUID();
  const createdAt = sqliteTimestamp();
  let didInsert: boolean;
  try {
    const inserted = await db.prepare(`INSERT OR IGNORE INTO ai_messages(id,conversation_id,role,text,client_message_id,status,created_at) VALUES(?,?, 'user', ?, ?, 'complete', ?)`)
      .bind(id, input.conversationId, input.text, input.clientMessageId, createdAt).run();
    didInsert = Number(inserted.meta.changes ?? 0) > 0;
  } catch (error) {
    if (!isD1WriteQuotaError(error)) throw error;
    // Quota exhausted mid-conversation: park the turn in the overlay so this
    // isolate (and the browser transcript) stay coherent without blocking.
    markWritesDegraded();
    const entry = ensureOverlayEntry(input.ownerKey, input.conversationId, {
      title: conversation.title,
      locale: conversation.locale,
      executionMode: conversation.execution_mode,
      preferredProvider: conversation.preferred_provider,
      preferredModel: conversation.preferred_model,
    });
    return appendOverlayUserMessage(entry, input);
  }
  const row = didInsert
    ? await db.prepare("SELECT * FROM ai_messages WHERE id=?").bind(id).first<MessageRow>()
    : await db.prepare(`SELECT * FROM ai_messages WHERE conversation_id=? AND role='user' AND client_message_id=? LIMIT 1`).bind(input.conversationId, input.clientMessageId).first<MessageRow>();
  if (!row) throw new AiRuntimeError("storage", "message_create_failed", "User message could not be reloaded");
  if (row.text !== input.text) throw new AiRuntimeError("storage", "idempotency_conflict", "The same clientMessageId was reused with different message text");

  if (didInsert && input.attachments?.length) {
    try {
      const statements = input.attachments.slice(0, 4).map(attachment => db.prepare(`INSERT INTO ai_message_attachments(id,message_id,kind,url,mime_type,alt_text,created_at) VALUES(?,?,'image',?,?,?,?)`)
        .bind(crypto.randomUUID(), id, attachment.url, attachment.mimeType ?? null, attachment.altText ?? null, createdAt));
      await db.batch(statements);
    } catch (error) {
      if (!isD1WriteQuotaError(error)) throw error;
      markWritesDegraded();
    }
  }
  if (didInsert) {
    try {
      await db.prepare("UPDATE ai_conversations SET updated_at=?,last_activity_at=? WHERE id=?").bind(createdAt, createdAt, input.conversationId).run();
    } catch (error) {
      if (!isD1WriteQuotaError(error)) throw error;
      markWritesDegraded();
    }
  }
  const assistant = await db.prepare(`SELECT * FROM ai_messages WHERE conversation_id=? AND role='assistant' AND client_message_id=? AND status='complete' ORDER BY created_at DESC,id DESC LIMIT 1`)
    .bind(input.conversationId, input.clientMessageId).first<MessageRow>();
  return { user: await hydrateSingleMessage(db, row), existingAssistant: assistant ? await hydrateSingleMessage(db, assistant) : null, inserted: didInsert };
}

export async function acquireTurnLease(db: D1Database, conversationId: string, ownerKey: string, turnId: string, staleMinutes = 30): Promise<boolean> {
  const staleMs = Math.max(1, staleMinutes) * 60_000;
  if (isEphemeralConversationId(conversationId)) {
    const entry = ensureOverlayEntry(ownerKey, conversationId);
    if (entry.lease && Date.now() - entry.lease.at < staleMs) return false;
    entry.lease = { turnId, at: Date.now() };
    return true;
  }
  try {
    const result = await db.prepare(`
    UPDATE ai_conversations SET active_turn_id=?,active_turn_started_at=CURRENT_TIMESTAMP
    WHERE id=? AND owner_key=? AND (
      active_turn_id IS NULL OR active_turn_started_at IS NULL OR active_turn_started_at < datetime('now', ?)
    )
  `).bind(turnId, conversationId, ownerKey, `-${Math.max(1, staleMinutes)} minutes`).run();
    return Number(result.meta.changes ?? 0) > 0;
  } catch (error) {
    if (!isD1WriteQuotaError(error)) throw error;
    // Degraded lease: per-isolate mutual exclusion keeps the busy-guard
    // meaningful without D1 writes; the stale window matches the durable one.
    markWritesDegraded();
    const entry = ensureOverlayEntry(ownerKey, conversationId);
    if (entry.lease && Date.now() - entry.lease.at < staleMs) return false;
    entry.lease = { turnId, at: Date.now() };
    return true;
  }
}

export async function releaseTurnLease(db: D1Database, conversationId: string, turnId: string): Promise<void> {
  for (const entry of overlay.values()) {
    if (entry.conversationId === conversationId && entry.lease?.turnId === turnId) entry.lease = null;
  }
  try {
    await db.prepare("UPDATE ai_conversations SET active_turn_id=NULL,active_turn_started_at=NULL WHERE id=? AND active_turn_id=?").bind(conversationId, turnId).run();
  } catch (error) {
    if (!isD1WriteQuotaError(error)) throw error;
    markWritesDegraded();
  }
}

export async function commitAssistantTurn(db: D1Database, input: {
  conversationId: string;
  ownerKey: string;
  clientMessageId: string;
  text: string;
  provider: AiProviderId | null;
  model: string | null;
  evidence: AiEvidenceReference[];
  entityRefs: AiEntityReference[];
  providerInteractionId?: string | null;
  providerState?: unknown;
  usage: AiUsage;
  effectiveContextTokens: number;
  titleIfEmpty?: string;
}): Promise<AiConversationMessage> {
  if (isEphemeralConversationId(input.conversationId)) {
    const entry = overlayEntry(input.ownerKey, input.conversationId);
    if (!entry) throw new AiRuntimeError("storage", "conversation_not_found", "Conversation not found");
    return appendOverlayAssistantMessage(entry, input);
  }
  const conversation = await getConversationRow(db, input.conversationId, input.ownerKey);
  if (!conversation) throw new AiRuntimeError("storage", "conversation_not_found", "Conversation not found");
  const existing = await db.prepare(`SELECT * FROM ai_messages WHERE conversation_id=? AND role='assistant' AND client_message_id=? AND status='complete' LIMIT 1`)
    .bind(input.conversationId, input.clientMessageId).first<MessageRow>();
  if (existing) return hydrateSingleMessage(db, existing);

  const messageId = crypto.randomUUID();
  const title = conversation.title || input.titleIfEmpty?.trim().slice(0, 100) || null;
  const committedAt = sqliteTimestamp();
  try {
    const statements = [
      db.prepare(`INSERT INTO ai_messages(id,conversation_id,role,text,client_message_id,provider,model,evidence_json,entity_refs_json,status,created_at) VALUES(?,?, 'assistant', ?,?,?,?,?,?,'complete',?)`)
        .bind(messageId, input.conversationId, input.text, input.clientMessageId, input.provider, input.model, JSON.stringify(input.evidence), JSON.stringify(input.entityRefs), committedAt),
      db.prepare(`UPDATE ai_conversations SET title=?,active_provider=?,active_model=?,provider_interaction_id=?,provider_state_json=?,effective_context_tokens=?,last_input_tokens=?,last_output_tokens=?,last_thought_tokens=?,last_cached_tokens=?,updated_at=?,last_activity_at=? WHERE id=? AND owner_key=?`)
        .bind(title, input.provider, input.model, input.providerInteractionId ?? null, serializeJson(input.providerState), Math.max(0, Math.floor(input.effectiveContextTokens)), input.usage.inputTokens, input.usage.outputTokens, input.usage.thoughtTokens, input.usage.cachedTokens, committedAt, committedAt, input.conversationId, input.ownerKey),
    ];
    await db.batch(statements);
  } catch (error) {
    if (!isD1WriteQuotaError(error)) throw error;
    // The answer is complete; persisting it is best-effort. Park it in the
    // overlay so this isolate (and the browser) keep a coherent transcript.
    markWritesDegraded();
    const entry = ensureOverlayEntry(input.ownerKey, input.conversationId, {
      title,
      locale: conversation.locale,
      executionMode: conversation.execution_mode,
      preferredProvider: conversation.preferred_provider,
      preferredModel: conversation.preferred_model,
    });
    return appendOverlayAssistantMessage(entry, input);
  }
  const row = await db.prepare("SELECT * FROM ai_messages WHERE id=?").bind(messageId).first<MessageRow>();
  if (!row) throw new AiRuntimeError("storage", "assistant_commit_failed", "Assistant response could not be reloaded");
  return hydrateSingleMessage(db, row);
}

export async function resetProviderContinuation(db: D1Database, conversationId: string, ownerKey: string): Promise<void> {
  if (isEphemeralConversationId(conversationId)) return;
  try {
    await db.prepare(`UPDATE ai_conversations SET active_provider=NULL,active_model=NULL,provider_interaction_id=NULL,provider_state_json=NULL,effective_context_tokens=0 WHERE id=? AND owner_key=?`)
      .bind(conversationId, ownerKey).run();
  } catch (error) {
    if (!isD1WriteQuotaError(error)) throw error;
    markWritesDegraded();
  }
}

/** Clear an expired server-side interaction ID while retaining opaque replay state. */
export async function expireProviderInteraction(db: D1Database, conversationId: string, ownerKey: string): Promise<void> {
  if (isEphemeralConversationId(conversationId)) return;
  try {
    await db.prepare(`UPDATE ai_conversations SET provider_interaction_id=NULL,effective_context_tokens=0 WHERE id=? AND owner_key=?`)
      .bind(conversationId, ownerKey).run();
  } catch (error) {
    if (!isD1WriteQuotaError(error)) throw error;
    markWritesDegraded();
  }
}

export async function deleteConversation(db: D1Database, conversationId: string, ownerKey: string): Promise<boolean> {
  if (isEphemeralConversationId(conversationId)) {
    overlay.delete(overlayKey(ownerKey, conversationId));
    return true;
  }
  await assertAiStorageReady(db);
  const deleteLease = `delete:${crypto.randomUUID()}`;
  const acquired = await acquireTurnLease(db, conversationId, ownerKey, deleteLease, 30);
  if (!acquired) return false;
  try {
    const results = await db.batch([
      db.prepare("UPDATE ai_request_ledger SET conversation_id=NULL WHERE conversation_id=?").bind(conversationId),
      db.prepare("DELETE FROM ai_conversations WHERE id=? AND owner_key=? AND active_turn_id=?").bind(conversationId, ownerKey, deleteLease),
    ]);
    const deleted = Number(results[1]?.meta.changes ?? 0) > 0;
    if (!deleted) await releaseTurnLease(db, conversationId, deleteLease).catch(() => {});
    return deleted;
  } catch (error) {
    await releaseTurnLease(db, conversationId, deleteLease).catch(() => {});
    if (isD1WriteQuotaError(error)) {
      markWritesDegraded();
      return false;
    }
    throw error;
  }
}

export async function recordRequestAttempt(db: D1Database, attempt: RequestLedgerAttempt): Promise<void> {
  try {
    await db.prepare(`INSERT INTO ai_request_ledger(id,conversation_id,provider,model,request_kind,estimated_input_tokens,estimated_cost_usd,status) VALUES(?,?,?,?,?,?,?,'attempted')`)
      .bind(attempt.id, attempt.conversationId, attempt.provider, attempt.model, attempt.requestKind ?? "chat", Math.max(0, Math.floor(attempt.estimatedInputTokens)), Math.max(0, attempt.estimatedCostUsd ?? 0)).run();
  } catch (error) {
    if (!isD1WriteQuotaError(error)) throw error;
    markWritesDegraded();
  }
}

export async function completeRequestLedger(db: D1Database, input: {
  id: string;
  status: "success" | "failed" | "cancelled" | "rejected";
  usage?: AiUsage;
  estimatedBilledCostUsd?: number;
  errorCode?: string | null;
  latencyMs?: number;
}): Promise<void> {
  const usage = input.usage;
  try {
    await db.prepare(`UPDATE ai_request_ledger SET completed_at=CURRENT_TIMESTAMP,status=?,input_tokens=?,output_tokens=?,thought_tokens=?,cached_tokens=?,tool_tokens=?,cache_hit_tokens=?,cache_miss_tokens=?,estimated_billed_cost_usd=?,error_code=?,latency_ms=? WHERE id=?`)
      .bind(input.status, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, usage?.thoughtTokens ?? 0, usage?.cachedTokens ?? 0, usage?.toolTokens ?? 0, usage?.cacheHitTokens ?? 0, usage?.cacheMissTokens ?? 0, Math.max(0, input.estimatedBilledCostUsd ?? 0), input.errorCode ?? null, Math.max(0, Math.floor(input.latencyMs ?? 0)), input.id).run();
  } catch (error) {
    if (!isD1WriteQuotaError(error)) throw error;
    markWritesDegraded();
  }
}

export async function requestsSince(db: D1Database, provider: AiProviderId, seconds: number): Promise<{ count: number; estimatedInputTokens: number }> {
  const row = await db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN input_tokens>0 THEN input_tokens ELSE estimated_input_tokens END),0) AS tokens FROM ai_request_ledger WHERE provider=? AND status!='rejected' AND attempted_at>=datetime('now', ?)`)
    .bind(provider, `-${Math.max(1, Math.floor(seconds))} seconds`).first<{ count: number; tokens: number }>();
  return { count: Number(row?.count ?? 0), estimatedInputTokens: Number(row?.tokens ?? 0) };
}

export async function requestsToday(db: D1Database, provider: AiProviderId): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ai_request_ledger WHERE provider=? AND status!='rejected' AND date(attempted_at)=date('now')`).bind(provider).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

/**
 * Paid calls require a durable, verified reservation before any network request.
 * Unknown accounting never authorizes spending. Keep an uncertain reservation
 * conservatively charged until reconciliation; do not turn storage exhaustion
 * into an unlimited paid-provider fallback.
 *
 * The aggregate MUST use the writable authority with read caching disabled.
 * Insert-then-read is deliberately conservative for overlapping reservations.
 */
export async function reserveProviderCost(db: D1Database, requestLedgerId: string, provider: AiProviderId, costUsd: number, dailyLimitUsd: number): Promise<{ reservationId: string; dailyReservedUsd: number }> {
  if (!Number.isFinite(costUsd) || costUsd < 0 || !Number.isFinite(dailyLimitUsd) || dailyLimitUsd <= 0) {
    throw new AiRuntimeError("configuration", "invalid_cost_reservation", "Paid AI cost limits must be finite and valid", provider);
  }
  return withAiReservation(db, authority => reserveProviderCostOnAuthority(authority, requestLedgerId, provider, costUsd, dailyLimitUsd));
}

async function reserveProviderCostOnAuthority(db: D1Database, requestLedgerId: string, provider: AiProviderId, costUsd: number, dailyLimitUsd: number): Promise<{ reservationId: string; dailyReservedUsd: number }> {
  const id = crypto.randomUUID();
  // CONDITIONAL reservation insert — the same atomic admission pattern the
  // reviewed Gemini path uses. The daily ceiling is evaluated INSIDE the
  // write, so concurrent paid admissions can never over-admit even without a
  // transaction wrapper (D1), and never over-refuse a whole burst: exactly the
  // requests whose reservation still fits under the ceiling are admitted.
  // On PostgreSQL the R109 advisory-lock transaction serializes admissions;
  // the in-SQL condition then holds trivially per serialized statement.
  try {
    const receipt = (await db.prepare(`INSERT INTO ai_cost_reservations(id,request_ledger_id,provider,reserved_cost_usd,status)
SELECT ?,?,?,?,'reserved'
WHERE (SELECT COALESCE(SUM(CASE WHEN status='reconciled' THEN COALESCE(estimated_billed_cost_usd,reserved_cost_usd) ELSE reserved_cost_usd END),0) AS cost FROM ai_cost_reservations WHERE provider=? AND date(created_at)=date('now')) + ? <= ?`)
      .bind(id, requestLedgerId, provider, costUsd, provider, costUsd, dailyLimitUsd).run()) as { success: boolean; meta?: { changes?: number | null } | null };
    // Widened receipt type: the runtime fail-closed verification must survive
    // even when driver typings narrow `success` to the literal `true`.
    if (receipt.success === false || (receipt.meta?.changes !== 0 && receipt.meta?.changes !== 1)) {
      throw new AiRuntimeError("storage", "paid_reservation_unavailable", "Paid AI is paused because its usage reservation could not be verified", provider, true);
    }
    if (receipt.meta?.changes === 0) {
      // The ceiling would be exceeded by this reservation. Nothing was
      // written; no release is needed and nothing was dispatched.
      throw new AiRuntimeError("cost_limit", "daily_cost_limit", "Paid AI daily cost ceiling would be exceeded", provider, false, { dailyLimitUsd });
    }
  } catch (error) {
    if (error instanceof AiRuntimeError) throw error;
    if (isD1WriteQuotaError(error)) markWritesDegraded();
    // Do not expose driver errors or credentials in a client-visible error.
    throw new AiRuntimeError("storage", "paid_reservation_unavailable", "Paid AI is paused until usage accounting is available", provider, true);
  }
  let total: number;
  try {
    const row = await db.prepare(`SELECT COALESCE(SUM(CASE WHEN status='reconciled' THEN COALESCE(estimated_billed_cost_usd,reserved_cost_usd) ELSE reserved_cost_usd END),0) AS cost FROM ai_cost_reservations WHERE provider=? AND date(created_at)=date('now')`)
      .bind(provider).first<{ cost: number | string }>();
    // Some SQL drivers return numeric aggregates as decimal strings. Empty,
    // absent or malformed values are not proof of a zero-dollar balance.
    const raw = row?.cost;
    total = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
    if (!Number.isFinite(total) || total < 0 || total + 1e-12 < costUsd) throw new Error("unverified balance");
  } catch {
    throw new AiRuntimeError("storage", "paid_reservation_unavailable", "Paid AI is paused because its usage balance could not be verified", provider, true);
  }
  if (total > dailyLimitUsd) {
    // Defensive belt for engines that do not enforce the in-SQL condition the
    // same way (or a boundary race outside every tested envelope): release the
    // just-written reservation rather than allow an over-limit dispatch.
    await db.prepare(`UPDATE ai_cost_reservations SET status='released',reserved_cost_usd=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
    throw new AiRuntimeError("cost_limit", "daily_cost_limit", "Paid AI daily cost ceiling would be exceeded", provider, false, { dailyLimitUsd, attemptedTotalUsd: total });
  }
  return { reservationId: id, dailyReservedUsd: total };
}

export async function reconcileProviderEstimatedCost(db: D1Database, reservationId: string, estimatedBilledCostUsd: number): Promise<void> {
  if (!Number.isFinite(estimatedBilledCostUsd) || estimatedBilledCostUsd < 0) {
    throw new AiRuntimeError("protocol", "invalid_billed_cost", "Provider usage could not be reconciled safely");
  }
  // Historical degraded markers never represented a durable reservation.
  if (reservationId === "degraded-quota") return;
  try {
    await db.prepare(`UPDATE ai_cost_reservations SET status='reconciled',estimated_billed_cost_usd=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(estimatedBilledCostUsd, reservationId).run();
  } catch (error) {
    if (!isD1WriteQuotaError(error)) throw error;
    markWritesDegraded();
    // Leaving the original worst-case reservation in place is conservative.
  }
}

export async function releaseProviderCost(db: D1Database, reservationId: string): Promise<void> {
  if (reservationId === "degraded-quota") return;
  try {
    await db.prepare(`UPDATE ai_cost_reservations SET status='released',reserved_cost_usd=0,estimated_billed_cost_usd=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(reservationId).run();
  } catch (error) {
    if (!isD1WriteQuotaError(error)) throw error;
    markWritesDegraded();
  }
}

export async function aiOperationalSnapshot(db: D1Database): Promise<Record<string, unknown>> {
  await assertAiStorageReady(db);
  const [requests, deepseekCosts, conversations, failures] = await db.batch([
    db.prepare(`SELECT provider,COUNT(*) AS requests,SUM(input_tokens) AS input_tokens,SUM(output_tokens) AS output_tokens,SUM(thought_tokens) AS thought_tokens,SUM(cached_tokens) AS cached_tokens,SUM(cache_hit_tokens) AS cache_hit_tokens,SUM(cache_miss_tokens) AS cache_miss_tokens,SUM(estimated_billed_cost_usd) AS estimated_billed_cost FROM ai_request_ledger WHERE date(attempted_at)=date('now') GROUP BY provider`),
    db.prepare(`SELECT COALESCE(SUM(reserved_cost_usd),0) AS reserved,COALESCE(SUM(COALESCE(estimated_billed_cost_usd,0)),0) AS estimated_billed FROM ai_cost_reservations WHERE provider='deepseek' AND date(created_at)=date('now') AND status!='released'`),
    db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN active_turn_id IS NOT NULL THEN 1 ELSE 0 END) AS busy FROM ai_conversations`),
    db.prepare(`SELECT provider,error_code,COUNT(*) AS count FROM ai_request_ledger WHERE status='failed' AND attempted_at>=datetime('now','-24 hours') GROUP BY provider,error_code ORDER BY count DESC LIMIT 20`),
  ]);
  return {
    requests: requests.results,
    deepseekCost: deepseekCosts.results[0] ?? {},
    conversations: conversations.results[0] ?? {},
    recentFailures: failures.results,
  };
}

async function getConversationRow(db: D1Database, id: string, ownerKey: string): Promise<ConversationRow | null> {
  return db.prepare("SELECT * FROM ai_conversations WHERE id=? AND owner_key=?").bind(id, ownerKey).first<ConversationRow>();
}

function rowToSummary(row: ConversationRow, messageCount: number): AiConversationSummary {
  return {
    id: row.id,
    title: row.title,
    locale: row.locale,
    executionMode: row.execution_mode,
    preferredProvider: row.preferred_provider,
    preferredModel: row.preferred_model,
    activeProvider: row.active_provider,
    activeModel: row.active_model,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
    messageCount,
    busy: Boolean(row.active_turn_id),
  };
}

async function hydrateSingleMessage(db: D1Database, row: MessageRow): Promise<AiConversationMessage> {
  const attachments = await db.prepare("SELECT * FROM ai_message_attachments WHERE message_id=? ORDER BY created_at,id").bind(row.id).all<AttachmentRow>();
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    clientMessageId: row.client_message_id,
    provider: row.provider,
    model: row.model,
    status: row.status ?? "complete",
    evidence: parseJson(row.evidence_json, []),
    entityRefs: parseJson(row.entity_refs_json, []),
    attachments: attachments.results.map(item => ({ kind: "image", url: item.url, mimeType: item.mime_type, altText: item.alt_text })),
    createdAt: row.created_at,
  };
}

function sqliteTimestamp(now = new Date()): string {
  return now.toISOString().replace("T", " ").replace("Z", "");
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function serializeJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}
