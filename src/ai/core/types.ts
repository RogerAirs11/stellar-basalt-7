export type AiProviderId = "gemini" | "deepseek" | "offline";
export type AiExecutionMode = "fast" | "auto" | "research";
export type AiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "max";
export type AiConversationRole = "user" | "assistant" | "system_event";

export interface AiImageReference {
  kind: "image";
  url: string;
  mimeType?: string | null;
  altText?: string | null;
}

export interface AiConversationMessage {
  id: string;
  role: AiConversationRole;
  text: string;
  clientMessageId?: string | null;
  provider?: AiProviderId | null;
  model?: string | null;
  status?: "pending" | "complete" | "error" | "cancelled";
  evidence?: AiEvidenceReference[];
  entityRefs?: AiEntityReference[];
  attachments?: AiImageReference[];
  createdAt: string;
}

export interface AiConversationSummary {
  id: string;
  title: string | null;
  locale: string;
  executionMode: AiExecutionMode;
  preferredProvider?: AiProviderId | null;
  preferredModel?: string | null;
  activeProvider: AiProviderId | null;
  activeModel: string | null;
  updatedAt: string;
  lastActivityAt: string;
  messageCount?: number;
  busy?: boolean;
  /** True while the D1 write quota is exhausted: the conversation lives only in
   *  the browser session + worker isolate and is not durably persisted. */
  ephemeral?: boolean;
}

export interface AiConversationDetail extends AiConversationSummary {
  messages: AiConversationMessage[];
}

export type AiEvidenceKind = string;

export interface AiCompleteness {
  total?: number | null;
  returned?: number | null;
  truncated?: boolean;
  hasMore?: boolean;
  cursor?: string | null;
  coveragePercent?: number | null;
  note?: string | null;
}

export interface AiEntityReference {
  kind: string;
  id: string;
  label: string;
  href: string;
  subtitle?: string | null;
}

export interface AiEvidenceReference {
  id: string;
  kind: AiEvidenceKind;
  title: string;
  sourceRef: string;
  entityRefs?: AiEntityReference[];
  completeness?: AiCompleteness;
}

export interface AiEvidence extends AiEvidenceReference {
  payload: unknown;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cachedTokens: number;
  toolTokens: number;
  totalTokens: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
}

export interface AiProviderCapabilities {
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsThinking: boolean;
  supportedThinkingLevels: readonly AiThinkingLevel[];
  supportsTools: boolean;
  supportsParallelTools: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsStatefulConversation: boolean;
  supportsImplicitCaching: boolean | "unknown";
  providerManagedStateRetentionSeconds?: number;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface AiToolResult {
  callId: string;
  name: string;
  output: unknown;
}

export interface ProviderConversationTurn {
  role: "user" | "assistant";
  text: string;
  attachments?: AiImageReference[];
}

export interface ProviderTurnInput {
  model: string;
  systemInstruction: string;
  conversation: ProviderConversationTurn[];
  latestUserText: string;
  latestAttachments?: AiImageReference[];
  tools: AiToolDefinition[];
  thinkingLevel: AiThinkingLevel;
  maxOutputTokens: number;
  toolChoice?: "auto" | "none" | "validated";
  /** Explicit structured editorial output; adapters must opt in to support it. */
  responseFormat?: "json_object";
  providerState?: unknown;
  previousInteractionId?: string | null;
  toolResults?: AiToolResult[];
  abortSignal?: AbortSignal;
  userId?: string;
  /** Maximum token budget for retaining exact opaque provider replay state. */
  providerReplayTokenBudget?: number;
}

export interface ProviderTurnOutput {
  provider: AiProviderId;
  model: string;
  text: string;
  toolCalls: AiToolCall[];
  usage: AiUsage;
  providerState?: unknown;
  interactionId?: string | null;
  finishReason?: string | null;
}

export type AiProviderStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "draft_reset" }
  | { type: "tool_call_delta"; callId: string; name?: string; argumentsDelta?: string }
  | { type: "tool_call"; call: AiToolCall }
  | { type: "usage"; usage: AiUsage }
  | { type: "provider_state"; providerState?: unknown; interactionId?: string | null }
  | { type: "done"; output: ProviderTurnOutput };

export interface AiContextDecision {
  estimatedInputTokens: number;
  modelContextHeadroom: number;
  configuredTpmHeadroom: number | null;
  safeInputBudget: number;
  shouldRebaseProviderState: boolean;
  suggestedEvidenceCharacters: number;
  reason: string;
}

export interface AiQuotaSnapshot {
  provider: AiProviderId;
  model: string;
  requestsLastMinute: number;
  estimatedInputTokensLastMinute: number;
  requestsToday: number;
  configuredRpmLimit: number | null;
  configuredInputTpmLimit: number | null;
  configuredRpdLimit: number | null;
  reserveFraction: number;
}

export interface AiCostEstimate {
  worstCaseInputCostUsd: number;
  worstCaseOutputCostUsd: number;
  worstCaseTotalCostUsd: number;
  allowed: boolean;
  reason: string;
}

export interface AiAssistantModelDescriptor {
  provider: AiProviderId;
  id: string;
  label: string;
  available: boolean;
  vision: boolean;
  paid: boolean;
  defaultForChat?: boolean;
}

export interface AiAssistantStatus {
  available: boolean;
  defaultModel: string | null;
  models: AiAssistantModelDescriptor[];
  visionAvailable: boolean;
  storageReady: boolean;
  reason?: string | null;
}

export type AiClientStreamEvent =
  | { type: "meta"; conversationId: string; messageId?: string; provider?: AiProviderId; model?: string }
  | { type: "text_delta"; text: string }
  | { type: "draft_reset" }
  | { type: "status"; code: string; text: string }
  | { type: "trace"; at: string; phase: string; data?: Record<string, unknown> }
  | { type: "evidence"; evidence: AiEvidenceReference[]; entityRefs: AiEntityReference[] }
  | { type: "usage"; usage: AiUsage; provider: AiProviderId; model: string }
  | { type: "done"; message: AiConversationMessage }
  | { type: "error"; code: string; message: string; details?: unknown };
