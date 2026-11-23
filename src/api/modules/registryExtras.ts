import { HttpError, json, readJson, requestId } from "../http";
import { requireAuth, requireCsrf, requirePermission } from "../../auth/guards";
import {
  EXTRACT_LEGAL_NOTE_EN,
  EXTRACT_LEGAL_NOTE_FA,
  latestExtractCode,
  loadExtractForRendering,
  recordExtractIssuance,
} from "../../trust/extracts";
import type { D1Database } from "@cloudflare/workers-types";

// Duplicate prevention (client requirement) + registry certificate generation.
// The duplicate check powers the create-horse flow: it surfaces likely-existing
// records (exact identifiers, normalized-name + birth-year proximity, same
// parents) BEFORE a new record is committed, so operators stop duplicates at
// entry time instead of merging them later.

export async function duplicateCheck(db: D1Database, url: URL, allowPrivateIdentifiers = false): Promise<Response> {
  const name = (url.searchParams.get("name") ?? "").trim().slice(0, 200);
  const registerNo = (url.searchParams.get("registerNo") ?? "").trim().slice(0, 120);
  const microchip = (url.searchParams.get("microchip") ?? "").trim().slice(0, 120);
  if (microchip && !allowPrivateIdentifiers) throw new HttpError(403,"private_identifier_lookup_required","Private identifier checks require an authorized registry reviewer");
  const birthYear = /^\d{4}$/.test(url.searchParams.get("birthYear") ?? "") ? Number(url.searchParams.get("birthYear")) : null;
  const fatherId = /^\d+$/.test(url.searchParams.get("fatherId") ?? "") ? Number(url.searchParams.get("fatherId")) : null;
  const motherId = /^\d+$/.test(url.searchParams.get("motherId") ?? "") ? Number(url.searchParams.get("motherId")) : null;
  if (!name && !registerNo && !microchip) throw new HttpError(400, "missing_query", "Provide at least a name, register number or microchip");

  const seen = new Map<number, { horse: Record<string, unknown>; reasons: string[] }>();
  const record = (row: Record<string, unknown> | null | undefined, reason: string) => {
    if (!row) return;
    const id = Number(row.id);
    const entry = seen.get(id) ?? { horse: row, reasons: [] };
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    seen.set(id, entry);
  };

  if (registerNo) {
    const rows = await db.prepare("SELECT id,name_latin,name_native,register_no,birth_year,breed_desc,sex_desc FROM horses WHERE deleted_at IS NULL AND is_active=1 AND register_no=? LIMIT 10").bind(registerNo).all();
    for (const row of rows.results ?? []) record(row as Record<string, unknown>, "register_no_exact");
  }
  if (microchip) {
    const rows = await db.prepare("SELECT id,name_latin,name_native,register_no,birth_year,breed_desc,sex_desc FROM horses WHERE deleted_at IS NULL AND is_active=1 AND microchip_no=? LIMIT 10").bind(microchip).all();
    for (const row of rows.results ?? []) record(row as Record<string, unknown>, "microchip_exact");
  }
  if (name) {
    const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
    const pattern = `%${normalized.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const rows = await db.prepare(`
      SELECT id,name_latin,name_native,register_no,birth_year,breed_desc,sex_desc FROM horses
      WHERE deleted_at IS NULL AND is_active=1 AND (LOWER(REPLACE(name_latin,'  ',' ')) LIKE ? ESCAPE '\\' OR name_native LIKE ? ESCAPE '\\')
      ${birthYear ? "AND (birth_year IS NULL OR ABS(COALESCE(birth_year,0)-?)<=1)" : ""}
      LIMIT 15
    `).bind(...(birthYear ? [pattern, pattern, birthYear] : [pattern, pattern])).all();
    for (const row of rows.results ?? []) record(row, "name_match");
  }
  if (fatherId && motherId) {
    const rows = await db.prepare(`
      SELECT id,name_latin,name_native,register_no,birth_year,breed_desc,sex_desc FROM horses
      WHERE deleted_at IS NULL AND is_active=1 AND father_id=? AND mother_id=?
        AND EXISTS(SELECT 1 FROM horses p WHERE p.id=? AND p.deleted_at IS NULL AND p.is_active=1)
        AND EXISTS(SELECT 1 FROM horses p WHERE p.id=? AND p.deleted_at IS NULL AND p.is_active=1) LIMIT 10
    `).bind(fatherId, motherId, fatherId, motherId).all();
    for (const row of rows.results ?? []) record(row, "same_parents");
  }

  const candidates = [...seen.values()]
    .map((entry) => {
      const weight = (reason: string) => (reason === "register_no_exact" || reason === "microchip_exact" ? 100 : reason === "same_parents" ? 70 : reason === "name_match" ? 40 : 10);
      const score = Math.min(100, entry.reasons.reduce((sum, reason) => sum + weight(reason), 0));
      return { ...entry, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  return json({ query: { name, registerNo, microchip, birthYear, fatherId, motherId }, candidates, blocked: candidates.some((c) => c.reasons.includes("register_no_exact") || c.reasons.includes("microchip_exact")) });
}

// ---------------------------------------------------------------------------
// Registry certificate SVG — Master-Ai plan T06 (finding F04): the public
// endpoint now renders a PREVIEW of live public facts, or — when
// ?extract=CODE is supplied — the STORED facts of that exact versioned
// registry extract. Extracts are immutable snapshots; the preview is clearly
// labeled and never claims to be a legal document.

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

interface RenderInput {
  title: string;
  subtitle: string;
  horseId: number | string;
  name: string;
  rows: Array<[string, string]>;
  issued: string;
  verification: string;
  dir: "rtl" | "ltr";
  fa: boolean;
  banner: { line: string; sub: string };
  verifyUrl: string;
  changedNotice?: string;
}

function renderRegistrySvg(input: RenderInput): string {
  const fields = input.rows.map(([label, value], index) => {
    const x = input.fa ? 861 : 262;
    const y = 268 + Math.floor(index / 2) * 52 + (index % 2) * 26;
    return `<text x="${x}" y="${y}" font-size="15" fill="#c9c4ae" text-anchor="${input.fa ? "end" : "start"}">${esc(label)}</text>` +
      `<text x="${input.fa ? 561 : 562}" y="${y}" font-size="16" fill="#f2eeda" font-weight="600" text-anchor="middle">${esc(value)}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1123" height="794" viewBox="0 0 1123 794">
  <rect width="1123" height="794" fill="#141810"/>
  <rect x="26" y="26" width="1071" height="742" fill="none" stroke="#8a733c" stroke-width="2"/>
  <rect x="34" y="34" width="1055" height="726" fill="none" stroke="#3d3722" stroke-width="1"/>
  <text x="561" y="96" font-size="34" fill="#d9b24c" text-anchor="middle" font-weight="700" letter-spacing="2" direction="${input.dir}">${esc(input.title)}</text>
  <text x="561" y="126" font-size="16" fill="#8f8a74" text-anchor="middle">${esc(input.subtitle)}</text>
  <line x1="262" y1="146" x2="861" y2="146" stroke="#8a733c" stroke-width="1"/>
  <text x="561" y="196" font-size="40" fill="#f2eeda" text-anchor="middle" font-weight="700" direction="${input.dir}">${esc(input.name || `#${input.horseId}`)}</text>
  <text x="561" y="226" font-size="16" fill="#8f8a74" text-anchor="middle">Registry record #${esc(input.horseId)}</text>
  ${fields}
  <line x1="262" y1="620" x2="861" y2="620" stroke="#8a733c" stroke-width="1"/>
  <text x="${input.fa ? 861 : 262}" y="652" font-size="13" fill="#8f8a74" text-anchor="${input.fa ? "end" : "start"}">Issued: ${esc(input.issued)}</text>
  <text x="${input.fa ? 861 : 262}" y="676" font-size="13" fill="#8f8a74" text-anchor="${input.fa ? "end" : "start"}">Verification code: ${esc(input.verification)}</text>
  <text x="${input.fa ? 262 : 861}" y="652" font-size="13" fill="#8f8a74" text-anchor="${input.fa ? "start" : "end"}">Verify at: ${esc(input.verifyUrl)}</text>
  <text x="${input.fa ? 262 : 861}" y="676" font-size="12" fill="#615c49" text-anchor="${input.fa ? "start" : "end"}">${esc(input.banner.line)}</text>
  ${input.changedNotice ? `<text x="561" y="700" font-size="12" fill="#c98c3c" text-anchor="middle">${esc(input.changedNotice)}</text>` : ""}
  <text x="561" y="736" font-size="12" fill="#615c49" text-anchor="middle">${esc(input.banner.sub)}</text>
</svg>`;
}

function svgResponse(svg: string, id: string | number, lang: string): Response {
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `inline; filename="registry-extract-${id}-${lang}.svg"`,
    },
  });
}

export async function registryCertificateSvg(db: D1Database, horseId: number, lang: "fa" | "en", extractCode?: string | null): Promise<Response> {
  const fa = lang === "fa";
  const L = (en: string, farsi: string) => (fa ? farsi : en);
  const title = L("REGISTRY INFORMATION EXTRACT", "استخراج اطلاعات ثبت");
  const subtitle = L("National Horse Registry of Iran", "سامانه جامع اطلاعات اسب‌های ایران");
  const legalNote = fa
    ? "استخراج اطلاعاتی — گواهی رسمی نیست و مالکیت را اثبات نمی‌کند."
    : "Informational extract — not an official certificate; does not establish ownership.";

  // Extract mode: render the STORED snapshot for this exact code (T06).
  if (extractCode) {
    const stored = await loadExtractForRendering(db, horseId, extractCode);
    if (!stored) throw new HttpError(404, "not_found", "Extract not found for this horse");
    const payload = stored.payload;
    const name = `${payload.horse.name_latin ?? ""}${payload.horse.name_native ? ` · ${payload.horse.name_native}` : ""}`;
    const rows: Array<[string, string]> = [
      [L("Registration No.", "شماره ثبت"), String(payload.horse.register_no ?? "—")],
      [L("Breed", "نژاد"), String(payload.horse.breed_desc ?? "—")],
      [L("Sex", "جنسیت"), String(payload.horse.sex_desc ?? "—")],
      [L("Colour", "رنگ"), String(payload.horse.color_desc ?? "—")],
      [L("Birth year", "سال تولد"), String(payload.horse.birth_year ?? "—")],
      [L("Birthplace", "محل تولد"), String(payload.horse.birth_place_desc ?? "—")],
      [L("Main strain", "قائل اصلی"), String(payload.horse.main_strain_desc ?? "—")],
      [L("UELN", "شماره UELN"), String(payload.horse.ueln_no ?? "—")],
      [L("Sire", "پدر"), payload.pedigree.sire ? String(payload.pedigree.sire.name_latin ?? "—") : "—"],
      [L("Dam", "مادر"), payload.pedigree.dam ? String(payload.pedigree.dam.name_latin ?? "—") : "—"],
      [L("Breeder", "پرورش‌دهنده"), payload.people.breeder.length ? payload.people.breeder.join("، ") : "—"],
      [L("Owner", "مالک"), payload.people.owner.length ? payload.people.owner.join("، ") : "—"],
    ];
    const revoked = stored.status === "revoked";
    const changed = stored.changedFields.length > 0;
    return svgResponse(renderRegistrySvg({
      title,
      subtitle,
      horseId: Number(payload.horse.id),
      name,
      rows,
      issued: String(payload.meta.issued_at).slice(0, 10),
      verification: extractCode,
      dir: fa ? "rtl" : "ltr",
      fa,
      banner: {
        line: revoked
          ? L(`REVOKED — ${stored.revokedReason ?? "revoked"}`, `لغوشده — ${stored.revokedReason ?? "لغو شده"}`)
          : L("Immutable snapshot issued under this code.", "تصویر ثابت صادره با این کد."),
        sub: legalNote,
      },
      verifyUrl: `/api/extract/verify?code=${extractCode}`,
      changedNotice: changed
        ? L("Registry data has changed since this extract was issued.", "داده‌های ثبت پس از صدور این استخراج تغییر کرده است.")
        : undefined,
    }), Number(payload.horse.id), lang);
  }

  // Preview mode: live public facts, clearly labeled as a preview (T06 step 4).
  const horse = await db.prepare(`
    SELECT h.id,h.register_no,h.name_latin,h.name_native,h.birth_year,h.birth_place_desc,h.breed_desc,h.sex_desc,h.color_desc,
           h.main_strain_desc,h.sub_strain_desc,h.uel_no,h.is_stallion,
           s.name_latin AS sire_name,s.name_native AS sire_native,
           m.name_latin AS dam_name,m.name_native AS dam_native,
           (SELECT group_concat(p.name_latin || ' ' || COALESCE(p.name_native,''), '، ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='breeder' AND hp.is_current=1) AS breeder,
           (SELECT group_concat(p.name_latin || ' ' || COALESCE(p.name_native,''), '، ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='owner' AND hp.is_current=1) AS owner
    FROM horses h
    LEFT JOIN horses s ON s.id=h.father_id AND s.deleted_at IS NULL AND s.is_active=1
    LEFT JOIN horses m ON m.id=h.mother_id AND m.deleted_at IS NULL AND m.is_active=1
    WHERE h.id=? AND h.deleted_at IS NULL AND h.is_active=1
  `).bind(horseId).first<Record<string, unknown>>();
  if (!horse) throw new HttpError(404, "not_found", "Horse not found");

  const name = `${horse.name_latin ?? ""}${horse.name_native ? ` · ${horse.name_native}` : ""}`;
  const rows: Array<[string, string]> = [
    [L("Registration No.", "شماره ثبت"), String(horse.register_no ?? "—")],
    [L("Breed", "نژاد"), String(horse.breed_desc ?? "—")],
    [L("Sex", "جنسیت"), String(horse.sex_desc ?? "—")],
    [L("Colour", "رنگ"), String(horse.color_desc ?? "—")],
    [L("Birth year", "سال تولد"), String(horse.birth_year ?? "—")],
    [L("Birthplace", "محل تولد"), String(horse.birth_place_desc ?? "—")],
    [L("Main strain", "قائل اصلی"), String(horse.main_strain_desc ?? "—")],
    [L("UELN", "شماره UELN"), String(horse.uel_no ?? "—")],
    [L("Sire", "پدر"), String(horse.sire_name ? `${horse.sire_name}${horse.sire_native ? ` · ${horse.sire_native}` : ""}` : "—")],
    [L("Dam", "مادر"), String(horse.dam_name ? `${horse.dam_name}${horse.dam_native ? ` · ${horse.dam_native}` : ""}` : "—")],
    [L("Breeder", "پرورش‌دهنده"), String(horse.breeder ?? "—")],
    [L("Owner", "مالک"), String(horse.owner ?? "—")],
  ];
  const issued = new Date().toISOString().slice(0, 10);
  // When an extract has been issued for this horse, the preview points at the
  // LATEST extract code — a preview never invents its own verifiable code.
  const latestCode = await latestExtractCode(db, horseId);
  const verification = latestCode ?? `HR-${String(horse.id).padStart(6, "0")}-${issued.replace(/-/g, "")}`;
  return svgResponse(renderRegistrySvg({
    title,
    subtitle,
    horseId: Number(horse.id),
    name,
    rows,
    issued,
    verification,
    dir: fa ? "rtl" : "ltr",
    fa,
    banner: {
      line: latestCode
        ? L("Preview of live data — the code shown belongs to the latest issued extract.", "پیش‌نمایش داده‌های زنده — کد نمایش‌داده‌شده متعلق به آخرین استخراج صادره است.")
        : L("Preview — not recorded. Issue an extract to get a verifiable snapshot code.", "پیش‌نمایش — برای دریافت کد تصویر ثابت قابل راستی‌آزمایی، استخراج صادر کنید."),
      sub: legalNote,
    },
    verifyUrl: latestCode ? `/api/extract/verify?code=${latestCode}` : "/api/extract/verify",
  }), Number(horse.id), lang);
}

export const recordCertificateIssuance = recordExtractIssuance;

/**
 * R59 (review fact-check #14) + Master-Ai T06: public verification of LEGACY
 * certificate codes (registry_certificates ledger, pre-extract era). New
 * issuances are versioned extracts verified at /api/extract/verify. Anyone
 * can check a code; responses stay safe for the horse's public profile and
 * unknown/malformed codes return valid:false so QR/typing mistakes degrade
 * gracefully. Legacy rows render LIVE joined data, which is exactly why the
 * extract system replaced them — the response says so honestly.
 */
export async function verifyCertificateCode(db: D1Database, url: URL): Promise<Response> {
  const code = (url.searchParams.get("code") ?? "").trim();
  if (!/^[A-Za-z0-9-]{6,80}$/.test(code)) {
    return json({ valid: false, reason: "malformed_code" });
  }
  const row = await db.prepare(`
    SELECT c.id AS certificate_id, c.horse_id, c.language, c.verification_code, c.issued_at,
           h.name_latin, h.name_native, h.register_no, h.breed_desc, h.birth_year, h.deleted_at
    FROM registry_certificates c JOIN horses h ON h.id=c.horse_id
    WHERE c.verification_code=? AND c.certificate_type='registration' AND h.deleted_at IS NULL AND h.is_active=1
    ORDER BY c.issued_at DESC LIMIT 1
  `).bind(code).first<Record<string, unknown>>();
  if (!row || row.deleted_at) return json({ valid: false, reason: "unknown_code" });
  return json({
    valid: true,
    kind: "legacy_certificate",
    legacy_notice: "This code belongs to the legacy certificate ledger. It shows CURRENT registry data, not a historical snapshot. New issuances are versioned registry extracts.",
    certificate: {
      code: row.verification_code,
      horse_id: row.horse_id,
      name_latin: row.name_latin,
      name_native: row.name_native,
      register_no: row.register_no,
      breed: row.breed_desc,
      birth_year: row.birth_year,
      language: row.language,
      issued_at: row.issued_at,
      svg_url: `/api/horses/${row.horse_id}/certificate.svg?lang=${row.language === "en" ? "en" : "fa"}`,
    },
  });
}
