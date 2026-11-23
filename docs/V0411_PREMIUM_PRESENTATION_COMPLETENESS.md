# v0.41.1 Premium Presentation Completeness

v0.41.1 closes the gap between **calculation completeness** and **presentation completeness** discovered after v0.41.0.

## Scientific data now visibly represented

Every frontend now provides compact access to the reference-population and optimizer fields that were previously returned but under-presented: cohort membership, sampled mean-kinship standard error and approximate interval, founder assumption, pedigree completeness, source/method provenance, P10/P90 cohort distributions, projected mating known/expected ancestor positions, sire/dam ancestor counts, projected Top-10 concentration, optimizer raw/confidence-adjusted scores, component weights, avoided-ancestor evidence/warnings, influence depth and decade trajectories, average/median EGC, generation-age validity ranges and both direct paternal/maternal line-survival leaders.

Primary surfaces remain compact. Secondary scientific information is placed in structured detail/disclosure regions rather than dumped into the headline dashboard.

## Semantic visual grammar

| Meaning | Visual family |
| --- | --- |
| Pedigree kinship / information | cyan / blue |
| Diversity / DPI / preservation | green |
| Rarity / ancestry concentration | gold / orange |
| COI / pedigree conflicts / cycles | rose / danger |
| Direct sire line | cyan |
| Direct dam line | magenta / rose |
| Rising lineage trajectory | green |
| Fading lineage trajectory | red |
| Current/default lineage influence | cyan / violet |
| Optimizer best candidate | green best-rank treatment |
| Optimizer ranks 2–3 | gold/orange top-rank treatment |

The colors supplement labels, numbers, rank and structure; color alone is not the sole carrier of meaning.

## New enforcement

`tools/validate-premium-presentation-completeness.mjs` is wired into `npm run check` as `validate:premium-presentation`. It verifies that all four engines materially render the scientific field families and semantic CSS hooks, rejects known non-contract DTO aliases, and rejects Prism premium styles that accidentally use undefined `--pu-*` tokens instead of the real `--p-*` system.

## Scientific/product boundary

The reference-population statistics are explainable recorded-pedigree measures. The UI consistently exposes confidence/provenance and avoids language implying genomic or phenotype prediction.
