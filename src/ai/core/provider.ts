import type {
  AiProviderCapabilities,
  AiProviderId,
  AiProviderStreamEvent,
  AiToolDefinition,
  ProviderTurnInput,
  ProviderTurnOutput,
} from "./types";

export interface TokenEstimateInput {
  model: string;
  systemInstruction: string;
  conversationText: string;
  tools?: AiToolDefinition[];
}

export interface AiProvider {
  readonly id: AiProviderId;
  capabilities(model: string): AiProviderCapabilities;
  createTurn(input: ProviderTurnInput): Promise<ProviderTurnOutput>;
  continueTurn(input: ProviderTurnInput): Promise<ProviderTurnOutput>;
  streamTurn?(input: ProviderTurnInput): AsyncIterable<AiProviderStreamEvent>;
  countTokens?(input: TokenEstimateInput): Promise<number>;
}
