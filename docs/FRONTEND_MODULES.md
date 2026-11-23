# Frontend Module Architecture — v0.41.1

## Goal

Support genuinely independent frontend engines without duplicating backend/domain truth or forcing a common visual component system.

## Discovery

External frontends live under `src/web/frontends/<id>/` with at least `manifest.ts` and `entry.tsx`. The host build auto-discovers manifests/entries.

Current modules: Q8/Aspnamā, EquiData Elite, Prism Ultra. Heritage is the built-in core frontend.

## Boundary

A frontend may import its own files plus the public Frontend Kit root. It must not import host database/API internals or another frontend's visual implementation.

## Manifest

A manifest declares identity, contract range, required/optional capabilities, complete platform-feature accounting, style scope and maturity.

`platformFeatures` classifications are release-accounting promises. A `surface` classification must correspond to a visible first-class experience and is checked separately by `validate:visible-surfaces`.

## Shared headless modules

Shared frontend behavior is allowed only where semantics are stable and rendering-independent. Current example: `frontend-kit/pedigreeLayout.ts` computes pedigree graph/radial geometry while each frontend supplies its own renderer/tokens.

## Scaffold

`npm run frontend:new -- <id>` creates a normalized module scaffold and capability accounting from the current platform catalog. New live capabilities appear as explicit integration debt rather than silently disappearing.
