import { readFileSync } from "node:fs";
const all = JSON.parse(readFileSync('scripts/t33-asbdavani-photos.json', 'utf8'));
// Persian race-report posts (photo_* names are usually Telegram race photos)
const racePhotos = all.filter(r => r.img.includes('photo_20'));
console.log('photo_2026-* race photos:', racePhotos.length);
for (const r of racePhotos.slice(0, 5)) console.log(' ', r.title.slice(0, 60), '<-', r.img.split('/').pop());
