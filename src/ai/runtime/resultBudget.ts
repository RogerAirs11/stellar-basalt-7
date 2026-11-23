/**
 * Provider-facing result compaction that preserves successful research work.
 * It is deliberately domain-neutral: operation batches keep one entry per
 * operation and nested data is progressively summarized until it fits.
 */
export interface CompactedToolResult {
  output: unknown;
  truncated: boolean;
  originalCharacters: number;
  resultCharacters: number;
}

export function compactToolResult(output: unknown, maxCharacters: number): CompactedToolResult {
  const max = Math.max(256, Math.floor(maxCharacters));
  const originalCharacters = jsonLength(output);
  if (originalCharacters <= max) return { output, truncated: false, originalCharacters, resultCharacters: originalCharacters };

  let candidate = compactBatch(output, max);
  if (jsonLength(candidate) > max) candidate = compactValue(candidate, Math.max(128, max - 1));
  if (jsonLength(candidate) > max) candidate = hardSummary(output, max, originalCharacters);

  return {
    output: candidate,
    truncated: true,
    originalCharacters,
    resultCharacters: jsonLength(candidate),
  };
}

function compactBatch(output: unknown, max: number): unknown {
  if (!isRecord(output) || !Array.isArray(output.results)) return withTruncationMeta(compactValue(output, max - 120), output, max);
  const results = output.results;
  const base = Object.fromEntries(Object.entries(output).filter(([key]) => key !== "results"));
  const overhead = jsonLength({ ...base, results: [], truncated: true, originalCharacters: jsonLength(output) });
  const available = Math.max(96, max - overhead - 16);
  const perOperation = Math.max(48, Math.floor(available / Math.max(1, results.length)));
  const compacted = results.map((result) => compactOperation(result, perOperation));
  let candidate: Record<string, unknown> = {
    ...base,
    results: compacted,
    truncated: true,
    originalCharacters: jsonLength(output),
    note: "Successful research results were compacted to the active AI context budget; request a cursor/narrower operation for omitted detail.",
  };
  if (jsonLength(candidate) <= max) return candidate;

  // Notes/metadata are less important than keeping every operation represented.
  delete candidate.note;
  if (jsonLength(candidate) <= max) return candidate;
  candidate = { ...base, results: results.map(minimalOperation), truncated: true };
  return candidate;
}

function compactOperation(value: unknown, budget: number): unknown {
  if (jsonLength(value) <= budget) return value;
  const compacted = compactValue(value, budget);
  if (jsonLength(compacted) <= budget) return compacted;
  return minimalOperation(value);
}

function minimalOperation(value: unknown): unknown {
  if (!isRecord(value)) return { truncated: true, value: shortScalar(value) };
  const keep = ["op", "ok", "found", "horseId", "personId", "fromId", "toId", "section", "query", "field", "total", "count", "evidenceId", "hasMore", "cursor", "available", "reason", "error"];
  const result: Record<string, unknown> = { truncated: true };
  for (const key of keep) if (key in value && isSmallScalar(value[key])) result[key] = value[key];
  if (!("op" in result) && typeof value.op === "string") result.op = value.op;
  return result;
}

function compactValue(value: unknown, budget: number, depth = 0): unknown {
  if (jsonLength(value) <= budget) return value;
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return excerpt(value, Math.max(24, budget - 8));
  if (depth >= 5) return shortScalar(value);

  if (Array.isArray(value)) {
    if (!value.length) return value;
    const wrapperOverhead = 32;
    const itemBudget = Math.max(32, Math.floor((budget - wrapperOverhead) / Math.min(value.length, 8)));
    const kept: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const next = compactValue(value[i], itemBudget, depth + 1);
      const trial = [...kept, next];
      if (jsonLength(trial) > budget - 24 && kept.length) break;
      kept.push(next);
      if (kept.length >= 8) break;
    }
    if (kept.length < value.length) kept.push({ truncated: true, omittedItems: value.length - kept.length });
    return kept;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    const result: Record<string, unknown> = {};
    const scalarEntries = entries.filter(([, v]) => isSmallScalar(v));
    for (const [key, v] of scalarEntries) result[key] = v;
    const complex = entries.filter(([, v]) => !isSmallScalar(v));
    const remaining = Math.max(64, budget - jsonLength(result) - 24);
    const each = Math.max(32, Math.floor(remaining / Math.max(1, complex.length)));
    for (const [key, v] of complex) {
      const compacted = compactValue(v, each, depth + 1);
      const trial = { ...result, [key]: compacted };
      if (jsonLength(trial) <= budget) result[key] = compacted;
    }
    if (entries.some(([key]) => !(key in result))) result.truncated = true;
    return result;
  }
  return String(value).slice(0, Math.max(8, budget));
}

function withTruncationMeta(compacted: unknown, original: unknown, max: number): unknown {
  if (isRecord(compacted)) {
    const candidate = { ...compacted, truncated: true, originalCharacters: jsonLength(original) };
    if (jsonLength(candidate) <= max) return candidate;
  }
  return compacted;
}

function hardSummary(output: unknown, max: number, originalCharacters: number): unknown {
  const summary = isRecord(output) && Array.isArray(output.results)
    ? { ok: output.ok ?? true, results: output.results.map(minimalOperation), truncated: true, originalCharacters }
    : { ok: isRecord(output) ? output.ok ?? true : true, truncated: true, originalCharacters, summary: shortScalar(output) };
  const text = JSON.stringify(summary);
  if (text.length <= max) return summary;
  // The configured tool budget is normally >=900 chars. This last branch keeps
  // serialization bounded even under an unexpectedly tiny caller budget.
  return { truncated: true, originalCharacters };
}

function excerpt(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max < 28) return value.slice(0, max);
  const marker = " …[truncated]… ";
  const remaining = Math.max(1, max - marker.length);
  const head = Math.ceil(remaining * 0.72);
  return value.slice(0, head) + marker + value.slice(-(remaining - head));
}

function shortScalar(value: unknown): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return excerpt(value, 120);
  if (Array.isArray(value)) return { itemCount: value.length };
  if (isRecord(value)) return { keys: Object.keys(value).slice(0, 12), truncated: true };
  return String(value).slice(0, 120);
}

function isSmallScalar(value: unknown): boolean {
  return value == null || typeof value === "number" || typeof value === "boolean" || (typeof value === "string" && value.length <= 120);
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function jsonLength(value: unknown): number { try { return JSON.stringify(value).length; } catch { return Number.MAX_SAFE_INTEGER; } }
