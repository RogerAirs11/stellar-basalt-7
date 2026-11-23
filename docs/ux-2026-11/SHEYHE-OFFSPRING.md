# Sheyhe: identifying parent profiles through already registered offspring

**87 further public profiles now link to existing registry horses: 68 dams and 19 sires.** Each had a matching Persian name, compatible birth year, matching sex, and a unique registration number (83 horses) or UEL (4 horses). For every one, at least two separately identified offspring pointed to that same registry parent, in the same role. The parent links were already in the registry; none were assigned or edited by this release.

| Production database | Before | After | Change |
|---|---:|---:|---:|
| Linked Sheyhe profiles | 24,627 | 24,714 | +87 |
| Unlinked Sheyhe profiles | 10,856 | 10,769 | −87 |
| Public source notes | 47,473 | 47,648 | +175 |
| Active horses with notes | 24,098 | 24,185 | +87 |

**What users gain:** 87 source-reported uses, 87 source-listed countries and one province. No additional coat, strain or birth-year note qualified. No official record was overwritten. Both frontends now have an English/Persian explanation of this evidence type; it contains no identifier values.

**Verification:** compared the pinned pedigree CSV with the live registry separately from the matching query: 431 supporting parent–offspring pairs, involving 415 distinct offspring. Every accepted horse had 2–21 corroborating offspring. Six exact public parent profiles were sampled; all six still displayed the sampled identifiers and six newly published fields matched the current pages. This was not a live scrape of all 87 pages. A transaction rejected any change to an old note or evidence label; an independent readback of all 47,648 notes verified their archived values and the previous 47,473-row digest. No official-field collisions or ineligible horses were found.

**What remains:** the 10,769 unlinked source profiles include 5,831 with a source coat, 8,216 with a source year and 3,728 with a named strain. These counts overlap. There are 12,214 active registry horses with neither a canonical coat nor a public coat note. Of those, 4,626 have a Sheyhe profile link, but **none of their archived source profiles contains a nonblank coat**. Re-running the same archive import will not fill those gaps.

**Release checks:** production build, both type checks, 24 targeted tests, 10 responsive journeys and public-evidence fixtures passed. These scoped checks do not replace the previously non-green full suite. `RUNBOOK.md` describes acceptance, rollback and reproducibility.
