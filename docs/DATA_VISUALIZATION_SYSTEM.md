# Horse DB Data Visualization System

Status: **canonical frontend guidance**  
Application: **v0.41.1**  
Platform contract: **2.11.0**

## Principle

> **Share semantic meaning. Preserve independent visual interpretation.**

Heritage, Q8, EquiData and Prism must communicate the same data truth without being forced into one visual skin.

## Semantic channels

Every frontend maps these meanings into its own token system:

- primary/accent
- positive/healthy
- information/context
- warning/incomplete
- danger/integrity failure
- sire/paternal
- dam/maternal
- ownership/people roles
- registry identity/provenance
- neutral/background

Use multichannel encoding where useful: hue + surface tint + shape/icon + typography + position + motion. Color alone must not carry critical meaning.

## Presentation parity

Presentation parity means comparable semantic depth, not identical composition.

Every live capability must be:

1. discoverable;
2. usable;
3. backed by canonical data/PlatformClient;
4. represented with loading/error/empty states;
5. presented at a depth appropriate to the capability.

A manifest `surface` flag or endpoint call is insufficient.

## Pedigree graphical floor

A full pedigree experience must support:

- graphical ancestor exploration;
- graphical descendant exploration;
- depth/generation controls;
- clickable horse nodes;
- paternal/maternal/offspring semantics;
- repeated-ancestor and cycle encoding;
- structural coverage/integrity context;
- path tracing where supported;
- coefficient context and suppression when scientifically invalid.

Circular/radial views are additional first-class modes in Heritage, EquiData and Prism. Q8 may use its own desktop constellation/mobile rail interpretation while meeting the same semantic floor.

Shared geometry may live in Frontend Kit, but renderers/tokens remain local to each engine.

## Analytics floor

All frontends should expose the complete live registry-analytics domains:

- population/time
- identity/demography (sex, breed, color, strain, place)
- parentage/pedigree integrity
- progeny/represented ancestors
- people/registry roles
- field coverage/data quality

Do not truncate backend-provided ranked arrays arbitrarily without an explicit drill-down to the complete result.

## Motion

Motion should encode state/flow, not create noise. Respect `prefers-reduced-motion`. Never use animation to hide slow data loading or to imply scientific certainty.

## Scientific truth

Missing parent ≠ known founder. Structural coverage ≠ COI. Cycle/truncation states must be explicit. Coefficients must be withheld/suppressed when their integrity prerequisites are not satisfied.
