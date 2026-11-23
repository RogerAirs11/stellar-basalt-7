/** Optional original textures owned by this frontend's public asset namespace.
 * Missing textures use the existing scoped CSS gradients. Restoring originals
 * at their established paths makes them available at the next build. */
const headerFiles = import.meta.glob("../../../../public/assets/frontends/fei-classic/images/*.webp", { eager: true, import: "default", query: "?url" }) as Record<string, string>;

export const FEI_HEADER_ASSET_STYLES = Object.freeze(Object.fromEntries([
  ["--fei-top-links", "top-links"],
  ["--fei-top-nav-bg", "top-nav-bg"],
  ["--fei-top-nav-closed-noarrow", "top-nav-closed-noarrow"],
  ["--fei-top-nav-closed", "top-nav-closed"],
  ["--fei-top-nav-noarrow", "top-nav-noarrow"],
  ["--fei-top-nav", "top-nav"],
  ["--fei-top-nav-sub-top", "top-nav-sub-top"],
].flatMap(([key, stem]) => {
  const source = headerFiles[`../../../../public/assets/frontends/fei-classic/images/${stem}.webp`];
  return source ? [[key, `url("${source}")`]] : [];
})));
