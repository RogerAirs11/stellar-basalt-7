import { describe, expect, it } from "vitest";
import {
  acquireTurnLease,
  commitAssistantTurn,
  createConversation,
  ensureUserMessage,
  findIdempotentTurn,
  getConversation,
  listConversations,
  releaseTurnLease,
} from "../../src/ai/conversation/repository";
import { isD1WriteQuotaError, isEphemeralConversationId } from "../../src/ai/conversation/storageHealth";
import { reserveGeminiAttempt } from "../../src/ai/runtime/quotaGovernor";

/**
 * R54 quota resilience: when the free-tier D1 daily row-write quota is
 * exhausted (the exact error the production assistant surfaced on
 * 2026-09-24 after the demo-data seed), the conversation layer must degrade
 * to the in-memory overlay instead of failing the turn:
 *   - new conversations become ephemeral (browser-session) ones,
 *   - turns appended to durable conversations are parked + merged on read,
 *   - the busy-guard lease still works per-isolate,
 *   - another owner can never see someone else's overlay.
 */

const QUOTA_MESSAGE =
  "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.";

interface StubStatement {
  sql: string;
  args: unknown[];
  bind(...values: unknown[]): StubStatement;
  run(): Promise<{ meta: { changes: number } }>;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}

interface StubOptions {
  /** Durable conversation rows served to `SELECT * FROM ai_conversations WHERE id=?`. */
  conversations?: Array<Record<string, unknown>>;
  /** Durable messages served from ai_messages selects. */
  messages?: Array<Record<string, unknown>>;
}

function makeQuotaDb(options: StubOptions = {}) {
  const conversations = options.conversations ?? [];
  const messages = options.messages ?? [];
  const runCalls: string[] = [];

  const statement = (sql: string): StubStatement => {
    const entry: StubStatement = {
      sql,
      args: [],
      bind(...values: unknown[]) {
        entry.args = values;
        return entry;
      },
      async run() {
        runCalls.push(sql);
        throw new Error(QUOTA_MESSAGE);
      },
      async first<T>() {
        // Reads still work while the WRITE quota is exhausted.
        if (sql.includes("FROM sqlite_master")) return { results: [] } as unknown as T;
        if (sql.includes("FROM ai_conversations WHERE id=?")) {
          const [id, ownerKey] = entry.args as [string, string];
          return (conversations.find(row => row.id === id && row.owner_key === ownerKey) ?? null) as T | null;
        }
        if (sql.includes("FROM ai_messages")) {
          // Emulate the WHERE filters (conversation_id / role / client_message_id)
          // so the durable row never falsely matches a fresh turn lookup.
          const [conversationId, clientMessageId] = entry.args as [string, string];
          const row = messages.find(m =>
            m.conversation_id === conversationId &&
            (!sql.includes("client_message_id=?") || m.client_message_id === clientMessageId) &&
            (!sql.includes("role='assistant'") || m.role === "assistant") &&
            (!sql.includes("role='user'") || m.role === "user"));
          return (row ?? null) as T | null;
        }
        return null as T | null;
      },
      async all<T>() {
        if (sql.includes("FROM sqlite_master")) {
          return { results: ["ai_conversations", "ai_messages", "ai_request_ledger", "ai_message_attachments", "ai_cost_reservations"].map(name => ({ name })) as unknown as T[] };
        }
        if (sql.includes("FROM ai_conversations c WHERE c.owner_key=?")) {
          return { results: conversations.filter(row => row.owner_key === entry.args[0]) as unknown as T[] };
        }
        return { results: [] as unknown as T[] };
      },
    };
    return entry;
  };

  const db = {
    prepare: statement,
    async batch(statements: StubStatement[]) {
      const results: Array<{ results: unknown[] }> = [];
      for (const item of statements) {
        if (item.sql.includes("LIMIT 0")) { results.push({ results: [] }); continue; }
        if (/^(INSERT|UPDATE|DELETE)/i.test(item.sql)) {
          runCalls.push(item.sql);
          throw new Error(QUOTA_MESSAGE);
        }
        if (item.sql.includes("FROM ai_messages WHERE conversation_id=?")) {
          results.push({ results: messages.filter(row => row.conversation_id === item.args[0]) });
          continue;
        }
        results.push({ results: [] });
      }
      return results;
    },
  };
  return { db: db as unknown as D1Database, runCalls };
}

function durableConversationRow(id: string, ownerKey: string): Record<string, unknown> {
  const now = "2026-09-24 10:00:00";
  return {
    id,
    owner_key: ownerKey,
    title: "Durable chat",
    locale: "en",
    execution_mode: "auto",
    preferred_provider: null,
    preferred_model: null,
    active_provider: null,
    active_model: null,
    provider_interaction_id: null,
    provider_state_json: null,
    effective_context_tokens: 0,
    last_input_tokens: 0,
    last_output_tokens: 0,
    last_thought_tokens: 0,
    last_cached_tokens: 0,
    active_turn_id: null,
    active_turn_started_at: null,
    created_at: now,
    updated_at: now,
    last_activity_at: now,
  };
}

const uuid = () => crypto.randomUUID();

describe("D1 write-quota resilience", () => {
  it("recognizes the daily row write limit error and nothing else", () => {
    expect(isD1WriteQuotaError(new Error(QUOTA_MESSAGE))).toBe(true);
    expect(isD1WriteQuotaError("D1_ERROR: Your account has exceeded D1's free tier daily row write limit.")).toBe(true);
    expect(isD1WriteQuotaError(new Error("D1_ERROR: Your account has exceeded D1's free tier daily rows read limit."))).toBe(false);
    expect(isD1WriteQuotaError(new Error("D1_ERROR: no such table: ai_messages"))).toBe(false);
    expect(isD1WriteQuotaError(null)).toBe(false);
  });

  it("creates an ephemeral conversation when the write quota is exhausted", async () => {
    const { db } = makeQuotaDb();
    const summary = await createConversation(db, "anon:quota-create", { mode: "auto", locale: "fa" });
    expect(isEphemeralConversationId(summary.id)).toBe(true);
    expect(summary.ephemeral).toBe(true);
    expect(summary.locale).toBe("fa");
    expect(summary.executionMode).toBe("auto");
  });

  it("runs a complete ephemeral turn (user + assistant) readable through getConversation", async () => {
    const { db } = makeQuotaDb();
    const owner = "anon:quota-turn";
    const summary = await createConversation(db, owner, { mode: "auto" });
    const clientMessageId = uuid();

    const user = await ensureUserMessage(db, {
      conversationId: summary.id,
      ownerKey: owner,
      clientMessageId,
      text: "How many horses are registered?",
    });
    expect(user.inserted).toBe(true);
    expect(user.user.role).toBe("user");

    const assistant = await commitAssistantTurn(db, {
      conversationId: summary.id,
      ownerKey: owner,
      clientMessageId,
      text: "There are 78,089 registered horses.",
      provider: null,
      model: null,
      evidence: [],
      entityRefs: [],
      usage: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0, toolTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 },
      effectiveContextTokens: 0,
      titleIfEmpty: "How many horses",
    });
    expect(assistant.role).toBe("assistant");
    expect(assistant.clientMessageId).toBe(clientMessageId);

    const detail = await getConversation(db, summary.id, owner);
    expect(detail?.ephemeral).toBe(true);
    expect(detail?.messages.map(m => m.role)).toEqual(["user", "assistant"]);

    const prior = await findIdempotentTurn(db, { conversationId: summary.id, ownerKey: owner, clientMessageId });
    expect(prior?.existingAssistant?.text).toBe("There are 78,089 registered horses.");

    // Retrying the same clientMessageId must not duplicate the transcript.
    const again = await ensureUserMessage(db, { conversationId: summary.id, ownerKey: owner, clientMessageId, text: "How many horses are registered?" });
    expect(again.inserted).toBe(false);
    const detailAfter = await getConversation(db, summary.id, owner);
    expect(detailAfter?.messages.length).toBe(2);
  });

  it("parks turns on a durable conversation and merges them into reads", async () => {
    const id = uuid();
    const owner = "user:77";
    const durableMessageId = uuid();
    const { db } = makeQuotaDb({
      conversations: [durableConversationRow(id, owner)],
      messages: [{
        id: durableMessageId,
        conversation_id: id,
        role: "assistant",
        text: "An earlier durable answer.",
        client_message_id: uuid(),
        provider: null,
        model: null,
        evidence_json: "[]",
        entity_refs_json: "[]",
        status: "complete",
        created_at: "2026-09-24 09:00:00",
      }],
    });
    const clientMessageId = uuid();

    const user = await ensureUserMessage(db, { conversationId: id, ownerKey: owner, clientMessageId, text: "Who is CHABOCK's sire?" });
    expect(user.inserted).toBe(true);
    await commitAssistantTurn(db, {
      conversationId: id,
      ownerKey: owner,
      clientMessageId,
      text: "Resolved from the durable transcript plus this parked turn.",
      provider: null,
      model: null,
      evidence: [],
      entityRefs: [],
      usage: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0, toolTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 },
      effectiveContextTokens: 0,
    });

    const detail = await getConversation(db, id, owner);
    // 1 durable row (reads still work) + the parked overlay turn (user + assistant),
    // ordered by timestamp: durable first, then the parked pair.
    expect(detail?.messages.length).toBe(3);
    expect(detail?.messages[0]?.id).toBe(durableMessageId);
    expect(detail?.messages.slice(1).map(m => m.role)).toEqual(["user", "assistant"]);
    expect(detail?.messages.every(m => m.status === "complete")).toBe(true);
    expect(detail?.ephemeral).toBeUndefined();
  });

  it("keeps the busy-guard lease meaningful without D1 writes", async () => {
    const id = uuid();
    const owner = "anon:quota-lease";
    const { db } = makeQuotaDb();
    expect(await acquireTurnLease(db, id, owner, "turn-1", 30)).toBe(true);
    expect(await acquireTurnLease(db, id, owner, "turn-2", 30)).toBe(false);
    await releaseTurnLease(db, id, "turn-1");
    expect(await acquireTurnLease(db, id, owner, "turn-3", 30)).toBe(true);
  });

  it("never leaks another owner's ephemeral conversations", async () => {
    const { db } = makeQuotaDb();
    const mine = await createConversation(db, "anon:mine", { mode: "auto" });
    await ensureUserMessage(db, { conversationId: mine.id, ownerKey: "anon:mine", clientMessageId: uuid(), text: "private" });

    const strangerDetail = await getConversation(db, mine.id, "anon:stranger");
    expect(strangerDetail?.messages).toEqual([]);
    expect(strangerDetail?.messageCount).toBe(0);

    const strangerList = await listConversations(db, "anon:stranger", 50);
    expect(strangerList.some(item => item.id === mine.id)).toBe(false);
  });

  it("blocks provider work when its durable quota reservation cannot be written", async () => {
    const { db } = makeQuotaDb();
    const quota = { rpmLimit: 10, inputTpmLimit: 100_000, rpdLimit: 200, reserveFraction: 0.2 };
    await expect(reserveGeminiAttempt(db, {
      id: "quota-audit", conversationId: null, model: "gemini-2.5-flash",
      estimatedInputTokens: 100, quota,
    })).rejects.toMatchObject({ code: "gemini_reservation_unavailable" });
  });
});
