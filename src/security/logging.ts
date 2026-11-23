/** Log a stable error category, never driver messages, SQL, credentials, or request bodies. */
export function safeErrorCategory(cause: unknown): "type_error" | "range_error" | "error" | "non_error" {
  if (cause instanceof TypeError) return "type_error";
  if (cause instanceof RangeError) return "range_error";
  return cause instanceof Error ? "error" : "non_error";
}
