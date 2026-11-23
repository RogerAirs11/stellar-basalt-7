import { loadCanonicalHorseProfile } from "../../../registry/profile";
import { evidence } from "../../evidence/builder";
import { horseRef } from "./evidence";
import type { AiEvidenceReference, AiEntityReference } from "../../core/types";

export interface LocalAssistantResolution {
  text: string;
  evidence: AiEvidenceReference[];
  entityRefs: AiEntityReference[];
  title: string;
}

/**
 * Resolve only deliberately narrow, deterministic navigation commands.
 * Anything interpretive, comparative, ambiguous, or open-ended must go to the
 * model so this optimization cannot silently reduce answer quality.
 */
export async function tryResolveLocalAssistantTurn(
  db: D1Database,
  text: string,
  locale: string,
): Promise<LocalAssistantResolution | null> {
  const horseId = exactHorseNavigationId(text);
  if (!horseId) return null;

  const profile = await loadCanonicalHorseProfile(db, horseId);
  const fa = locale.toLowerCase().startsWith("fa") || /[\u0600-\u06ff]/u.test(text);
  if (!profile) {
    return {
      text: fa ? `اسب با شناسهٔ قطعی #${horseId} در سامانه ثبت پیدا نشد.` : `No horse with canonical ID #${horseId} was found in the registry.`,
      evidence: [],
      entityRefs: [],
      title: fa ? `اسب #${horseId}` : `Horse #${horseId}`,
    };
  }

  const horse = profile.horse;
  const ref = horseRef(horse);
  const parentBits = [
    profile.father ? `${fa ? "پدر" : "sire"}: ${profile.father.name_latin || profile.father.name_native || `#${profile.father.id}`}` : null,
    profile.mother ? `${fa ? "مادر" : "dam"}: ${profile.mother.name_latin || profile.mother.name_native || `#${profile.mother.id}`}` : null,
  ].filter(Boolean).join(fa ? "، " : "; ");
  const label = horse.name_latin || horse.name_native || `#${horseId}`;
  const details = [horse.register_no ? `${fa ? "شماره ثبت" : "registration"}: ${horse.register_no}` : null, horse.birth_year ? `${fa ? "سال تولد" : "born"}: ${horse.birth_year}` : null, parentBits || null].filter(Boolean).join(fa ? "، " : "; ");
  const ev = evidence("registry_record", fa ? `رکورد سامانه ثبت ${label}` : `Registry record: ${label}`, `horse:${horseId}`, {
    horse: profile.horse,
    father: profile.father,
    mother: profile.mother,
  }, [ref]);

  return {
    text: fa ? `این اسب پیدا شد: ${label}${details ? ` — ${details}` : ""}.` : `Found ${label}${details ? ` — ${details}` : ""}.`,
    evidence: [{ id: ev.id, kind: ev.kind, title: ev.title, sourceRef: ev.sourceRef, entityRefs: ev.entityRefs, completeness: ev.completeness }],
    entityRefs: [ref],
    title: label,
  };
}

function exactHorseNavigationId(raw: string): number | null {
  const text = normalizeDigits(raw).trim().replace(/[.!?؟]+$/g, "").trim();
  const patterns = [
    /^(?:open|show|view)\s+(?:horse\s*)?#?(\d+)$/i,
    /^(?:horse)\s*#?(\d+)$/i,
    /^#(\d+)$/,
    /^(?:اسب)\s*#?(\d+)\s*(?:را\s*)?(?:باز\s*کن|نشان\s*بده|نمایش\s*بده)?$/u,
    /^(?:باز\s*کن|نشان\s*بده|نمایش\s*بده)\s+(?:اسب\s*)?#?(\d+)$/u,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const id = Number(match[1]);
    if (Number.isSafeInteger(id) && id > 0) return id;
  }
  return null;
}

function normalizeDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, ch => String("۰۱۲۳۴۵۶۷۸۹".indexOf(ch)))
    .replace(/[٠-٩]/g, ch => String("٠١٢٣٤٥٦٧٨٩".indexOf(ch)));
}
