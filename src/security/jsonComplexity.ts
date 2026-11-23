import { HttpError } from "../api/http";

/**
 * Structural-complexity limits for arbitrary JSON workflow evidence (D11).
 *
 * Body-byte caps alone still allow pathological structures (very deep nesting, huge
 * containers, oversized single strings) inside the byte budget. This guard bounds the
 * structure itself before workflow persistence / audit serialization. The per-container
 * and per-string ceilings are pinned by the lost-checkpoint regression boundaries:
 * a 129-entry container is rejected (max width 128) and a 17 KiB string is rejected
 * (max 16 KiB). Depth and total-node ceilings are conservative named constants with
 * explicit boundary tests; they are deliberately small so the guard stays meaningful.
 */
export const JSON_COMPLEXITY_LIMITS = {
  /** Maximum nesting depth of the value tree (root value = depth 1). */
  maxDepth: 24,
  /** Maximum total nodes (objects, arrays, primitives) across the value tree. */
  maxTotalNodes: 2048,
  /** Maximum entries per array/object container. */
  maxContainerEntries: 128,
  /** Maximum object key length in characters. */
  maxKeyLength: 128,
  /** Maximum individual string length in UTF-8 bytes. */
  maxStringBytes: 16 * 1024,
} as const;

interface Frame {
  value: unknown;
  depth: number;
}

/**
 * Iterative (explicit heap stack — no recursion, no stack-overflow crash path) check that
 * a JSON value stays within the structural-complexity envelope. Throws a controlled 400
 * `evidence_too_complex` HttpError on the first violated ceiling.
 */
export function assertJsonEvidenceComplexity(value: unknown, field = "evidence"): void {
  const limits = JSON_COMPLEXITY_LIMITS;
  const encoder = new TextEncoder();
  let visitedNodes = 0;
  const stack: Frame[] = [{ value, depth: 1 }];

  while (stack.length > 0) {
    const frame = stack.pop() as Frame;
    visitedNodes += 1;
    if (visitedNodes > limits.maxTotalNodes) {
      fail(field, `exceeds the total-node ceiling (${limits.maxTotalNodes} nodes)`, "total_nodes");
    }
    if (frame.depth > limits.maxDepth) {
      fail(field, `exceeds the nesting-depth ceiling (${limits.maxDepth} levels)`, "depth");
    }

    const node = frame.value;
    if (node === null || node === undefined) continue;
    if (Array.isArray(node)) {
      if (node.length > limits.maxContainerEntries) {
        fail(field, `exceeds the container-entry ceiling (${limits.maxContainerEntries} entries per array/object)`, "container_entries");
      }
      for (const entry of node) stack.push({ value: entry, depth: frame.depth + 1 });
    } else if (typeof node === "object") {
      const entries = Object.entries(node as Record<string, unknown>);
      if (entries.length > limits.maxContainerEntries) {
        fail(field, `exceeds the container-entry ceiling (${limits.maxContainerEntries} entries per array/object)`, "container_entries");
      }
      for (const [key, child] of entries) {
        if (key.length > limits.maxKeyLength) {
          fail(field, `exceeds the key-length ceiling (${limits.maxKeyLength} characters)`, "key_length");
        }
        stack.push({ value: child, depth: frame.depth + 1 });
      }
    } else if (typeof node === "string") {
      if (encoder.encode(node).length > limits.maxStringBytes) {
        fail(field, `exceeds the string-length ceiling (${limits.maxStringBytes} UTF-8 bytes per string)`, "string_bytes");
      }
    }
  }
}

function fail(field: string, reason: string, limit: string): never {
  throw new HttpError(400, "evidence_too_complex", `JSON ${field} ${reason}`, { field, limit });
}
