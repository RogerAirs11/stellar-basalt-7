# v0.41.2 Reference-Sampling Calibration

Application **0.41.2** · Platform contract **2.11.1** · analytics schema/algorithm **2.1.0 / 2.1.0**

## Why this patch exists

v0.41 introduced deterministic sampled exact-pedigree mean kinship for recent same-breed reference cohorts. The registry-wide snapshot intentionally uses a small deterministic reference sample so all current-cohort horses can receive a reproducible estimate without turning every snapshot rebuild into a multi-minute relationship-matrix job.

v0.41.2 measures that approximation directly on the real registry and exposes **sampling precision separately from pedigree completeness**. A horse can therefore have excellent pedigree coverage while still carrying a medium/low sampling-precision grade, or vice versa.

## Reproducible benchmark

Run:

```bash
npm run benchmark:reference-sampling
```

The release benchmark used the verified canonical/runtime registry, the six largest cycle-clean recent same-breed cohorts, 128 deterministic target horses per cohort, and a deterministic **n=512** reference sample as the comparison baseline.

Overall absolute error versus that larger reference sample:

| Reference sample | MAE | Median | P90 | P95 | Max | nominal-95% interval coverage |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 | 0.2415 pp | 0.1111 pp | 0.6561 pp | 0.8598 pp | 2.9556 pp | 79.7% |
| **32 (production snapshot)** | **0.1863 pp** | **0.0881 pp** | **0.5371 pp** | **0.7009 pp** | **1.8608 pp** | **82.2%** |
| 64 | 0.1173 pp | 0.0611 pp | 0.3102 pp | 0.3847 pp | 1.8608 pp | 88.4% |
| 128 | 0.0818 pp | 0.0471 pp | 0.2056 pp | 0.2825 pp | 1.1284 pp | 91.4% |
| 256 | 0.0439 pp | 0.0244 pp | 0.1211 pp | 0.1556 pp | 0.3293 pp | 96.7% |

`pp` = percentage points of pedigree mean kinship.

Precision varies materially by cohort. Arabian n=32 performed strongly (MAE ~0.2504 pp; Spearman ~0.979), while some other cohorts showed larger rank/interval error. That is why v0.41.2 does **not** present the normal-theory interval as an empirical 95% guarantee.

## Runtime trade-off

Globally increasing the snapshot reference sample to 64/128/256 is not currently acceptable in this architecture: full-registry prototype builds at 64+ exceeded multi-minute execution limits because recursive exact pedigree pair caching grows sharply.

By contrast, an on-demand **single-horse n=256** calculation in the Python reference implementation took roughly **0.001–0.32 seconds** across tested Arabian, Turkoman, Part Bred, Kurdish and Sport Horse examples. This strongly supports a future premium **High-Precision Kinship Audit** endpoint/cache instead of making every registry snapshot expensive.

Hardware/runtime-specific timings are feasibility measurements, not API latency guarantees.

## Sampling-precision grade

The API now returns `meanKinship.samplingPrecision`:

- **high** — nominal 95% half-width ≤ **0.5 percentage points**
- **medium** — half-width > 0.5 and ≤ **1.0 percentage point**
- **low** — half-width > **1.0 percentage point**
- **unavailable** — no valid sampled mean-kinship standard error

This grade describes only numerical precision of the sampled mean estimate. It is deliberately separate from pedigree-completeness/confidence and is not genomic certainty.

All four production frontends expose the grade, half-width, and interpretation with semantic green/amber/red encoding.

## Scientific boundary

The n=512 result is a **larger deterministic pedigree-reference approximation**, not genomic ground truth and not mathematically exact population-wide mean kinship. External population-genetics review remains required before marketing Horse DB's DPI/mean-kinship methodology as professional scientific advice.
