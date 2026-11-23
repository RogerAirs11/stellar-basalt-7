import { HttpError } from "../http";

/** Bounded, lossless container rewriting. This is not a malware scanner or a
 * full pixel decoder. Only recognized image/control chunks survive; metadata,
 * unknown extensions and trailing payloads never pass through silently.
 * Specs: developers.google.com/speed/webp/docs/riff_container,
 * w3.org/TR/png-3/, w3.org/Graphics/GIF/spec-gif89a.txt. */
export const SANITIZED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
export const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_IMAGE_SIDE = 12_000;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_BLOCKS = 10_000;
const MAX_ANIMATION_PIXELS = 64_000_000;
const MAX_FRAMES = 100;

export interface SanitizedImage { bytes: Uint8Array; stripped: boolean; width: number | null; height: number | null }
function invalid(message = "The image is incomplete or has an unsupported structure. Export it as JPEG or PNG and try again."): never {
  throw new HttpError(415, "invalid_image_structure", message);
}
function dimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) invalid();
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
    throw new HttpError(413, "image_dimensions_too_large", "Images are limited to 16 million pixels and 12,000 pixels per side.");
  }
}
function ascii(bytes: Uint8Array, offset: number, size: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + size));
}
function join(parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
function u16le(bytes: Uint8Array, offset: number): number { return bytes[offset]! | bytes[offset + 1]! << 8; }
function u24le(bytes: Uint8Array, offset: number): number { return u16le(bytes, offset) | bytes[offset + 2]! << 16; }
function u32le(bytes: Uint8Array, offset: number): number { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true); }

export function sanitizeImage(bytes: Uint8Array, mime: string): SanitizedImage {
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, "media_too_large", "Files are limited to 3 MB.");
  if (mime === "application/pdf") return { bytes, stripped: false, width: null, height: null };
  if (mime === "image/jpeg") return sanitizeJpeg(bytes);
  if (mime === "image/png") return sanitizePng(bytes);
  if (mime === "image/gif") return sanitizeGif(bytes);
  if (mime === "image/webp") return sanitizeWebp(bytes);
  throw new HttpError(415, "unsupported_media_type", "This image format cannot be safely processed here yet. Convert AVIF or other images to JPEG, PNG or WebP before uploading.");
}

function sanitizeJpeg(bytes: Uint8Array): SanitizedImage {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) invalid();
  const parts = [bytes.subarray(0, 2)];
  let offset = 2, blocks = 0, width = 0, height = 0, scans = 0, stripped = false;
  while (offset < bytes.length && ++blocks <= MAX_BLOCKS) {
    const start = offset;
    if (bytes[offset++] !== 255) invalid();
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!width || !scans || bytes.length - offset > 16 || bytes.subarray(offset).some((b) => b !== 0 && b !== 255)) invalid();
      parts.push(Uint8Array.of(255, 217));
      return { bytes: join(parts), stripped: stripped || offset !== bytes.length, width, height };
    }
    if (marker == null || marker === 0 || marker === 0xd8 || marker === 1 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) invalid();
    const length = bytes[offset]! << 8 | bytes[offset + 1]!;
    const payload = offset + 2, end = offset + length;
    if (length < 2 || end > bytes.length) invalid();
    const metadata = marker >= 0xe0 && marker <= 0xef || marker === 0xfe;
    // Reserved/JPEG-extension markers can carry arbitrary non-pixel data.
    // Support only the coding and restart-control markers used by the
    // accepted baseline/extended sequential/progressive Huffman families.
    if (!metadata && ![0xc0, 0xc1, 0xc2, 0xc4, 0xdb, 0xdd, 0xda].includes(marker)) invalid();
    if (marker === 0xdd && length !== 4) invalid();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (width || length < 11 || bytes[payload] !== 8 || ![1, 3, 4].includes(bytes[payload + 5]!)) invalid();
      if (length !== 8 + 3 * bytes[payload + 5]!) invalid();
      height = bytes[payload + 1]! << 8 | bytes[payload + 2]!;
      width = bytes[payload + 3]! << 8 | bytes[payload + 4]!;
      dimensions(width, height);
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) invalid();
    // All APP and comment payloads may contain user metadata. Preserve only
    // Adobe's fixed-size colour-transform marker, which contains no text slots.
    const colourTransform = marker === 0xee && length === 14 && ascii(bytes, payload, 5) === "Adobe";
    if (metadata && !colourTransform) stripped = true;
    else parts.push(bytes.subarray(start, end));
    offset = end;
    if (marker === 0xda) {
      if (!width || length < 6 || ++scans > MAX_FRAMES) invalid();
      const entropyStart = offset;
      for (;;) {
        if (offset >= bytes.length - 1) invalid();
        if (bytes[offset] !== 255) { offset++; continue; }
        let next = offset + 1;
        while (bytes[next] === 255) next++;
        const code = bytes[next];
        if (code === 0 || (code != null && code >= 0xd0 && code <= 0xd7)) { offset = next + 1; continue; }
        break;
      }
      parts.push(bytes.subarray(entropyStart, offset));
    }
  }
  return invalid();
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let c = value;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 255]! ^ c >>> 8;
  return (c ^ 0xffffffff) >>> 0;
}
function sanitizePng(bytes: Uint8Array): SanitizedImage {
  if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [bytes.subarray(0, 8)];
  let offset = 8, blocks = 0, width = 0, height = 0, stripped = false, imageBytes = 0, colour = -1, palette = false;
  while (offset + 12 <= bytes.length && ++blocks <= MAX_BLOCKS) {
    const length = view.getUint32(offset), end = offset + 12 + length;
    if (end > bytes.length) invalid();
    const type = ascii(bytes, offset + 4, 4), data = offset + 8;
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) invalid();
    if (offset === 8 && type !== "IHDR") invalid();
    if (type === "IHDR") {
      if (width || length !== 13) invalid();
      width = view.getUint32(data); height = view.getUint32(data + 4); dimensions(width, height);
      colour = bytes[data + 9]!;
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[colour]?.includes(bytes[data + 8]!) || bytes[data + 10] !== 0 || bytes[data + 11] !== 0 || ![0, 1].includes(bytes[data + 12]!)) invalid();
    } else if (type === "PLTE") {
      if (palette || imageBytes || length < 3 || length > 768 || length % 3) invalid();
      palette = true;
    } else if (type === "IDAT") {
      if (colour === 3 && !palette) invalid();
      imageBytes += length;
    } else if (type === "IEND") {
      if (length || !imageBytes || end !== bytes.length) invalid();
      parts.push(bytes.subarray(offset, end));
      return { bytes: join(parts), stripped, width, height };
    } else if (type[0] === type[0]!.toUpperCase()) invalid();
    const safeAncillary = (type === "tRNS" && !imageBytes && length <= 256)
      || (type === "sRGB" && length === 1 && bytes[data]! <= 3)
      || (type === "gAMA" && length === 4) || (type === "cHRM" && length === 32);
    if (["IHDR", "PLTE", "IDAT"].includes(type) || safeAncillary) parts.push(bytes.subarray(offset, end));
    else stripped = true; // includes eXIf, XMP/text, ICC profiles, unknown chunks and APNG extra frames
    offset = end;
  }
  return invalid();
}

function sanitizeGif(bytes: Uint8Array): SanitizedImage {
  if (bytes.length < 14 || !["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) invalid();
  const width = u16le(bytes, 6), height = u16le(bytes, 8); dimensions(width, height);
  let offset = 13 + ((bytes[10]! & 0x80) ? 3 * (1 << ((bytes[10]! & 7) + 1)) : 0);
  if (offset >= bytes.length) invalid();
  const parts = [bytes.subarray(0, offset)];
  let blocks = 0, frames = 0, pixels = 0, stripped = false;
  const subBlocksEnd = (start: number): number => {
    let i = start;
    while (i < bytes.length && ++blocks <= MAX_BLOCKS) {
      const count = bytes[i++]!;
      if (!count) return i;
      i += count;
      if (i > bytes.length) invalid();
    }
    return invalid();
  };
  while (offset < bytes.length && ++blocks <= MAX_BLOCKS) {
    const start = offset, type = bytes[offset++]!;
    if (type === 0x3b) {
      if (!frames || offset !== bytes.length) invalid();
      parts.push(bytes.subarray(start, offset));
      return { bytes: join(parts), stripped, width, height };
    }
    if (type === 0x21) {
      const label = bytes[offset++];
      if (label == null) invalid();
      const end = subBlocksEnd(offset);
      const graphicsControl = label === 0xf9 && end - start === 8 && bytes[offset] === 4;
      // Only the exact Netscape loop-control payload survives an application block.
      const loopControl = label === 0xff && end - start === 19 && bytes[offset] === 11
        && ascii(bytes, offset + 1, 11) === "NETSCAPE2.0" && bytes[offset + 12] === 3 && bytes[offset + 13] === 1;
      if (label === 0xf9 && !graphicsControl) invalid();
      if (graphicsControl || loopControl) parts.push(bytes.subarray(start, end));
      else stripped = true; // comments, text and application/XMP metadata
      offset = end;
    } else if (type === 0x2c) {
      if (offset + 9 >= bytes.length || ++frames > MAX_FRAMES) invalid();
      const left = u16le(bytes, offset), top = u16le(bytes, offset + 2);
      const frameWidth = u16le(bytes, offset + 4), frameHeight = u16le(bytes, offset + 6);
      dimensions(frameWidth, frameHeight);
      pixels += frameWidth * frameHeight;
      if (left + frameWidth > width || top + frameHeight > height || pixels > MAX_ANIMATION_PIXELS) invalid();
      const flags = bytes[offset + 8]!;
      offset += 9 + ((flags & 0x80) ? 3 * (1 << ((flags & 7) + 1)) : 0);
      if (offset >= bytes.length || bytes[offset]! < 2 || bytes[offset]! > 8) invalid();
      offset = subBlocksEnd(offset + 1);
      parts.push(bytes.subarray(start, offset));
    } else invalid();
  }
  return invalid();
}

function webpChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(8 + data.length + (data.length & 1));
  chunk.set(new TextEncoder().encode(type));
  new DataView(chunk.buffer).setUint32(4, data.length, true);
  chunk.set(data, 8);
  return chunk;
}
function webpDimensions(type: string, data: Uint8Array): { width: number; height: number } {
  let width: number, height: number;
  if (type === "VP8 ") {
    if (data.length < 10 || (data[0]! & 1) || ascii(data, 3, 3) !== "\x9d\x01\x2a") invalid();
    width = u16le(data, 6) & 0x3fff; height = u16le(data, 8) & 0x3fff;
  } else {
    if (data.length < 5 || data[0] !== 0x2f) invalid();
    const bits = u32le(data, 1);
    if (bits >>> 29) invalid();
    width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
  }
  dimensions(width, height);
  return { width, height };
}
function sanitizeWebp(bytes: Uint8Array): SanitizedImage {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP" || u32le(bytes, 4) !== bytes.length - 8) invalid();
  let blocks = 0, stripped = false;
  const readChunks = (data: Uint8Array, start: number): Array<{ type: string; data: Uint8Array }> => {
    const chunks: Array<{ type: string; data: Uint8Array }> = [];
    let offset = start;
    while (offset + 8 <= data.length && ++blocks <= MAX_BLOCKS) {
      const length = u32le(data, offset + 4), end = offset + 8 + length;
      if (end + (length & 1) > data.length || ((length & 1) && data[end] !== 0)) invalid();
      chunks.push({ type: ascii(data, offset, 4), data: data.subarray(offset + 8, end) });
      offset = end + (length & 1);
    }
    if (offset !== data.length) invalid();
    return chunks;
  };
  const chunks = readChunks(bytes, 12), kept: Uint8Array[] = [];
  let width = 0, height = 0, stillCount = 0, frameCount = 0, pixels = 0, animation = false, animationControl = false;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const { type, data } = chunk;
    if (type === "VP8X") {
      if (i !== 0 || data.length !== 10 || (data[0]! & 0xc1) || data[1] || data[2] || data[3]) invalid();
      width = u24le(data, 4) + 1; height = u24le(data, 7) + 1; dimensions(width, height);
      animation = Boolean(data[0]! & 2);
      const clean = data.slice();
      stripped ||= Boolean(clean[0]! & 0x2c);
      clean[0] = clean[0]! & ~0x2c; // clear ICCP, EXIF and XMP feature flags
      kept.push(webpChunk(type, clean));
    } else if (type === "VP8 " || type === "VP8L") {
      if (animation || ++stillCount !== 1) invalid();
      const frame = webpDimensions(type, data);
      if (width && (width !== frame.width || height !== frame.height)) invalid();
      width = frame.width; height = frame.height;
      kept.push(webpChunk(type, data));
    } else if (type === "ALPH") {
      if (animation || !data.length || stillCount) invalid();
      kept.push(webpChunk(type, data));
    } else if (type === "ANIM") {
      if (!animation || animationControl || frameCount || data.length !== 6) invalid();
      animationControl = true; kept.push(webpChunk(type, data));
    } else if (type === "ANMF") {
      if (!animation || !animationControl || data.length < 24 || ++frameCount > MAX_FRAMES) invalid();
      const left = 2 * u24le(data, 0), top = 2 * u24le(data, 3), fw = u24le(data, 6) + 1, fh = u24le(data, 9) + 1;
      dimensions(fw, fh); pixels += fw * fh;
      if (left + fw > width || top + fh > height || pixels > MAX_ANIMATION_PIXELS || (data[15]! & ~3)) invalid();
      const frame = [data.subarray(0, 16)];
      let images = 0;
      for (const nested of readChunks(data, 16)) {
        if (nested.type === "VP8 " || nested.type === "VP8L") {
          const d = webpDimensions(nested.type, nested.data);
          if (++images !== 1 || d.width !== fw || d.height !== fh) invalid();
          frame.push(webpChunk(nested.type, nested.data));
        } else if (nested.type === "ALPH" && !images && nested.data.length) frame.push(webpChunk(nested.type, nested.data));
        else stripped = true;
      }
      if (images !== 1) invalid();
      kept.push(webpChunk(type, join(frame)));
    } else stripped = true; // EXIF, XMP, ICCP and unknown application chunks
  }
  if (!width || (animation ? !frameCount || !animationControl : stillCount !== 1)) invalid();
  const clean = join([bytes.subarray(0, 12), ...kept]);
  new DataView(clean.buffer).setUint32(4, clean.length - 8, true);
  return { bytes: clean, stripped, width, height };
}
