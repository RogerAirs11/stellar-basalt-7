import type { AiEntityReference } from "../../contracts/platform";

export interface EntityLinkResult {
  text: string;
  /** `${kind}:${id}` keys for every reference that was linked inside the text. */
  linkedKeys: Set<string>;
}

/**
 * Turn horse/person names that an AI answer already mentions into clickable
 * markdown links to their profiles. Runs on the raw markdown BEFORE rendering:
 *  - existing markdown links, inline code, code fences and bare URLs are left
 *    untouched (they are split off as protected segments first);
 *  - only whole-token matches count (Unicode word boundaries), so "Nazeer"
 *    does not match inside "Nazeerabad";
 *  - longest labels are matched first in a single pass, so "Shagya Azraf"
 *    wins over "Shagya" and links never nest.
 */
export function linkEntityMentions(text: string, refs?: AiEntityReference[] | null): EntityLinkResult {
  const linkedKeys = new Set<string>();
  if (!text || !refs?.length) return { text, linkedKeys };

  const byLabel = new Map<string, { href: string; key: string }>();
  for (const ref of refs) {
    if (ref.kind !== "horse" && ref.kind !== "person") continue;
    const label = String(ref.label ?? "").trim();
    if (label.length < 3) continue;
    const href = ref.kind === "horse" ? `/horse/${encodeURIComponent(ref.id)}` : `/person/${encodeURIComponent(ref.id)}`;
    if (!byLabel.has(label)) byLabel.set(label, { href, key: `${ref.kind}:${ref.id}` });
  }
  if (!byLabel.size) return { text, linkedKeys };

  const labels = [...byLabel.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${labels.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  // Protect already-linkable spans: markdown links/images, inline code, bare URLs.
  const protect = /(!?\[[^\]]*\]\([^\n)]+\)|`[^`\n]+`|https?:\/\/[^\s<]+)/g;
  const out: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(protect)) {
    const index = match.index ?? 0;
    if (index > cursor) out.push(transformPlain(text.slice(cursor, index), pattern, byLabel, linkedKeys));
    out.push(match[0]);
    cursor = index + match[0].length;
  }
  if (cursor < text.length) out.push(transformPlain(text.slice(cursor), pattern, byLabel, linkedKeys));
  return { text: out.join(""), linkedKeys };
}

function transformPlain(segment: string, pattern: RegExp, byLabel: Map<string, { href: string; key: string }>, linkedKeys: Set<string>): string {
  return segment.replace(pattern, (label) => {
    const entry = byLabel.get(label);
    if (!entry) return label;
    linkedKeys.add(entry.key);
    // Escape markdown-significant characters so a label cannot break the
    // generated link syntax when rendered.
    const safe = label.replace(/([[\]*_~`])/g, "\\$1");
    return `[${safe}](${entry.href})`;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
