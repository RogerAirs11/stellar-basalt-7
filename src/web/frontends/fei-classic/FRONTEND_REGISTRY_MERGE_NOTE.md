# Frontend registry merge note

The branch-validation registry change is intentionally additive and must coexist with the parallel `retro-astra` lane.

Use these exact glob members in `src/web/frontendRegistry.ts`:

```ts
const manifestModules = import.meta.glob(
  ["./frontends/equidata-elite/manifest.ts", "./frontends/fei-classic/manifest.ts", "./frontends/retro-astra/manifest.ts"],
  { eager: true },
);
const entryLoaders = import.meta.glob(
  ["./frontends/equidata-elite/entry.tsx", "./frontends/fei-classic/entry.tsx", "./frontends/retro-astra/entry.tsx"],
);
```

If RetroAstra is not yet present in the merge target, add only `./frontends/fei-classic/manifest.ts` and `./frontends/fei-classic/entry.tsx` beside the existing EquiData entries; later merge RetroAstra without replacing either line.
