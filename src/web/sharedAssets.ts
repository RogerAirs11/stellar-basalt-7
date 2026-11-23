import { availablePublicAsset, FALLBACK_ASSETS } from "./assetCatalog";
import type { HorsePlaceholderPhoto, SharedFrontendAssets } from "../frontend-kit/assets";
export type { HorsePlaceholderPhoto, SharedFrontendAssets } from "../frontend-kit/assets";

const OPTIONAL_HORSE_PLACEHOLDER_PHOTOS = [
  {
    "id": "horse-placeholder-01",
    "src": "/assets/horses/placeholders/elegant-bay-horse-portrait.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "bay",
    "scene": "pasture",
    "note": "classic close portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "bay",
      "pasture"
    ]
  },
  {
    "id": "horse-placeholder-02",
    "src": "/assets/horses/placeholders/elegant-chestnut-show-horse.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "chestnut",
    "scene": "paddock",
    "note": "show portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "chestnut",
      "paddock"
    ]
  },
  {
    "id": "horse-placeholder-03",
    "src": "/assets/horses/placeholders/speckled-white-horse-portrait.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "gray",
    "scene": "pasture",
    "note": "soft gray portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "gray",
      "pasture"
    ]
  },
  {
    "id": "horse-placeholder-04",
    "src": "/assets/horses/placeholders/elegant-dark-arabian-horse-portrait.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "black",
    "scene": "pasture",
    "note": "dark portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "black",
      "pasture"
    ]
  },
  {
    "id": "horse-placeholder-05",
    "src": "/assets/horses/placeholders/elegant-bay-horse-in-a-sunlit-meadow.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "bay",
    "scene": "meadow",
    "note": "fuller standing portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "bay",
      "meadow"
    ]
  },
  {
    "id": "horse-placeholder-06",
    "src": "/assets/horses/placeholders/vintage-cream-horse-portrait.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "cream",
    "scene": "pasture",
    "note": "warm cream portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "cream",
      "pasture"
    ]
  },
  {
    "id": "horse-placeholder-07",
    "src": "/assets/horses/placeholders/glossy-bay-horse-portrait.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "bay",
    "scene": "paddock",
    "note": "glossy portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "bay",
      "paddock"
    ]
  },
  {
    "id": "horse-placeholder-08",
    "src": "/assets/horses/placeholders/silver-arabian-horse-in-pastoral-light.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "gray",
    "scene": "pasture",
    "note": "silver portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "gray",
      "pasture"
    ]
  },
  {
    "id": "horse-placeholder-09",
    "src": "/assets/horses/placeholders/regal-black-horse-in-pasture.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "black",
    "scene": "pasture",
    "note": "regal dark portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "black",
      "pasture"
    ]
  },
  {
    "id": "horse-placeholder-10",
    "src": "/assets/horses/placeholders/chestnut-horse-in-pasture-portrait.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "chestnut",
    "scene": "pasture",
    "note": "white-blaze portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "chestnut",
      "pasture"
    ]
  },
  {
    "id": "horse-placeholder-11",
    "src": "/assets/horses/placeholders/elegant-cream-horse-portrait.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "cream",
    "scene": "woodland",
    "note": "cream woodland portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "cream",
      "woodland"
    ]
  },
  {
    "id": "horse-placeholder-12",
    "src": "/assets/horses/placeholders/dappled-gray-horse-portrait.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "gray",
    "scene": "pasture",
    "note": "dapple gray portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "gray",
      "pasture"
    ]
  },
  {
    "id": "horse-placeholder-13",
    "src": "/assets/horses/placeholders/alert-chestnut-horse-in-pastoral-fields.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "bay",
    "scene": "rolling fields",
    "note": "pastoral portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "bay",
      "rolling fields"
    ]
  },
  {
    "id": "horse-placeholder-14",
    "src": "/assets/horses/placeholders/vintage-white-horse-portrait.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "white",
    "scene": "woodland",
    "note": "aged white portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "white",
      "woodland"
    ]
  },
  {
    "id": "horse-placeholder-15",
    "src": "/assets/horses/placeholders/proud-chestnut-horse-in-pasture.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "chestnut",
    "scene": "pasture",
    "note": "proud chestnut portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "chestnut",
      "pasture"
    ]
  },
  {
    "id": "horse-placeholder-16",
    "src": "/assets/horses/placeholders/dappled-arabian-horse-portrait.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "gray",
    "scene": "pasture",
    "note": "dapple Arabian-style portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "gray",
      "pasture"
    ]
  },
  {
    "id": "horse-placeholder-17",
    "src": "/assets/horses/placeholders/dappled-horse-by-the-sunset-shore.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "gray",
    "scene": "coast",
    "note": "sunset shoreline portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "gray",
      "coast"
    ]
  },
  {
    "id": "horse-placeholder-18",
    "src": "/assets/horses/placeholders/golden-bay-horse-in-sunlit-woodland.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "bay",
    "scene": "olive grove",
    "note": "golden woodland portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "bay",
      "olive grove"
    ]
  },
  {
    "id": "horse-placeholder-19",
    "src": "/assets/horses/placeholders/black-horse-against-desert-dusk.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "black",
    "scene": "desert",
    "note": "desert dusk portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "black",
      "desert"
    ]
  },
  {
    "id": "horse-placeholder-20",
    "src": "/assets/horses/placeholders/autumn-chestnut-horse-portrait.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "chestnut",
    "scene": "autumn forest",
    "note": "autumn woodland portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "chestnut",
      "autumn forest"
    ]
  },
  {
    "id": "horse-placeholder-21",
    "src": "/assets/horses/placeholders/serene-white-horse-in-snow.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "white",
    "scene": "snow",
    "note": "winter portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "white",
      "snow"
    ]
  },
  {
    "id": "horse-placeholder-22",
    "src": "/assets/horses/placeholders/golden-horse-in-a-sunlit-wildflower-field.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "palomino",
    "scene": "wildflower field",
    "note": "golden wildflower portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "palomino",
      "wildflower field"
    ]
  },
  {
    "id": "horse-placeholder-23",
    "src": "/assets/horses/placeholders/dapple-gray-horse-in-mountain-pasture.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "gray",
    "scene": "mountain meadow",
    "note": "mountain portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "gray",
      "mountain meadow"
    ]
  },
  {
    "id": "horse-placeholder-24",
    "src": "/assets/horses/placeholders/horse-at-the-rustic-barn-door.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "dark bay",
    "scene": "stable",
    "note": "rustic barn portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "dark bay",
      "stable"
    ]
  },
  {
    "id": "horse-placeholder-25",
    "src": "/assets/horses/placeholders/misty-gray-horse-by-the-water.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "gray",
    "scene": "waterside",
    "note": "misty water portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "gray",
      "waterside"
    ]
  },
  {
    "id": "horse-placeholder-26",
    "src": "/assets/horses/placeholders/spotted-horse-under-cloudy-skies.avif",
    "width": 1122,
    "height": 1402,
    "aspectRatio": "4:5",
    "coat": "spotted",
    "scene": "open plain",
    "note": "dramatic-cloud portrait",
    "tags": [
      "horse",
      "placeholder",
      "photo",
      "analog",
      "vintage",
      "portrait",
      "spotted",
      "open plain"
    ]
  }
] as const satisfies readonly HorsePlaceholderPhoto[];

const availableHorsePhotos=OPTIONAL_HORSE_PLACEHOLDER_PHOTOS.filter(photo=>availablePublicAsset(photo.src));
export const HORSE_PLACEHOLDER_PHOTOS:readonly HorsePlaceholderPhoto[]=availableHorsePhotos.length?availableHorsePhotos:[{
  id:"record-image-unavailable",src:FALLBACK_ASSETS.missingPhoto,width:800,height:1000,aspectRatio:"4:5",coat:"unknown",scene:"none",
  note:"Neutral missing-image symbol; not a photograph or evidence about this horse",tags:["placeholder","unavailable","non-photographic"],
}];

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function horsePlaceholderFor(key: string | number, variant = 0): HorsePlaceholderPhoto {
  const index = stableHash(`${String(key)}:${variant}`) % HORSE_PLACEHOLDER_PHOTOS.length;
  return HORSE_PLACEHOLDER_PHOTOS[index]!;
}

export function horsePlaceholderBatch(keys: readonly (string | number)[], context = "default"): HorsePlaceholderPhoto[] {
  if (!keys.length) return [];
  const pool = [...HORSE_PLACEHOLDER_PHOTOS];
  const result: HorsePlaceholderPhoto[] = [];
  let available = [...pool];

  for (let index = 0; index < keys.length; index += 1) {
    if (!available.length) available = [...pool];
    const recent = result.slice(-3);
    const preferred = stableHash(`${context}:${String(keys[index])}:${index}`) % available.length;
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    available.forEach((photo, candidateIndex) => {
      const immediate = recent.at(-1);
      const previous = recent.at(-2);
      const older = recent.at(-3);
      let score = 0;
      if (immediate?.src === photo.src) score += 100;
      if (immediate?.coat === photo.coat) score += 9;
      if (immediate?.scene === photo.scene) score += 8;
      if (previous?.coat === photo.coat) score += 4;
      if (previous?.scene === photo.scene) score += 3;
      if (older?.scene === photo.scene) score += 1;
      // Stable tie-breaker keeps the mapping deterministic while spreading usage.
      score += ((candidateIndex - preferred + available.length) % available.length) / (available.length * 10);
      if (score < bestScore) { bestScore = score; bestIndex = candidateIndex; }
    });

    const [chosen] = available.splice(bestIndex, 1);
    result.push(chosen!);
  }
  return result;
}

export const SHARED_FRONTEND_ASSETS: SharedFrontendAssets = Object.freeze({
  horsePlaceholders: HORSE_PLACEHOLDER_PHOTOS,
  horsePlaceholderFor,
  horsePlaceholderBatch,
  horsePlaceholderManifestUrl: "/assets/horses/placeholders/manifest.json",
});
