import { readFileSync } from "node:fs";
import { join } from "node:path";

// Source-only packages preserve this canonical JSON. Unit tests need neither
// Pillow nor restored binary assets; every call gets independent mutable bytes.
const fixtureData = JSON.parse(readFileSync(join(__dirname, "../fixtures/media-r111/images.json"), "utf8")) as {
  images: Record<string, { base64: string; mime_type: string }>;
};
export function mediaFixture(name: string): Uint8Array {
  const entry = fixtureData.images[name];
  if (!entry) throw new Error(`Unknown fictional media fixture: ${name}`);
  return new Uint8Array(Buffer.from(entry.base64, "base64"));
}
