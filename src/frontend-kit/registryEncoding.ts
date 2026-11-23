/**
 * R128 — the single semantic-encoding brain for registry surfaces.
 *
 * Every registry surface (Core browse table + phone cards, search result
 * cards, pedigree chips, external frontends) answers the same question:
 * "which color MEANS what?" The answer lives HERE and in the matching
 * `--enc-*` token layer of heritage.tokens.css / heritage.registry-encoding.css.
 *
 * Rules of the system:
 *  - Sex is encoded with the reserved pedigree pair (sire cyan / dam rose)
 *    plus amber for geldings; it is never reused for non-sex semantics.
 *  - Lifecycle is a status signal: green active, amber inactive, muted + † deceased.
 *  - Coat colors carry PHYSICAL swatch constants (a bay is bay-colored in
 *    every palette and every theme; only the chip chrome is themed).
 *  - Breeds get stable hue families so multi-breed lists stay scannable.
 *  - Everything degrades to a neutral tone — encoding is additive, never
 *    a gatekeeper of information.
 */

import { horseSexLabel, horseSexKind, type HorseDisplayLocale, type HorseSexKind } from "./horseDisplay";

export type { HorseDisplayLocale, HorseSexKind };
export { horseSexLabel, horseSexKind };

/* ------------------------------------------------------------------ */
/* Sex encoding                                                        */
/* ------------------------------------------------------------------ */

/** Symbol per sex kind. Unicode-stable, RTL-safe, single glyph. */
export function horseSexSymbol(kind: HorseSexKind): string {
  return kind === "female" ? "♀" : kind === "male" ? "♂" : kind === "gelding" ? "◇" : "·";
}

/**
 * Sex classification for raw registry values. Tolerates the source system's
 * abbreviations ("Geld.", "St.") so the visual encoding never degrades on the
 * real studbook vocabulary.
 */
export function registrySexKind(value: string | null | undefined): HorseSexKind {
  const key = (value ?? "").trim().toLowerCase();
  if (!key) return "unknown";
  if (/^geld/.test(key) || key.includes("اخته")) return "gelding";
  return horseSexKind(value);
}

/** CSS class fragment for sex-scoped rules (`sex-male`, `sex-female`, …). */
export function horseSexClass(kind: HorseSexKind): string {
  return `sex-${kind}`;
}

/* ------------------------------------------------------------------ */
/* Lifecycle encoding                                                  */
/* ------------------------------------------------------------------ */

export type HorseLifecycleState = "active" | "inactive" | "deceased";

/** Derive the lifecycle state from the public browse record flags. */
export function horseLifecycleState(isActive?: number | null, isDead?: number | null): HorseLifecycleState {
  if (isDead) return "deceased";
  if (isActive) return "active";
  return "inactive";
}

export function horseLifecycleLabel(state: HorseLifecycleState, locale: HorseDisplayLocale): string {
  if (locale === "fa") return state === "active" ? "فعال" : state === "inactive" ? "غیرفعال" : "تلف‌شده";
  if (locale === "ar") return state === "active" ? "نشط" : state === "inactive" ? "غير نشط" : "نافق";
  if (locale === "fr") return state === "active" ? "Actif" : state === "inactive" ? "Inactif" : "Décédé";
  return state === "active" ? "Active" : state === "inactive" ? "Inactive" : "Deceased";
}

/** Semantic glyph: living records get a dot, deceased records get a dagger. */
export function horseLifecycleGlyph(state: HorseLifecycleState): string {
  return state === "deceased" ? "†" : state === "active" ? "●" : "○";
}

/* ------------------------------------------------------------------ */
/* Coat color encoding — physical swatches                             */
/* ------------------------------------------------------------------ */

export interface CoatColorEncoding {
  /** Stable CSS class fragment (`coat-bay`, `coat-grey`, …). */
  className: string;
  /** Physical swatch color — theme-independent by design. */
  swatch: string;
  /** Optional second swatch for patterned coats (skewbald …). */
  swatchAlt?: string;
  label: string;
}

type CoatLocaleLabels = { en: string; fa: string; ar: string; fr: string };

const COAT_ENCODINGS: ReadonlyArray<{ match: RegExp; labels: CoatLocaleLabels; className: string; swatch: string; swatchAlt?: string }> = Object.freeze([
  { match: /^dark\s*bay$|^dk\/?\s*bay$/, labels: { en: "Dark bay", fa: "کهر تیره", ar: "كهر داكن", fr: "Bai foncé" }, className: "coat-darkbay", swatch: "#4a2c12" },
  { match: /^bay$/, labels: { en: "Bay", fa: "کهر", ar: "كهر", fr: "Bai" }, className: "coat-bay", swatch: "#7a4a21" },
  { match: /^dk\/?\s*ch$|^dark\s*chestnut$/, labels: { en: "Dark chestnut", fa: "کرنگ تیره", ar: "كستنائي داكن", fr: "Alezan brûlé" }, className: "coat-darkchestnut", swatch: "#5e2c10" },
  { match: /^chestnut$|^sorrel$/, labels: { en: "Chestnut", fa: "کرنگ", ar: "كستنائي", fr: "Alezan" }, className: "coat-chestnut", swatch: "#9c4a1e" },
  { match: /^b\/?\s*gr$|^bay\s*grey$|^brown\s*grey$/, labels: { en: "Bay → grey", fa: "کهر به خاکستری", ar: "كهر إلى رمادي", fr: "Bai grisonnant" }, className: "coat-baygrey", swatch: "#7a4a21", swatchAlt: "#b7b7ba" },
  { match: /^gr(es|ey|y)?\/?\s*ch$|^grey\s*chestnut$/, labels: { en: "Chestnut → grey", fa: "کرنگ به خاکستری", ar: "كستنائي إلى رمادي", fr: "Alezan grisonnant" }, className: "coat-chgrey", swatch: "#9c4a1e", swatchAlt: "#b7b7ba" },
  { match: /^grey$|^gray$/, labels: { en: "Grey", fa: "خاکستری", ar: "رمادي", fr: "Gris" }, className: "coat-grey", swatch: "#b7b7ba" },
  { match: /^white$|^sabino-white$/, labels: { en: "White", fa: "سفید", ar: "أبيض", fr: "Blanc" }, className: "coat-white", swatch: "#f2efe8" },
  { match: /^black$/, labels: { en: "Black", fa: "سیاه", ar: "أسود", fr: "Noir" }, className: "coat-black", swatch: "#1c1b1e" },
  { match: /^brown$/, labels: { en: "Brown", fa: "قهوه‌ای", ar: "بني", fr: "Brun" }, className: "coat-brown", swatch: "#5c3a24" },
  { match: /^dun$|^mouse\s*dun$/, labels: { en: "Dun", fa: "دن", ar: "دن", fr: "Isabelle" }, className: "coat-dun", swatch: "#b98a4e" },
  { match: /^buckskin$/, labels: { en: "Buckskin", fa: "باک‌اسکین", ar: "باكسكين", fr: "Bai dun" }, className: "coat-buckskin", swatch: "#c8a05a" },
  { match: /^palomino$/, labels: { en: "Palomino", fa: "طلایی", ar: "بالومينو", fr: "Palomino" }, className: "coat-palomino", swatch: "#d9a94e" },
  { match: /^cremello$|^perlino$/, labels: { en: "Cremello", fa: "کرملو", ar: "كريميلو", fr: "Crème" }, className: "coat-cremello", swatch: "#efe3c9" },
  { match: /^roan$|^strawberry\s*roan$|^blue\s*roan$/, labels: { en: "Roan", fa: "ابرش", ar: "أبلق", fr: "Aubère" }, className: "coat-roan", swatch: "#8f8378" },
  { match: /^skewbald$|^piebald$|^pinto$|^tobiano$/, labels: { en: "Skewbald", fa: "سکوبالد", ar: "مرقش", fr: "Pie" }, className: "coat-skewbald", swatch: "#efe9df", swatchAlt: "#5c3a24" },
  { match: /^yellow$/, labels: { en: "Yellow", fa: "زرد", ar: "أصفر", fr: "Jaune" }, className: "coat-yellow", swatch: "#d9c05a" },
]);

/**
 * Resolve a raw `color_desc` value into the semantic coat encoding.
 * Unknown values get a neutral chip (no gatekeeping — the raw label still shows).
 */
export function coatColorEncoding(colorDesc: string | null | undefined, locale: HorseDisplayLocale = "en"): CoatColorEncoding | null {
  const key = (colorDesc ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  for (const entry of COAT_ENCODINGS) {
    if (entry.match.test(key)) {
      return {
        className: entry.className,
        swatch: entry.swatch,
        swatchAlt: entry.swatchAlt,
        label: entry.labels[locale] ?? entry.labels.en,
      };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Breed encoding — stable hue families                                */
/* ------------------------------------------------------------------ */

export type BreedTone = "arabian" | "partbred" | "thoroughbred" | "turkoman" | "sport" | "kurdish" | "plateau" | "caspian" | "darehshouri" | "friesian" | "imported" | "convert" | "other";

const BREED_ENCODINGS: ReadonlyArray<{ match: RegExp; tone: BreedTone; labels: CoatLocaleLabels }> = Object.freeze([
  { match: /^arabian( horse)?$|^عرب$/, tone: "arabian", labels: { en: "Arabian", fa: "عرب", ar: "عربي", fr: "Arabe" } },
  { match: /^part\s*bred$|^half\s*bred$|^partbred$/, tone: "partbred", labels: { en: "Part Bred", fa: "دورگه عرب", ar: "عربي مهجن", fr: "Demi-sang" } },
  { match: /^thoroughbred$/, tone: "thoroughbred", labels: { en: "Thoroughbred", fa: "تروبرد", ar: "ثوروبريد", fr: "Pur sang" } },
  { match: /^turkoman$|^turkomen$/, tone: "turkoman", labels: { en: "Turkoman", fa: "ترکمن", ar: "تركماني", fr: "Turcoman" } },
  { match: /^sport horse(s)?$/, tone: "sport", labels: { en: "Sport Horses", fa: "اسب ورزشی", ar: "خيول رياضية", fr: "Chevaux de sport" } },
  { match: /^kurdish$/, tone: "kurdish", labels: { en: "Kurdish", fa: "کردی", ar: "كردي", fr: "Kurde" } },
  { match: /^persian plateau$/, tone: "plateau", labels: { en: "Persian Plateau", fa: "فلات ایران", ar: "هضبة إيران", fr: "Plateau persan" } },
  { match: /^caspian$/, tone: "caspian", labels: { en: "Caspian", fa: "کاسپین", ar: "قزويني", fr: "Caspien" } },
  { match: /^darehshouri$|^dareh shouri$/, tone: "darehshouri", labels: { en: "Darehshouri", fa: "دره‌شوری", ar: "داره شوري", fr: "Darehshouri" } },
  { match: /^friesian$/, tone: "friesian", labels: { en: "Friesian", fa: "فریزین", ar: "فريزي", fr: "Frison" } },
  { match: /^legally imported$/, tone: "imported", labels: { en: "Legally Imported", fa: "وارداتی قانونی", ar: "مستورد قانونيا", fr: "Import légal" } },
  { match: /^convert fanava$/, tone: "convert", labels: { en: "Convert Fanava", fa: "منتقل‌شده فن‌آوا", ar: "منقول فنآوا", fr: "Converti Fanava" } },
]);

export interface BreedEncoding {
  tone: BreedTone;
  className: string;
  label: string;
}

/** Resolve a raw `breed_desc` value into the stable breed hue family. */
export function breedEncoding(breedDesc: string | null | undefined, locale: HorseDisplayLocale = "en"): BreedEncoding | null {
  const key = (breedDesc ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  for (const entry of BREED_ENCODINGS) {
    if (entry.match.test(key)) {
      return { tone: entry.tone, className: `breed-${entry.tone}`, label: entry.labels[locale] ?? entry.labels.en };
    }
  }
  return null;
}
