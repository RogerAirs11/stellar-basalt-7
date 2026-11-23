# Horse DB — Pedigree & Analytics Architecture

Status: **canonical**  
Application: **v0.41.1**  
Platform contract: **2.11.0**

## Principle

> **Validate first. Calculate second. Render third.**

Canonical truth is the horse parent graph (`father_id`, `mother_id`). Analytics are derived/disposable and reproducible from canonical data.

## Integrity

Traversal is bounded and cycle-safe. Missing parent does not imply a known biological founder. Repeat nodes and source cycles are different conditions and must remain distinguishable.

## Scientific layers

- ancestor and descendant traversal
- structural pedigree completeness/coverage
- repeated ancestor representation
- ancestor path enumeration
- relationship classification and coefficients
- pedigree COI / parental kinship under explicit algorithm/depth/integrity assumptions
- prospective-offspring breeding analysis
- registry-wide derived analytics snapshot

Coefficient outputs must be suppressed or qualified when cycle/truncation/integrity prerequisites make the result unreliable.

## Display vs analysis

Display trees may collapse repeated nodes for readability. Analytical computations count the required pedigree positions/routes according to algorithm semantics. The two representations must not be conflated.

## Frontend rendering

v0.41.1 provides shared **headless geometry** in `frontend-kit/pedigreeLayout.ts` for spatial graph/radial layouts. This does not own scientific computation and does not own frontend styling.

Current graphical presentations:

- Heritage — lineage graph plus circular/radial family tree
- Q8 — desktop bloodline graph/constellation + mobile generation rail
- EquiData — graph + radial + ledger
- Prism — graph + radial + ledger

All consume canonical pedigree/metrics/path/coefficient APIs rather than recalculating scientific truth in frontend code.
