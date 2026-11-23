/**
 * Presentation contract reconstructed from HorseDbAdapter and the native views.
 * This file contains no seed horses. All records come from the canonical API.
 */
import { normalizeSearch } from '../i18n/domain';
import { horseSexKind } from '../../../../../frontend-kit';

export type Sex = 'Mare' | 'Stallion' | 'Gelding' | 'Unknown';
export type HorseStatus = 'Active' | 'Deceased' | 'Imported' | 'Recorded';

export interface Horse {
  id: string;
  numericId: number;
  name: string;
  nativeName?: string;
  year: number;
  sex: Sex;
  /** Original API text for faithful display; legacy filter category is separate. */
  recordedSex?: string | null;
  breed: string;
  coat: string;
  country: string;
  height: string;
  status: HorseStatus;
  sireId?: string;
  damId?: string;
  sireName?: string;
  damName?: string;
  image: string;
  imageCanonical: boolean;
  stud: string;
  owner: string;
  registration: string;
  description: string;
  knownParents: number;
  imported: boolean;
  aliases?: string[];
  recordedOffspring?: number | null;
  pedigreeCompleteness?: number | null;
  inbreedingCoefficient?: number | null;
}

/**
 * R117-29: the decorative donor category is derived from the canonical kit
 * classifier (exact known vocabulary, never authorization). The raw source
 * value is never rewritten — it stays in `recordedSex` for faithful display;
 * structural breeding position comes from recorded parent relationships
 * (pedigree model `node.side`), never from this category.
 */
export function donorSexCategory(value: string | null | undefined): Sex {
  switch (horseSexKind(value)) {
    case 'female': return 'Mare';
    case 'male': return 'Stallion';
    case 'gelding': return 'Gelding';
    default: return 'Unknown';
  }
}

export interface SexScopeTab { value: string; count: number }

/**
 * R117-29: registry sex scope tabs agree with the backend, not the donor
 * icon enum. Values are the server facets' RAW recorded values (the same
 * strings the canonical registry browse sex filter matches case-insensitively
 * on the server), so every recorded value in the registry is reachable as its
 * own tab — including values the old hardcoded Stallion/Mare/Gelding enum
 * made invisible (colt, filly, Persian variants). Records with no meaningful
 * recorded sex stay under "All records" only — the backend cannot sex-filter
 * them either.
 * Degraded fallback (facets unavailable): distinct recorded values on the
 * current page, counted case-insensitively to mirror the server's NOCASE
 * comparison.
 */
export function sexScopeTabs(
  facetSexes: readonly { value: string; count: number }[] | null | undefined,
  pageHorses: readonly { recordedSex?: string | null }[],
  total: number,
  max = 5,
): SexScopeTab[] {
  const fromFacets = (facetSexes ?? []).filter(row => row.value);
  if (fromFacets.length) return [{ value: '', count: total }, ...fromFacets.slice(0, max).map(row => ({ value: row.value, count: row.count }))];
  const distinct: string[] = [];
  for (const horse of pageHorses) {
    const value = (horse.recordedSex ?? '').trim();
    if (value && !distinct.some(existing => existing.toLowerCase() === value.toLowerCase())) distinct.push(value);
  }
  return [
    { value: '', count: total },
    ...distinct.slice(0, max).map(value => ({
      value,
      count: pageHorses.filter(horse => (horse.recordedSex ?? '').trim().toLowerCase() === value.toLowerCase()).length,
    })),
  ];
}

/** Immediate local matches while the command palette loads API results. */
export function searchHorses(horses: readonly Horse[], query: string): Horse[] {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  return horses.filter(horse => {
    const searchable = normalizeSearch([horse.id, horse.name, horse.nativeName, horse.registration, horse.breed, horse.coat, horse.sireName, horse.damName].filter(Boolean).join(' '));
    return terms.every(term => searchable.includes(term));
  });
}
