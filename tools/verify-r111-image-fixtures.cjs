'use strict';
/** Independent decoder verification of the production container sanitizer.
 * Requires Python + Pillow with JPEG/PNG/GIF/WebP/AVIF codecs. Never reaches
 * the network. Writes only derived fixture bytes and a JSON evidence file. */
require('./lib/register-typescript.cjs');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { sanitizeImage } = require('../src/api/modules/mediaImageHygiene.ts');
const root = path.resolve(__dirname, '..');
const fixtureData = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/media-r111/images.json'), 'utf8'));
const fixture = name => new Uint8Array(Buffer.from(fixtureData.images[name].base64, 'base64'));
const out = path.resolve(process.argv[2] || path.join(root, 'review-r111/evidence/media-decoder'));
fs.mkdirSync(out, { recursive: true });
const source = path.join(out, 'originals');
fs.mkdirSync(source, { recursive: true });
const formats = {
  'metadata.jpg': 'image/jpeg', 'progressive-metadata.jpg': 'image/jpeg',
  'metadata.png': 'image/png', 'metadata.gif': 'image/gif', 'animated-metadata.gif': 'image/gif',
  'metadata.webp': 'image/webp', 'lossless-metadata.webp': 'image/webp', 'animated-metadata.webp': 'image/webp',
};
const entries = [];
for (const [name, mime] of Object.entries(formats)) {
  const bytes = fixture(name);
  fs.writeFileSync(path.join(source, name), bytes);
  const started = performance.now();
  const clean = sanitizeImage(bytes, mime);
  const elapsedMs = performance.now() - started;
  assert.equal(clean.stripped, true);
  assert.equal(Buffer.from(clean.bytes).includes(Buffer.from('SYNTHETIC-')), false);
  const output = path.join(out, name);
  fs.writeFileSync(output, clean.bytes);
  entries.push({ name, mime, original: path.join(source, name), sanitized: output, inputBytes: bytes.length, outputBytes: clean.bytes.length, elapsedMs });
}
assert.throws(() => sanitizeImage(fixture('metadata.avif'), 'image/avif'), /Convert AVIF/);
const python = String.raw`
import json,sys
from PIL import Image
entries=json.load(sys.stdin)
for row in entries:
 with Image.open(row['original']) as before, Image.open(row['sanitized']) as after:
  assert before.size == after.size == (3,3), row['name']
  assert getattr(before,'n_frames',1)==getattr(after,'n_frames',1), row['name']
  for index in range(getattr(after,'n_frames',1)):
   before.seek(index); after.seek(index)
   before.load(); after.load()
   assert before.convert('RGBA').tobytes()==after.convert('RGBA').tobytes(), (row['name'],index,'pixels changed')
   assert not after.getexif(), (row['name'],'EXIF remains')
   for key in ('exif','xmp','comment','XML:com.adobe.xmp','Owner'):
    assert key not in after.info, (row['name'],key)
  row['decoded_frames']=getattr(after,'n_frames',1)
  row['pixels_preserved']=True
  row['metadata_removed']=True
json.dump(entries,sys.stdout,indent=2)
`;
const result = cp.spawnSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python', ['-c', python], { input: JSON.stringify(entries), encoding: 'utf8' });
if (result.error || result.status !== 0) throw new Error(result.stderr || String(result.error));
const verified = JSON.parse(result.stdout);
const report = { status: 'passed', supported_format_cases: verified.length, avif: 'explicitly_rejected_pending_safe_sanitizer', decoder: 'Pillow', cases: verified };
fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, cases: verified.length, report: path.join(out, 'verification.json') }));
