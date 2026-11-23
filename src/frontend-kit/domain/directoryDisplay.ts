/** Display both legacy free text and JSON-encoded language lists without exposing storage syntax. */
import type { EngineLocale } from "../runtime";
import { kitNumberTag } from "./engineText";

export function formatDirectoryLanguages(value: string | readonly string[] | null | undefined, locale: EngineLocale): string {
  let languages: readonly string[];
  if (Array.isArray(value)) languages = value;
  else if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "—";
    try {
      const parsed: unknown = JSON.parse(text);
      languages = Array.isArray(parsed) && parsed.every(item => typeof item === "string") ? parsed : [text];
    } catch { languages = [text]; }
  } else return "—";
  const entries = [...new Set(languages.map(item => item.trim()).filter(Boolean))];
  return entries.map(language => {
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)) return language;
    try { return new Intl.DisplayNames([kitNumberTag(locale)], { type: "language", fallback: "code" }).of(language) || language; }
    catch { return language; }
  }).join(" · ") || "—";
}
