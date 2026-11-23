import type { AiEvidence, AiEvidenceReference, AiEntityReference, AiToolDefinition } from "../core/types";

export interface AiLocalResolution {
  text: string;
  evidence: AiEvidenceReference[];
  entityRefs: AiEntityReference[];
  title: string;
}

export interface AiDomainToolResult {
  output: unknown;
  evidence: AiEvidence[];
}

/**
 * Project/domain boundary for the provider-neutral agent runtime.
 * The runtime never receives Horse-DB SQL/services directly: a domain adapter
 * owns deterministic local resolution, tool execution, policy text and UI status.
 */
export interface AiDomainAdapter {
  readonly id: string;
  buildSystemPolicy(locale: string): string;
  toolDefinitions(): AiToolDefinition[];
  executeTool(name: string, args: unknown, maxResultCharacters: number): Promise<AiDomainToolResult>;
  tryLocalResolve(text: string, locale: string): Promise<AiLocalResolution | null>;
  toolStatus(names: string[]): string;
  toolFailureMessage(name: string): string;
}
