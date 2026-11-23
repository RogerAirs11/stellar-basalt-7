# EquiData Elite — Integration Status

Imported source: a blind standalone mockup; its archive and extracted mockup source are not included in this repository.

## Visual identity preservation — v0.38.1 correction

The first v0.38 production adapter preserved the original source but rebuilt too much of its visible shell. That was technically clean but contrary to Horse DB's frontend-preservation philosophy. v0.38.1 corrects this without weakening the platform boundary:

- production loads the original Orbitron/Rajdhani font pair and uses frontend-owned typography tokens;
- the original `hero-mane`, hologram, lineage, performance and market imagery is reused by the production experience;
- the original hero + holographic dossier, marquee, live stats strip, four-discipline tabbed module layout and science composition are represented in production;
- Genome, Performance, Market and AI remain visible as **DORMANT** when unsupported instead of being deleted or populated with mock values;
- all real data still enters through `runtime.platform`; production never imports mockup source;
- generic panels/cards across Registry/Profile/Compare/Pedigree/Rankings/Breeding/People/Quality inherit the same luminous glass/cyan-gold visual grammar instead of reverting to a generic shell.

A design-system regression validator now checks these invariants alongside the existing mock-leakage validator.

## Supported now

| Imported / added experience | Status | Horse DB source |
| --- | --- | --- |
| Home / landing console | LIVE | platform meta, health, registry, analytics |
| Registry explorer | LIVE | search, structured_search, registry, registry_facets; grid/list views |
| Horse profile | LIVE | horse_profiles + people links |
| Professional directory (public listing + published profile) | LIVE (R107 NEXT-06-elite) | platform.modules.directory.persons/person — consent-gated public reads, honest empty/error states, platform-mediated contact |
| Service requests (requester + provider views) | LIVE (R107 NEXT-06-elite) | platform.modules.serviceRequests.create/mine/inbox/setStatus/withdrawConsent/redactNote/providerBlock/report — explicit consent gate, idempotent creation, CAS transitions |
| Pedigree explorer | LIVE when available | pedigree_ancestors, pedigree_descendants, pedigree_metrics, pedigree_paths, pedigree_coefficients |
| Descendant context | LIVE when available | descendant tree + bounded descendant metrics |
| Compare bloodlines | LIVE | horse profiles + pedigree metrics/coefficients + relationships |
| Rankings | LIVE when available | registry_analytics |
| Registry observatory | LIVE when available | registry_analytics |
| People network | LIVE when available | people |
| Data-quality summary | LIVE when available | quality_summary |
| Ownership claim list/create | LIVE when authenticated/permitted | owner_claims + canonical permissions |
| EquiData Control login/session | LIVE | authentication + backend-issued permissions |
| Governance review queues | LIVE when permitted | admin claims/change requests + review actions |
| Audit + privileged quality findings | LIVE when permitted | audit + admin quality |
| Canonical horse curation | LIVE when permitted | admin horse get/create/update/archive |
| Search maintenance / reindex | LIVE when permitted | admin maintenance |
| Watchlist/favorites | FRONTEND-LOCAL | browser local storage |
| Breeding Lab | LIVE when available | new canonical `breeding_analysis 0.1.0` |
| Platform coverage matrix | LIVE | full `platformMeta.featureCatalog`; available features link to real surfaces, reserved features show dormant |
| Persian / RTL | LIVE | complete frontend chrome, Persian numerals, Vazirmatn typography, RTL layout |

## Platform extension promoted from this frontend

### `breeding_analysis 0.1.0` — experimental

The mockup had a sire × dam simulator. Its useful, generalizable concept was promoted to Horse DB as a reusable scientific capability rather than a frontend-specific endpoint.

Production semantics:

- uses canonical pedigree graphs and the existing relationship coefficient engine;
- prospective offspring pedigree COI = parental kinship/coancestry at the selected finite depth;
- returns parental relationship/kinship, parental COIs, both pedigree coverage values, common ancestors, cycle/truncation integrity and provenance;
- explicitly **does not** claim genomic compatibility, disease risk, fertility, performance, market value or breeding recommendation.

Platform route/SDK:

```text
GET /api/breeding/pairing-analysis?sire=<id>&dam=<id>&depth=<n>
platform.breeding.pairingAnalysis(sireId, damId, { depth })
```

This capability belongs to the canonical platform and may be used by Heritage/Q8/future frontends later.

## Preserved but dormant

| Mockup feature | Classification | Reason |
| --- | --- | --- |
| Genomic score / DNA marker cards | NEW-DATA-CANDIDATE / DORMANT | canonical registry has no validated genomic dataset |
| Trait inheritance projection | NEW-DATA-CANDIDATE / DORMANT | requires genomic source + validated inheritance model |
| Speed/stamina/EDX indices | NEW-DATA-CANDIDATE / DORMANT | no canonical performance dataset/model |
| Starts/wins/earnings | NEW-DATA-CANDIDATE / DORMANT | no canonical competition/performance feed |
| Soundness-risk model | NEW-DATA-CANDIDATE / DORMANT | no veterinary/health dataset; should never be fabricated |
| Market value / value trend | NEW-DATA-CANDIDATE / DORMANT | no validated sales/valuation dataset |
| Projected foal market ceiling | UNSUPPORTED / DORMANT | depends on absent market + predictive model |
| Cryptographic lineage verification | PLATFORM-RESERVED / DORMANT | `verification` remains unavailable |
| Media-rich horse galleries | PLATFORM-RESERVED / DORMANT | `media` remains unavailable |
| Free-form AI research assistant | PLATFORM-RESERVED / DORMANT | no canonical AI service; scripted mock answers are not shown as real intelligence |
| Pricing / paid access marketing | FRONTEND-LOCAL PRESERVED | not a Horse DB registry-domain capability |
| Testimonials / marketing logos | FRONTEND-LOCAL PRESERVED | standalone marketing content retained in this frontend |

Reserved platform capability keys remain for `genomics`, `performance_records`, and `market_data`. `ai_assistant` is now a real canonical platform capability (`1.0.0 experimental`) and the preserved EquiData Assistant surface consumes that backend directly when deployment capability/status reports it available.

## Added missing Horse DB capabilities to this frontend

The blind mockup did not know about several Horse DB capabilities. Production EquiData now adds:

- canonical people profiles/network;
- registry-wide analytics observatory;
- data-quality summary;
- owner claims using canonical backend-issued permissions;
- real pedigree completeness/repeated ancestry/COI;
- bounded descendant graph and ancestor-path tracing;
- structured registry filters plus grid/list modes and whole-card navigation;
- complete Persian/RTL presentation with Vazirmatn;
- native EquiData Control for authentication, audit, review queues, curation and maintenance;
- a dynamic platform-capability matrix so supported backend features cannot disappear silently;
- real pairwise relationship/kinship;
- explicit canonical-vs-dormant data provenance states;
- canonical shareable Horse DB routes for home/browse/stats/horse/person;
- namespaced EquiData-only routes for tools.

## Routing

Canonical semantic routes:

```text
/
/browse
/stats
/horse/<id>
/person/<id>
```

Frontend-owned routes:

```text
/f/equidata-elite/compare
/f/equidata-elite/pedigree/<id>
/f/equidata-elite/rankings
/f/equidata-elite/breeding-lab
/f/equidata-elite/assistant
/f/equidata-elite/people
/f/equidata-elite/quality
/f/equidata-elite/watchlist
/f/equidata-elite/claims
/f/equidata-elite/platform
/f/equidata-elite/governance
```

## Integration invariant

Production EquiData must never import mock horse records or mock scientific/market scores. Production code is forbidden from importing mockup source and real mode uses `runtime.platform` only.
