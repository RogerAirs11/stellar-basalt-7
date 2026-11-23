# Premium Analytics Architecture — v0.41.1

Application: **v0.41.1**  
Platform contract: **2.11.0**

Horse DB premium analytics are deterministic/explainable registry and pedigree intelligence. Every premium family must state its cohort, method, coverage/exclusions, source revision and interpretation boundary.

## Trust layer

Premium demographic calculations use documented analytical eligibility rather than blindly treating populated fields as valid observations. Raw source distributions remain available for forensic comparison.

Current explicit birth-date exclusion:

- source/default sentinel: `birth_year = 1901 AND birth_date = '19010101'`

The canonical dataset contains 5,209 such rows. Raw 1901 count is therefore 5,210, while the current analytical 1901 count is 1.

Pedigree confidence accounts for cycle contamination, truncation/unresolved references and positional completeness. Premium pedigree methods remain pedigree-only.

## Per-horse pedigree intelligence

`calculatePedigreeDiversity()` derives through a bounded ancestor graph:

- equivalent complete generations
- known/unique/repeated ancestor positions
- ancestor diversity and ancestor loss
- weighted path coverage
- weighted repetition burden
- cross-branch repeated ancestors
- Top-5 / Top-10 recorded path-weight concentration
- top ancestor contributions with sire/dam branch decomposition

Each ancestor path occurrence at generation `g` receives path weight `1 / 2^g`. Normalized shares are explicitly shares of **recorded pedigree path evidence**, not genomic ancestry percentages.

## Population concentration

Sire/dam and people-role concentration includes:

- assignment count
- distinct parent/person count
- Top-1 / Top-5 / Top-10 share
- Herfindahl-Hirschman Index (HHI)
- Gini coefficient
- Shannon entropy
- entropy-effective count `exp(H)`
- inverse-Simpson effective count

People-role metrics describe registry linkage concentration; they are not market share or a quality ranking.

## Generation intervals

Parent/offspring birth-year differences are included only when the child has an analytically valid birth year and the parent age falls inside the documented 2–35 year plausibility window. Reported pathways are sire→offspring, dam→offspring, sire→son, sire→daughter, dam→son and dam→daughter, plus decade history.

## Direct-line survival

Recent-cohort tail-male and tail-female metrics repeatedly follow sire-of-sire or dam-of-dam until the earliest recorded root. They measure **direct recorded lineage persistence**, not whole-genome ancestry.

## Prospective mating diversity

A sire × dam analysis now supplements projected finite-pedigree COI/kinship with:

- projected known/expected ancestor positions and completeness
- projected unique ancestors and repeated positions
- ancestor diversity
- shared recorded parent ancestry
- sire-only / dam-only unique ancestors
- Top-5 / Top-10 projected path-weight concentration
- projected ancestor contribution table

This is user-facing pedigree decision support, not a biological-quality prediction.

## Reference-population intelligence

Current reference populations are recent same-breed, cycle-clean analytical cohorts. A horse's pedigree mean kinship is calculated exactly against a stable deterministic sample (currently up to 32 reference horses) rather than approximated from names or raw ancestor counts. The result includes sample size and sampling uncertainty. It is a pedigree estimate, **not genomic relationship**.

Reference intelligence combines:

- sampled pedigree mean kinship and percentile within the cohort
- recorded-ancestor rarity
- direct tail-male / tail-female root rarity where traceable
- Diversity Preservation Index (DPI), an explainable composite rather than a quality score
- explicit confidence and interpretation/provenance

DPI must never be marketed as breeding value or genetic merit. A high DPI means the *recorded pedigree is relatively diversity-preserving within the stated reference population under the stated method*.

## Recorded influence trajectories

Influence uses recorded descendant reach and represented pedigree positions through a bounded depth, with recent/prior-period and birth-decade summaries. It measures registry representation, not genetic superiority or whole-genome contribution.

## Candidate mating optimizer

`breeding.optimize` ranks a bounded user-selected candidate set against one fixed parent. Default scoring combines low projected offspring pedigree COI, projected ancestor diversity, low Top-5 ancestor concentration, candidate DPI when available, and a pedigree-confidence adjustment. Optional ancestors-to-avoid can penalize or exclude candidates.

Every result exposes raw score, confidence-adjusted score, applied component weights, projected pedigree measures, warnings and provenance. If DPI is unavailable, its weight is redistributed across available objectives; missing data is never silently scored as zero.

The optimizer is pedigree decision support only. It does not predict genomic compatibility, health, fertility, conformation, temperament, performance, market value or an objectively “best” foal.

## Versioning

Snapshot schema/algorithm: `2.1.0 / 2.1.0`. Reference-population and optimizer meaning changes require a version bump and regression fixtures.

Premium source/algorithm changes that alter metric meaning must bump versions and regression fixtures. Frontends consume these fields through PlatformClient; none may maintain a separate analytics truth.
