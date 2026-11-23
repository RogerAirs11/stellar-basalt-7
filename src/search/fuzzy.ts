export function damerauLevenshtein(a: string, b: string, maxDistance = 4): number {
  if (a === b) return 0;
  if (!a.length) return b.length <= maxDistance ? b.length : maxDistance + 1;
  if (!b.length) return a.length <= maxDistance ? a.length : maxDistance + 1;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  // Optimal-string-alignment Damerau-Levenshtein with a narrow edit band.
  // Only three rows are retained because transposition needs d[i-2][j-2].
  // This avoids allocating an O(a*b) matrix on a Worker hot path.
  const inf = maxDistance + 1;
  let prevPrev = new Int16Array(b.length + 1);
  let prev = new Int16Array(b.length + 1);
  let curr = new Int16Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j <= maxDistance ? j : inf;
  prevPrev.fill(inf);

  for (let i = 1; i <= a.length; i++) {
    curr.fill(inf);
    curr[0] = i <= maxDistance ? i : inf;
    const start = Math.max(1, i - maxDistance);
    const end = Math.min(b.length, i + maxDistance);
    let rowMin = inf;
    for (let j = start; j <= end; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2]! + 1);
      }
      curr[j] = value > inf ? inf : value;
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > maxDistance) return inf;
    const oldPrevPrev = prevPrev;
    prevPrev = prev;
    prev = curr;
    curr = oldPrevPrev;
  }
  const distance = prev[b.length]!;
  return distance <= maxDistance ? distance : inf;
}

export function fuzzySimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  const threshold = maxLen <= 5 ? 1 : maxLen <= 9 ? 2 : 3;
  const distance = damerauLevenshtein(a, b, threshold);
  if (distance > threshold) return 0;
  return Math.max(0, 1 - distance / maxLen);
}

/**
 * C4-1 bounded fuzzy candidate generation (trigram OR-relaxation).
 *
 * A single-character typo can break every exact/prefix/trigram-phrase candidate
 * path (adjacent transpositions share zero trigrams with the intended token),
 * so the fuzzy scorer never sees a candidate. This builder emits ONE bounded,
 * deterministic FTS5 expression over the existing trigram index:
 *   - the token's own trigrams, plus the trigrams of every single-character
 *     deletion variant (deletion variants bridge transpositions and substitutions
 *     with at least one shared trigram);
 *   - deduplicated, capped at 64 OR terms, token length bounded to 5..24 chars;
 *   - null when the caller should skip the path (too short/too long).
 *
 * The candidate set is still filtered exclusively by the existing
 * Damerau-Levenshtein fuzzy scoring (>= 0.65 name similarity), so recall widens
 * without changing admission semantics.
 */
export function buildFuzzyTrigramExpression(token: string): string | null {
  if (token.length < 5 || token.length > 24) return null;
  const variants: string[] = [token];
  for (let i = 0; i < token.length; i++) {
    variants.push(token.slice(0, i) + token.slice(i + 1));
  }
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const variant of variants) {
    for (let i = 0; i + 3 <= variant.length; i++) {
      const trigram = variant.slice(i, i + 3);
      if (seen.has(trigram)) continue;
      seen.add(trigram);
      terms.push(`"${trigram.replaceAll('"', '""')}"`);
      if (terms.length >= 64) return terms.join(" OR ");
    }
  }
  return terms.length ? terms.join(" OR ") : null;
}
