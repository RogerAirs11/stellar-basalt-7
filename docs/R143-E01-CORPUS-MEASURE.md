# R143-E01 — Corpus measurement (Master-AI plan)

- Snapshot: **2026-10-27T20:44:22.192Z** · engine: supabase_postgres (canonical serving generation)
- Denominator (default): all horses, total **95,639**, max id 10121581
- Every metric below names its own denominator and exclusions. Read-only measurement; nothing was written.

## Record classes (denominator: all horses)
| class | count |
|---|---|
| active | 91,498 |
| inactive | 4,141 |
| dead | 897 |
| imported | 8,738 |
| sport | 290 |
| stallion | 3,315 |

## Identifier coverage (denominator: all horses)
| identifier | covered | coverage % | duplicate groups |
|---|---|---|---|
| registry number (register_no) | 71,582 | 74.85 | 15 |
| microchip (microchip_no) | 66,641 | 69.68 | 15 |
| UEL number (uel_no) | 44,275 | 46.29 | 15 |
| lab number (lab_no) | 35,811 | 37.44 | 15 |
| life number (life_number) | 71,057 | 74.3 | 15 |
| passport number (passport_no) | 37,128 | 38.82 | 1 |

## Names (denominator: all horses)
- latin casefold collision groups: **3,426**
- horses sharing a latin name with another: **8,385**
- native names still carrying arabic yeh kaf tatweel: **49,100**
- horses with native name: **94,865**
- horses missing native name: **774**
- horses missing latin name: **3**
- exclusions: empty/whitespace names excluded from collision grouping

## Dates (denominator: all horses)
- denominator: **all horses**
- missing birth year: **4,917**
- below floor: **14**
- future year: **0**
- with birth date: **88,101**
- date year mismatch: **11**
- death before birth: **0**
- dead flag inconsistent: **77,192**
- exclusions: **date casts only applied where birth_date/death_date matches YYYY-MM-DD; garbage date strings (e.g. '0') are counted neither as valid nor as mismatches — they surface via the date-format audit below**
- birth date non standard format: **88,101**

## Parents (denominator: all horses)
- denominator: **all horses**
- both parents: **59,495**
- one parent: **6,845**
- no parent: **29,299**
- self parent: **0**
- same parent both sides: **2**
- dangling references: **0**
- parent role conflicts: **{"sire_rows_female":106,"dam_rows_male":161}**
- exclusions: **role conflicts use the horse's own sex_desc/sex_code vocabulary; unknown sexes are NOT counted as conflicts**

## Ancestry cycles
- detected (bounded 12-gen walk): **0** — examples: none

## Pedigree completeness (denominator: active horses)
| generation | expected slots | horses with a known ancestor at this level | positional completeness |
|---|---|---|---|
| 1 | 1 | 66,340 | 72.5% |
| 2 | 2 | 66,340 | 72.5% |
| 3 | 4 | 56,035 | 61.24% |
| 4 | 8 | 46,617 | 50.95% |
| 5 | 16 | 40,070 | 43.79% |
| 6 | 32 | 34,118 | 37.29% |
| 7 | 64 | 25,548 | 27.92% |
- unique ancestors per pedigreed horse (≤7 generations, average): **6.93**

## Evidence + laboratory (denominators per table)
- change_requests: **0** total — 
- genetic_tests: **3927** total, verified **3139**, verified+public **0**, usable parentage **0**

## Performance linkage
- racing: **12924** races / **122063** results / linked **121799** (unresolved **264**)
- competitions: **60** events / **3444** results / linked **3444**

## Prioritized missing-data and error list
- P1 serving-generation reconciliation: canonical table total 95,639 (active 91,498 / inactive 4,141) vs analytics precompute 93,896 (generated 2026-10-23) — delta 1743; refresh the analytics precompute before quoting population figures
- P1 microchip coverage is 69.68% — the strongest global identifier is missing on 28,998 horses
- P1 parent-role conflicts: 106 sires recorded female / 161 dams recorded male — queue for reviewer correction
- P2 2 horses share the same horse on both parent sides — review
- P2 15+ register_no duplicate groups (top examples listed) — route through identifier conflict queue
- P2 11 birth_date/birth_year mismatches — reconcile
- P3 8385 horses share a Latin name with another horse — never auto-merge; use the workbench
- P3 49100 native names still carry Arabic Yeh/Kaf/Tatweel — run the normalizer pass
- P3 racing crosswalk: 264 of 122,063 results unresolved to a registry horse
