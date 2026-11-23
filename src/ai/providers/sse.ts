export interface SseEvent { event?: string; data: string }
export interface SseLimits {
  maxEventCharacters?: number;
  maxStreamCharacters?: number;
}

/** Bounded SSE decoding shared by provider transports, not a JSON parser. */
export async function* parseSse(response: Response, limits: SseLimits = {}): AsyncIterable<SseEvent> {
  if (!response.body) throw new Error("Missing SSE response body");
  const maxEvent = limits.maxEventCharacters ?? 1_048_576;
  const maxStream = limits.maxStreamCharacters ?? 16_777_216;
  if (!Number.isSafeInteger(maxEvent) || maxEvent <= 0 || !Number.isSafeInteger(maxStream) || maxStream < maxEvent) {
    throw new Error("Invalid SSE limits");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let totalCharacters = 0;
  let eventCharacters = 0;
  let event: string | undefined;
  let data: string[] = [];
  let ended = false;
  try {
    while (!ended) {
      const next = await reader.read();
      ended = next.done;
      const text = ended ? decoder.decode() : decoder.decode(next.value, { stream: true });
      totalCharacters += text.length;
      if (totalCharacters > maxStream) throw new Error("SSE stream exceeded its size limit");
      buffer += text;
      // CR, LF and CRLF are all legal line endings. Preserve a trailing CR
      // until the next read so split CRLF is not mistaken for an empty line.
      while (true) {
        const boundary = buffer.search(/[\r\n]/);
        if (boundary < 0 || (!ended && buffer[boundary] === "\r" && boundary === buffer.length - 1)) break;
        const line = buffer.slice(0, boundary);
        const separator = buffer[boundary] === "\r" && buffer[boundary + 1] === "\n" ? 2 : 1;
        buffer = buffer.slice(boundary + separator);
        eventCharacters += line.length + separator;
        if (eventCharacters > maxEvent) throw new Error("SSE event exceeded its size limit");
        if (!line) {
          const parsed = data.length ? { event, data: data.join("\n") } : null;
          data = [];
          event = undefined;
          eventCharacters = 0;
          if (parsed) yield parsed;
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1); // Exactly one optional space.
        if (field === "event") event = value;
        if (field === "data") data.push(value);
      }
      if (eventCharacters + buffer.length > maxEvent) throw new Error("SSE event exceeded its size limit");
    }
    // Never dispatch an unterminated data frame as an authoritative result.
    if (data.length || (buffer && !buffer.startsWith(":"))) throw new Error("SSE stream ended inside an event");
  } finally {
    // Early consumer return, malformed data and limits must stop the transport.
    if (!ended) { try { await reader.cancel(); } catch { /* preserve the original failure */ } }
    reader.releaseLock();
  }
}
