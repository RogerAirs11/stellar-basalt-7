import type { AiClientStreamEvent } from "../contracts/platform";
import { PlatformClientError } from "./errors";

/** Bound one untrusted SSE event, not the whole conversation (UTF-16 code units). */
export const MAX_AI_SSE_EVENT_CHARS = 1_048_576;

function invalidEvent(): never {
  throw new PlatformClientError(502, "ai_stream_invalid_event", "AI stream returned a malformed event");
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function eventFromData(data: string): AiClientStreamEvent | null {
  let value: unknown;
  try { value = JSON.parse(data); } catch { return invalidEvent(); }
  if (!isRecord(value) || typeof value.type !== "string") return invalidEvent();
  const strings = (...keys: string[]) => keys.every(key => typeof value[key] === "string");
  switch (value.type) {
    case "meta": if (!strings("conversationId")) return invalidEvent(); break;
    case "text_delta": if (!strings("text")) return invalidEvent(); break;
    case "draft_reset": break;
    case "status": if (!strings("code", "text")) return invalidEvent(); break;
    case "trace": if (!strings("at", "phase")) return invalidEvent(); break;
    case "evidence": if (!Array.isArray(value.evidence) || !Array.isArray(value.entityRefs)) return invalidEvent(); break;
    case "usage": if (!isRecord(value.usage) || !strings("provider", "model")) return invalidEvent(); break;
    case "done": {
      const message = value.message;
      if (!isRecord(message) || !["id", "text", "role", "createdAt"].every(key => typeof message[key] === "string")) return invalidEvent();
      break;
    }
    case "error": if (!strings("code", "message")) return invalidEvent(); break;
    // Additive future nonterminal events can be ignored by an older client.
    default: return null;
  }
  return value as AiClientStreamEvent;
}

/** Streaming SSE framing: CR/LF/CRLF, split UTF-8 (by caller), comments and multi-line data. */
export class AiSseDecoder {
  private line = "";
  private data: string[] = [];
  private eventChars = 0;
  private afterCr = false;

  constructor(private readonly maxEventChars = MAX_AI_SSE_EVENT_CHARS) {
    if (!Number.isSafeInteger(maxEventChars) || maxEventChars < 1) throw new RangeError("Invalid SSE event budget");
  }

  *push(text: string): Iterable<AiClientStreamEvent> {
    let start = 0;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (this.afterCr) {
        this.afterCr = false;
        if (char === "\n") { start = index + 1; continue; }
      }
      if (char !== "\r" && char !== "\n") continue;
      this.append(text.slice(start, index));
      const event = this.consumeLine();
      this.afterCr = char === "\r";
      start = index + 1;
      if (event) yield event;
    }
    this.append(text.slice(start));
  }

  private append(fragment: string): void {
    if (this.eventChars + this.line.length + fragment.length > this.maxEventChars) {
      throw new PlatformClientError(502, "ai_stream_event_too_large", "AI stream event exceeds the client safety limit");
    }
    this.line += fragment;
  }

  private consumeLine(): AiClientStreamEvent | null {
    const line = this.line;
    this.line = "";
    if (line === "") {
      const data = this.data;
      this.data = [];
      this.eventChars = 0;
      return data.length ? eventFromData(data.join("\n")) : null;
    }
    this.eventChars += line.length + 1;
    if (this.eventChars > this.maxEventChars) {
      throw new PlatformClientError(502, "ai_stream_event_too_large", "AI stream event exceeds the client safety limit");
    }
    if (line === "data") this.data.push("");
    else if (line.startsWith("data:")) this.data.push(line.slice(5).replace(/^ /, ""));
    return null;
  }
}
