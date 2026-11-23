#!/usr/bin/env node
/** Execute the production calendar conversion. No duplicate Python calendar. */
import { parseRegistryDate, toSolarHijri } from '../src/registry/dates.ts';
const dates = JSON.parse(process.argv[2] || '[]');
if (!Array.isArray(dates) || dates.length > 100) throw new Error('Expected bounded date list');
const seasons = dates.map(value => {
  const parsed = parseRegistryDate({ value, precision: 'day', calendar: 'gregorian' }, 2200);
  if (!parsed.ok) throw new Error(parsed.message);
  const [year, month, day] = value.split('-').map(Number);
  return toSolarHijri(year, month, day).jy;
});
process.stdout.write(JSON.stringify(seasons));
