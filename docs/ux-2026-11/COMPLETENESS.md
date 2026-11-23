# Horse registry: production completeness review

**89,872 active registry horses. Indexed coverage is high; complete horse histories and full partner parity are not established.** This review reconciles a pinned archive or published index against Supabase, rather than adding together overlapping horse, racing and source counts.

| Public source or archive | What was verified | What remains |
|---|---|---|
| Asbdavani public index | 7,037 of 7,038 indexed horse IDs have a racing stats row; 1,705 of 1,705 people have racing person records. | 44 horse IDs have no verified master link (includes the missing stats ID). At the audit snapshot, 224 pages checked, 14,565 queued, one in progress, three held. Pages are not unique horses. Index and totals do not prove complete histories. |
| Sheyhe | 35,483 archived profiles; 23,258 linked using an explicit source slug or a unique chip plus agreeing name. | 12,225 source-only; 5,466 parent assertions conflict with a registry parent. Don't resolve these by name alone. |
| Federation and show archives | 5,330/5,330 federation ranking keys, 6,663/6,663 archived federation-channel show results on eight fields, and 1,363/1,363 Sheyhe scorecard keys matched. A separate federation ranking archive had 1,105 matching keys. | Keys prove presence, not field parity, identity or current upstream totals. Official Turkmen PDF: only 139/246 rows match both exact chip and name (136 distinct horses). |
| Caspian sources | All 22 archived stallion name/registration pairs matched after Persian digit normalization. | A **different** source, the 2017 international studbook, has 22 of 2,120 references without an exact registry ID. Neither is a current studbook export. |

### What is actually missing inside active records

Production contains 95,652 registry rows, 93,909 nondeleted; the racing tables contain 14,795 horse stats IDs, 12,950 races and 122,389 entries, not additional registry animals. Among the 89,872 active horses, 17,118 have no coat, 480 no sex, and 4,910 no birth year, legacy date or typed birth value. 28,373 lack a sire ID; 31,986 lack a dam ID; 27,293 lack both. A missing ID does not rule out a textual parent name. Another 2,621 have only a legacy birth year; do not infer January 1. The 9,628 active rows with a legacy date and no typed date merit a separate calendar/precision reconciliation before promotion.

### New production evidence

74 attributed observations inserted and read back field-for-field: 42 race placings from two federation-channel reports; 12 show-jumping and seven eventing placings plus 13 endurance completions from Gilan. No race starts or master horses were inserted. Two accounts of one jumping event were collapsed; variant rider labels are preserved without merging people. Of the racing observations, 30 have the same date, venue, round, rank, normalized horse label and elapsed milliseconds as existing starts; six more match without source times. Six do not match under those rules and remain evidence only. See `sport-facts.json`, `comparison.json`, `sport-readback.json`. These are archived public reports, not newly sanctioned results or automatic profile joins.

### Frontend production checks and release scope

On the **same live horse**, Frari (#10100000), the database has null birth date/year and coat. Modern falsely showed a January 1900 birth, 125 years and Bay, also visible on a 320px Persian phone. Core showed the registered identity without those invented values in the inspected overview. Prior to correction, neither layout overflowed in four live profile checks: both apps at 320px RTL and 1366px LTR. Inspect `profile-review.json` for the *before* evidence. Patch: use typed calendar/precision, no default birth for missing dates, range-aware age, source coat/sex labels on profile/cards, withhold an unsupported mating shortcut on the profile. Full profiles are fetched when opened rather than treating a browse hit as a full record. No Core UI redesign or schema migration in this patch.

### Remaining work / acceptance for full parity

1. Obtain dated, authorized exports or a documented incremental feed from each partner, including stable horse/parent/event IDs, field definitions, precision, deletions and update timestamps. Reconcile IDs **and** populated values, removals and conflicts; publish per-source deltas on a schedule. A sitemap is not a database dump.
2. Resume the rate-limited public detail queue; inspect held layouts separately. Resolve the six unmatched race facts, Sheyhe conflicts, and unlinked master identities with corroboration. Do not bulk-promote raw news, rankings or listings.
3. Wire attributed competition evidence to public profiles only after verified identity and visibility review. Modern still has donor-era fallback categories in pedigree/sex styling, genetics/breeding, trust/status and registry facets. Review those and compare authenticated care, submission and admin workflows, touch and screen-reader behavior on physical devices. The smoke tests are browser viewport tests, not physical-device certification.
4. Refresh stale analytics; reconcile the outstanding microchip visibility validator with documented policy; run the whole regression suite and platform gate. No claim of complete production readiness until these pass.
