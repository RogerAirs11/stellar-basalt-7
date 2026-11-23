import { normalizeText, tokens } from "./normalize";

export type SearchField = "name" | "father" | "mother" | "owner" | "breeder" | "importer" | "passportReceiver" | "year" | "breed" | "place" | "color" | "strain" | "imported" | "id";

export interface ParsedQuery {
  raw: string;
  normalized: string;
  freeTokens: string[];
  fields: Partial<Record<SearchField, string[]>>;
}

const FIELD_ALIASES: Record<string, SearchField> = {
  name: "name", horse: "name",
  sire: "father", father: "father",
  dam: "mother", mother: "mother",
  owner: "owner", breeder: "breeder", importer: "importer",
  passport: "passportReceiver", passportreceiver: "passportReceiver", passport_receiver: "passportReceiver",
  year: "year", born: "year",
  breed: "breed", place: "place",
  color: "color", colour: "color", strain: "strain", bloodline: "strain", imported: "imported", origin: "imported",
  id: "id", no: "id",
};

// Splits on whitespace while keeping quoted phrases, e.g. owner:"ali reza".
function lex(raw: string): string[] {
  const out: string[] = [];
  const re = /(?:[^\s"]+?:)?"[^"]*"|\S+/g;
  for (const match of raw.matchAll(re)) out.push(match[0]);
  return out;
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

export function parseSearchQuery(raw: string): ParsedQuery {
  const normalized = normalizeText(raw);
  const fields: ParsedQuery["fields"] = {};
  const freeTokens: string[] = [];

  for (const part of lex(raw)) {
    const colon = part.indexOf(":");
    if (colon > 0) {
      const maybeField = FIELD_ALIASES[normalizeText(part.slice(0, colon))];
      const value = normalizeText(unquote(part.slice(colon + 1)));
      if (maybeField && value) {
        (fields[maybeField] ??= []).push(value);
        continue;
      }
    }
    freeTokens.push(...tokens(unquote(part)));
  }

  return { raw, normalized, freeTokens, fields };
}

function quoteFts(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function prefixPhrase(value: string): string {
  const parts = tokens(value);
  return parts.map((t) => `${quoteFts(t)}*`).join(" AND ");
}

export function toFtsExpression(parsed: ParsedQuery): string | null {
  const clauses: string[] = [];
  for (const token of parsed.freeTokens) {
    if (/^[\p{L}\p{N}-]+$/u.test(token)) clauses.push(`all_text:${quoteFts(token)}*`);
  }
  const fieldMap: Partial<Record<SearchField, string[]>> = {
    name: ["name_latin", "name_native"],
    father: ["father_name"],
    mother: ["mother_name"],
    owner: ["owners"],
    breeder: ["breeders"],
    importer: ["all_text"],
    passportReceiver: ["all_text"],
    breed: ["breed"],
    place: ["places"],
    color: ["all_text"],
    strain: ["breed"],
    imported: ["places"],
  };
  for (const [field, values] of Object.entries(parsed.fields) as [SearchField, string[]][]) {
    const columns = fieldMap[field];
    if (!columns) continue; // year/id receive structured scoring instead.
    const alternatives: string[] = [];
    for (const value of values) {
      const expr = prefixPhrase(value);
      if (!expr) continue;
      alternatives.push(columns.length === 1 ? `${columns[0]}:(${expr})` : `(${columns.map((c) => `${c}:(${expr})`).join(" OR ")})`);
    }
    // Same-field values are alternatives, matching the final structured
    // predicate. Different fields and words within a value remain conjunctive.
    if (alternatives.length) clauses.push(`(${alternatives.join(" OR ")})`);
  }
  return clauses.length ? clauses.join(" AND ") : null;
}
