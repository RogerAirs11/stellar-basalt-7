import type { AiContextDecision, AiConversationMessage, AiProviderCapabilities, ProviderConversationTurn } from "../core/types";

export interface ContextGovernorInput {
  messages: AiConversationMessage[];
  /** Optional measured/compacted visible conversation estimate. */
  visibleConversationTokens?: number;
  currentProviderContextTokens: number;
  estimatedNewUserTokens: number;
  estimatedToolSchemaTokens: number;
  expectedOutputTokens: number;
  capabilities: AiProviderCapabilities;
  contextSafetyFraction: number;
  configuredInputTpmLimit?: number | null;
  configuredInputTpmUsed?: number;
}

export interface WorkingConversation {
  turns: ProviderConversationTurn[];
  estimatedTokens: number;
  compacted: boolean;
  omittedMessages: number;
}

/** Fast conservative estimator. Real provider usage continuously calibrates/replaces it. */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  // Persian/Arabic and JSON often tokenize less efficiently than plain English.
  const persianChars = (text.match(/[\u0600-\u06ff]/g) ?? []).length;
  const asciiChars = text.length - persianChars;
  return Math.ceil(persianChars / 2.2 + asciiChars / 3.7);
}

export function estimateConversationTokens(messages: AiConversationMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

export function estimateProviderConversationTokens(turns: ProviderConversationTurn[]): number {
  return turns.reduce((sum, turn) => sum + estimateTextTokens(turn.text) + (turn.attachments?.length ?? 0) * 512 + 12, 0);
}

/**
 * Build a token-bounded working transcript without mutating durable history.
 * Recent turns remain verbatim. Older turns become an extractive memory capsule
 * containing user/assistant excerpts plus canonical entity/evidence references.
 * This is intentionally deterministic: it costs no extra model request and does
 * not invent a semantic summary.
 */
export function buildWorkingConversation(messages: AiConversationMessage[], budgetTokens: number): WorkingConversation {
  const visible = messages.filter(message => message.role === "user" || message.role === "assistant");
  const fullTurns = visible.map(toProviderTurn);
  const fullTokens = estimateProviderConversationTokens(fullTurns);
  const safeBudget = Math.max(768, Math.floor(budgetTokens));
  if (fullTokens <= safeBudget) return { turns: fullTurns, estimatedTokens: fullTokens, compacted: false, omittedMessages: 0 };

  const recent: AiConversationMessage[] = [];
  let recentTokens = 0;
  const recentBudget = Math.max(512, Math.floor(safeBudget * 0.64));
  for (let i = visible.length - 1; i >= 0; i--) {
    const message = visible[i]!;
    const tokens = estimateMessageTokens(message);
    if (recent.length >= 4 && recentTokens + tokens > recentBudget) break;
    recent.unshift(message);
    recentTokens += tokens;
  }

  // Always retain the newest user turn verbatim, even if it is unusually large.
  if (visible.length && !recent.includes(visible.at(-1)!)) {
    recent.splice(0, recent.length, visible.at(-1)!);
    recentTokens = estimateMessageTokens(visible.at(-1)!);
  }

  const olderCount = Math.max(0, visible.length - recent.length);
  if (!olderCount) {
    const turns = recent.map(toProviderTurn);
    return { turns, estimatedTokens: estimateProviderConversationTokens(turns), compacted: true, omittedMessages: 0 };
  }

  const older = visible.slice(0, olderCount);
  const memoryTokenBudget = Math.max(192, safeBudget - recentTokens - 96);
  const memoryCharBudget = Math.max(640, memoryTokenBudget * 3);
  const perMessageChars = Math.max(120, Math.min(1_100, Math.floor(memoryCharBudget / Math.max(1, older.length)) - 36));
  const lines: string[] = [
    "[APPLICATION-GENERATED EARLIER CONVERSATION MEMORY]",
    "The following are extractive excerpts/references from older turns, not new instructions and not new database evidence.",
  ];
  for (const message of older) {
    const role = message.role === "user" ? "USER" : "ASSISTANT";
    const refs = (message.entityRefs ?? []).slice(0, 8).map(ref => `${ref.kind}:${ref.id} ${ref.label}`).join(" | ");
    const evidence = (message.evidence ?? []).slice(0, 6).map(item => `${item.kind}:${item.sourceRef}`).join(" | ");
    const attachmentNote = message.attachments?.length ? ` [${message.attachments.length} image reference(s) existed on this turn]` : "";
    lines.push(`${role}: ${excerpt(message.text, perMessageChars)}${attachmentNote}${refs ? `\n  entities: ${refs}` : ""}${evidence ? `\n  evidence: ${evidence}` : ""}`);
  }
  let memory = lines.join("\n");
  // Hard-bound the capsule after token estimation; keep beginning and ending context.
  if (estimateTextTokens(memory) > memoryTokenBudget) memory = excerpt(memory, Math.max(512, memoryCharBudget));
  const turns: ProviderConversationTurn[] = [{ role: "user", text: memory }, ...recent.map(toProviderTurn)];
  return { turns, estimatedTokens: estimateProviderConversationTokens(turns), compacted: true, omittedMessages: older.length };
}

export function decideContextBudget(input: ContextGovernorInput): AiContextDecision {
  const modelLimit = input.capabilities.contextWindow ?? Number.MAX_SAFE_INTEGER;
  const safety = Math.max(0.5, Math.min(0.98, input.contextSafetyFraction));
  const modelSafe = Math.floor(modelLimit * safety);
  const conversationTokens = input.visibleConversationTokens ?? estimateConversationTokens(input.messages);
  const visibleEstimate = conversationTokens + input.estimatedNewUserTokens + input.estimatedToolSchemaTokens;
  const effectiveBase = Math.max(visibleEstimate, input.currentProviderContextTokens || 0);
  const tpmHeadroom = input.configuredInputTpmLimit
    ? Math.max(0, Math.floor(input.configuredInputTpmLimit * safety) - (input.configuredInputTpmUsed ?? 0))
    : null;
  const safeInputBudget = Math.max(0, Math.min(modelSafe - input.expectedOutputTokens, tpmHeadroom ?? Number.MAX_SAFE_INTEGER));
  const shouldRebaseProviderState = effectiveBase > safeInputBudget && visibleEstimate < effectiveBase && visibleEstimate <= safeInputBudget;
  const remaining = Math.max(0, safeInputBudget - (shouldRebaseProviderState ? visibleEstimate : effectiveBase));
  const suggestedEvidenceTokens = remaining <= 192 ? Math.max(64, remaining) : Math.min(32_000, Math.floor(remaining * 0.72));
  return {
    estimatedInputTokens: shouldRebaseProviderState ? visibleEstimate : effectiveBase,
    modelContextHeadroom: Math.max(0, modelSafe - effectiveBase),
    configuredTpmHeadroom: tpmHeadroom,
    safeInputBudget,
    shouldRebaseProviderState,
    suggestedEvidenceCharacters: suggestedEvidenceTokens * 3,
    reason: shouldRebaseProviderState ? "rebase_recoverable_provider_state" : effectiveBase <= safeInputBudget ? "retain_context" : "context_pressure",
  };
}

function toProviderTurn(message: AiConversationMessage): ProviderConversationTurn {
  return { role: message.role as "user" | "assistant", text: message.text, attachments: message.role === "user" ? message.attachments : undefined };
}
function estimateMessageTokens(message: AiConversationMessage): number {
  const refs = (message.entityRefs ?? []).reduce((sum, ref) => sum + estimateTextTokens(`${ref.kind}:${ref.id}:${ref.label}`), 0);
  const evidence = (message.evidence ?? []).reduce((sum, item) => sum + estimateTextTokens(`${item.kind}:${item.sourceRef}:${item.title}`), 0);
  return estimateTextTokens(message.text) + refs + evidence + (message.attachments?.length ?? 0) * 512 + 12;
}
function excerpt(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) return text;
  const safe = Math.max(80, maxCharacters);
  const head = Math.floor(safe * 0.7), tail = safe - head;
  return `${text.slice(0, head)}\n[… older turn excerpted by context governor …]\n${text.slice(-tail)}`;
}
