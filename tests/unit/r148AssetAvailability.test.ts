import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availablePublicAsset, FALLBACK_ASSETS, HERITAGE_DECORATION, PARTICLE_HORSE_MODEL_URL } from "../../src/web/assetCatalog";
import { HORSE_PLACEHOLDER_PHOTOS, horsePlaceholderBatch } from "../../src/web/sharedAssets";
import { DEFAULT_VISUAL_ASSETS, HERITAGE_BACKGROUND_OPTIONS, HERITAGE_BRAND_ART_OPTIONS, HERITAGE_SPLASH_ART_OPTIONS, getHeritageBackgroundThreeDScene, resolveHeritageBackgroundSource, resolveHeritageBrandSource, resolveHeritageSplashSource } from "../../src/web/heritageVisualAssets";
import ParticleHorseSplash from "../../src/web/heritage/ParticleHorseSplash";

const shipped = (source: string) => {
  /* R150: self-contained data URIs (e.g. the subtle "none"-wallpaper SVG tile)
     have no file on disk by design — they are their own payload. */
  if (source.startsWith("data:")) return;
  const pathname = source.split(/[?#]/, 1)[0];
  const file = pathname.startsWith("/assets/") ? resolve("public", pathname.slice(1)) : resolve(pathname.replace(/^\//, ""));
  expect(existsSync(file), `Missing selected asset ${source}`).toBe(true);
};

describe("R148 shipped visual assets", () => {
  it("discovers present public assets and never advertises absent files", () => {
    for (const source of Object.values(FALLBACK_ASSETS)) {
      shipped(source);
      expect(availablePublicAsset(source)).toBe(source);
    }
    expect(availablePublicAsset("/assets/a-file-that-is-not-shipped.webp")).toBeUndefined();
    for (const source of Object.values(HERITAGE_DECORATION)) shipped(source);
  });

  it("always has shipped defaults and only exposes available branding/wallpaper options", () => {
    for (const [field, stem] of [["brandArt", "antique_gold_crescent_horse_emblem"], ["splashArt", "achaemenid_horse_sun_medallion"]] as const) {
      const originalExists = existsSync(resolve(`src/web/assets/heritage-art-library/logos/${stem}.webp`));
      expect(DEFAULT_VISUAL_ASSETS[field]).toBe(originalExists ? `library-logo-${stem}` : "registry-neutral");
    }
    expect(HERITAGE_BRAND_ART_OPTIONS.some(option => option.id === DEFAULT_VISUAL_ASSETS.brandArt)).toBe(true);
    expect(HERITAGE_SPLASH_ART_OPTIONS.some(option => option.id === DEFAULT_VISUAL_ASSETS.splashArt)).toBe(true);
    shipped(resolveHeritageBrandSource(DEFAULT_VISUAL_ASSETS));
    shipped(resolveHeritageSplashSource(DEFAULT_VISUAL_ASSETS));
    for (const mode of ["light", "dark"] as const) shipped(resolveHeritageBackgroundSource(DEFAULT_VISUAL_ASSETS, mode));
    for (const option of [...HERITAGE_BACKGROUND_OPTIONS, ...HERITAGE_BRAND_ART_OPTIONS, ...HERITAGE_SPLASH_ART_OPTIONS]) {
      if (option.source) shipped(option.source);
    }
  });

  it("enables a parallax scene only if every original layer and preview is shipped", () => {
    for (const [id, folder, preview, count, extension] of [
      ["achaemenid-3d", "achaemenid", "base", 5, "avif"],
      ["arabian-valley-3d", "horses", "base", 5, "avif"],
      ["moonlit-valley-overlook-3d", "night-valley", "preview", 4, "webp"],
      ["moonlit-royal-axis-3d", "night-axis", "preview", 4, "webp"],
    ] as const) {
      const names = [`${preview}.${extension}`, ...Array.from({ length: count }, (_, index) => `layer-${index + 1}.${extension}`)];
      const complete = names.every(name => existsSync(resolve(`src/web/assets/heritage-parallax-scenes/${folder}/${name}`)));
      const scene = getHeritageBackgroundThreeDScene(id);
      expect(Boolean(scene), `${id} availability must match its complete pack`).toBe(complete);
      if (scene) {
        shipped(scene.preview);
        expect(scene.layerSources).toHaveLength(count);
        scene.layerSources.forEach(shipped);
      }
    }
  });

  it("hides the optional particle splash and does not mount its renderer without its original model", () => {
    const exists = existsSync(resolve("src/web/assets/particle-horse/Horse.glb"));
    expect(Boolean(PARTICLE_HORSE_MODEL_URL)).toBe(exists);
    expect(HERITAGE_SPLASH_ART_OPTIONS.some(option => option.id === "particle-horse")).toBe(exists);
    if (!exists) expect(renderToStaticMarkup(createElement(ParticleHorseSplash, { locale: "en" }))).toBe("");
    else shipped(PARTICLE_HORSE_MODEL_URL!);
  });

  it("uses a clearly non-photographic placeholder when original photographs are absent", () => {
    expect(HORSE_PLACEHOLDER_PHOTOS.length).toBeGreaterThan(0);
    for (const photo of HORSE_PLACEHOLDER_PHOTOS) shipped(photo.src);
    const batch = horsePlaceholderBatch([1, 2, 3, 4], "asset-test");
    expect(batch).toHaveLength(4);
    if (HORSE_PLACEHOLDER_PHOTOS[0].id === "record-image-unavailable") {
      expect(HORSE_PLACEHOLDER_PHOTOS).toHaveLength(1);
      expect(HORSE_PLACEHOLDER_PHOTOS[0].tags).toContain("non-photographic");
      expect(HORSE_PLACEHOLDER_PHOTOS[0].note).toContain("not a photograph");
      expect(readFileSync(resolve("public", FALLBACK_ASSETS.missingPhoto.slice(1)), "utf8")).toContain("Photo unavailable");
    }
  });

  it("keeps every mandatory Core fallback and native icon in the release inventory", () => {
    const policy = JSON.parse(readFileSync("src/web/frontendReleasePolicy.json", "utf8"));
    const required = policy.requiredProductionAssets.heritage as string[];
    for (const source of Object.values(FALLBACK_ASSETS)) expect(required).toContain(source.slice(1));
    for (const file of required) expect(existsSync(resolve("public", file))).toBe(true);
    const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
    for (const icon of manifest.icons) shipped(icon.src);
  });

  it("resolves every literal local CSS asset against its actual stylesheet or public directory", () => {
    for (const entry of readdirSync("src/web", { recursive: true })) {
      if (typeof entry !== "string" || !entry.endsWith(".css")) continue;
      const file = resolve("src/web", entry);
      for (const match of readFileSync(file, "utf8").matchAll(/url\(\s*["']?([^"')\s]+)/g)) {
        const source = match[1].split(/[?#]/, 1)[0];
        if (!source.startsWith("/") && !source.startsWith(".")) continue;
        const target = source.startsWith("/") ? resolve("public", source.slice(1)) : resolve(dirname(file), source);
        expect(existsSync(target), `Broken CSS asset ${source} in ${file}`).toBe(true);
      }
    }
  });
});
