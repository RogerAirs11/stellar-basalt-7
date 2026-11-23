# Horse-DB-3 R31.11 — EN/FA localization merge + compact AI chat chrome

Date: 2026-09-16

## Source authority

Base: `HORSE-DB-3-R31.10-AI-MOBILE-SCROLL-PROVIDER-REFINEMENTS-FULL-SOURCE-NO-DB-2026-09-16.zip`

Base SHA-256: `a9e2437afa3247246f6f50c73e75311d6060ff46b77c1159a243c75c2027e978`

Localization overlay: `HORSE-DB-3-R31.10-EN-FA-LANGUAGE-LOCALIZATION-REPAIR-MERGE-FILES-2026-09-16.zip`

The localization overlay declares the exact same R31.10 source authority and contains 74 repository-path files. All 74 files were hash-verified against its `CHANGED_FILES_SHA256.txt` before overlay.

## Localization merge

Merged the complete intended EN/FA localization repair, including:

- central `src/web/i18n.tsx` dictionary corrections;
- shared `src/frontend-kit/ai/localization.ts` AI status/error/evidence/entity localization;
- shared `src/frontend-kit/analysisLocale.ts` scientific/provenance terminology;
- shared horse-field terminology;
- active frontend localization updates, including Classic public + standalone mirrors;
- Iranian horse-domain terminology normalization (`سامانه ثبت`, `شماره ثبت`, `کتاب تبارنامه`, `تبارنامه`, `خط خونی`, `ضریب همخونی`, `ارزش اصلاحی`);
- Persian orthography normalization such as `گفت‌وگو` and `جست‌وجو`;
- horse lifecycle terminology such as `تلف‌شده / تاریخ تلف`;
- localization validator integration.

Historical migrations were not rewritten, matching the repair package's explicit exclusion.

## AI chat UX refinements

- Removed the shared AI title/subtitle header entirely to reclaim chat space.
- Retained all mode/model/log/new/close controls in a compact bottom control strip next to the composer.
- User message bubbles are physically pinned to the right in both EN and FA.
- AI message bubbles are physically pinned to the left in both EN and FA.
- Bubble positioning uses physical left/right auto margins instead of RTL-sensitive flex start/end.
- Existing smart mobile thread scrolling and support-style floating launcher behavior are preserved.

## Validation

The merged tree passes the localization, AI architecture, source syntax, frontend integration, CSS architecture, mobile UX system, presentation parity, visible-surface parity and production-asset source validators, plus R31 AI provider/runtime/storage/boundary/result-budget harnesses.
