/**
 * R65: the canonical shared store now lives in the public frontend-kit
 * (external frontends may import only their own files or the kit root).
 * This module remains the CORE-side import path — a pure re-export — so
 * main.tsx / AppearanceStudio keep their historical import specifiers.
 */
export { readVisualEncoding, writeVisualEncoding, onVisualEncodingChange } from "../frontend-kit/registryVisualEncoding";
