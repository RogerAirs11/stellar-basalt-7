# R31.13 Particle Splash natural hover/chimes merge

Date: 2026-09-16

## Input

`HORSE-DB-3-R31.7-PARTICLE-SPLASH-NATURAL-HOVER-CHIMES-NEW-DEFAULT-REPLACEMENT-ONLY-2026-09-16.zip`

Input SHA-256:

`b050a921b9784d38daa8f9a40458d954ff079702fd4e6894d307427b41640678`

The package contains exactly one source replacement:

`src/web/heritage/ParticleHorseSplash.tsx`

## Merge decision

Accepted and merged over the exact R31.12 source authority. R31.10→R31.11 localization did not modify this file, so the replacement does not roll back the centralized EN/FA localization repair.

## Material changes in the replacement

- New approved particle default profile.
- Horse scale and horizontal-position tuning.
- Wink-speed per-particle randomization.
- Wink size bias.
- Fine optical-bloom controls and rendering path.
- Motion-blur controls.
- Expanded particle settings ranges.
- Collision/neighbourhood-aware physical chime variation and anti-repeat voice-leading.
- Updated audio interaction signature and event multiplicity handling.

## Validation

PASS:

- source syntax
- frontend integration
- Core UI semantic regression
- CSS architecture
- mobile UX
- presentation parity
- visible-surface parity
- EN/FA localization
- production frontend source assets

Known inherited failure, reproduced on untouched R31.12:

- `validate-design-systems`: Heritage analytics raw typography shorthand warning
