/** Assets omitted from an uploaded source archive must not become broken URLs.
 * Discover the files that are actually shipped. Restoring an original file at
 * its established path restores it at the next build; no substitute photograph
 * is ever presented as evidence about a registry horse. */
const publicFiles = import.meta.glob("../../public/assets/**/*.{avif,webp,svg}", { eager: true, import: "default", query: "?url" });
const availablePaths = new Set(Object.keys(publicFiles).map(path => path.replace("../../public", "")));

// Keep the original approved model path. A missing optional model must not
// break the production bundle or silently start third-party model requests.
const particleModels = import.meta.glob("./assets/particle-horse/*.glb", { eager: true, import: "default", query: "?url" }) as Record<string, string>;
export const PARTICLE_HORSE_MODEL_URL = particleModels["./assets/particle-horse/Horse.glb"];

export function availablePublicAsset(path: string): string | undefined {
  return availablePaths.has(path) ? path : undefined;
}

export const FALLBACK_ASSETS = Object.freeze({
  brand: "/assets/fallbacks/registry-mark.svg",
  day: "/assets/fallbacks/abstract-day.svg",
  night: "/assets/fallbacks/abstract-night.svg",
  divider: "/assets/fallbacks/registry-divider.svg",
  missingPhoto: "/assets/fallbacks/record-image-unavailable.svg",
});

export const HERITAGE_DECORATION = Object.freeze({
  day: availablePublicAsset("/assets/equine-day.webp") ?? FALLBACK_ASSETS.day,
  night: availablePublicAsset("/assets/equine-night.webp") ?? FALLBACK_ASSETS.night,
  divider: availablePublicAsset("/assets/equine-divider.webp") ?? FALLBACK_ASSETS.divider,
  brand: availablePublicAsset("/assets/arabian-brand-mark.webp") ?? FALLBACK_ASSETS.brand,
  splash: availablePublicAsset("/assets/arabian-hero-crest.webp") ?? FALLBACK_ASSETS.brand,
});
