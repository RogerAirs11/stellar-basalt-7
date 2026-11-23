#!/usr/bin/env node
/**
 * audit-breeding-dates — R88 agent plan P08: READ-ONLY anomaly report of
 * reproduction/calendar semantics in breeding_records.
 *
 * Anomaly classes reported:
 *   1. season_not_solar_hijri   — season outside 1380-1500 (e.g. a Gregorian
 *                                 year like 2019 stored before the rule existed)
 *   2. season_missing           — covering_date present but season NULL
 *   3. no_temporal_anchor       — both covering_date and season NULL
 *   4. covering_date_invalid    — YYYY-MM-DD shape but a calendar-invalid day
 *                                 (Feb 30, month 13, non-leap Feb 29, ...)
 *   5. season_date_mismatch     — Solar Hijri year of covering_date != season
 *   6. covering_before_parent_birth — covering date definitively before the
 *                                 sire's or dam's typed birth date
 *   7. foal_birth_before_covering  — foal's typed birth date before the covering
 *   8. implausible_gestation    — foal born < 280 or > 400 days after covering
 *
 * READ-ONLY BY CONSTRUCTION: this tool executes only SELECT statements and has
 * no apply mode. Corrections are a HUMAN workflow through
 * POST /api/admin/breeding/:id/correct (reason required, audit_events row with
 * the old values). Stored seasons are never mass-converted (P08 rollback rule).
 *
 * The Solar Hijri conversion below is the same standard break-table algorithm
 * (Borkowski/Kamali jalaali) used by src/registry/dates.ts, inlined because
 * this tool runs on plain Node against the Supabase canonical database.
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node tools/audit-breeding-dates.mjs [--json]
 *
 * Exit codes: 0 = report produced; 2 = configuration error; 3 = query failure.
 */
import postgres from "postgres";

const json = process.argv.includes("--json");
const url = process.supabase ?? process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL (canonical registry source). This tool is read-only.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

// --- jalaali (Solar Hijri) conversion, same math as src/registry/dates.ts ---
const div = (a, b) => ~~(a / b);
const mod = (a, b) => a - ~~(a / b) * b;
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
function jalCal(jy) {
  let leapJ = -14, jp = BREAKS[0], jump = 0;
  for (let i = 1; i < BREAKS.length; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const gy = jy + 621;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}
function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}
function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}
function toSolarHijri(gy, gm, gd) {
  const jdn = g2d(gy, gm, gd);
  let jy = d2g(jdn).gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(r.gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}
function isGregorianLeap(gy) { return (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0; }
const G_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function gregorianDaysInMonth(gy, gm) { return gm === 2 && isGregorianLeap(gy) ? 29 : G_DAYS[gm - 1]; }
function isRealGregorianDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12) return false;
  return d >= 1 && d <= gregorianDaysInMonth(y, mo);
}
function daysBetween(a, b) { // ISO day strings -> whole days (b - a)
  const toJdn = (v) => { const [y, m, d] = v.split("-").map(Number); return g2d(y, m, d); };
  return toJdn(b) - toJdn(a);
}

// --- typed birth date -> honest Gregorian year interval (never Jan 1) ---
function typedBirthInterval(horse) {
  if (!horse || !horse.birth_date_value) return null;
  const [y, m, d] = String(horse.birth_date_value).split("-").map(Number);
  const calendar = horse.birth_date_calendar ?? "gregorian";
  const sh = calendar === "solar_hijri";
  if (sh) {
    // convert SH boundaries to Gregorian
    const toG = (jy, jm, jd) => { const r = jalCal(jy); return d2g(g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1); };
    if (horse.birth_date_precision === "year") { const a = toG(y, 1, 1), b = toG(y, 12, jalCal(y).leap === 0 ? 30 : 29); return { start: `${a.gy}-${String(a.gm).padStart(2, "0")}-${String(a.gd).padStart(2, "0")}`, end: `${b.gy}-${String(b.gm).padStart(2, "0")}-${String(b.gd).padStart(2, "0")}`, precision: "year" }; }
    if (horse.birth_date_precision === "month") { const last = m <= 6 ? 31 : m <= 11 ? 30 : (jalCal(y).leap === 0 ? 30 : 29); const a = toG(y, m, 1), b = toG(y, m, last); return { start: `${a.gy}-${String(a.gm).padStart(2, "0")}-${String(a.gd).padStart(2, "0")}`, end: `${b.gy}-${String(b.gm).padStart(2, "0")}-${String(b.gd).padStart(2, "0")}`, precision: "month" }; }
    const a = toG(y, m, d); return { start: `${a.gy}-${String(a.gm).padStart(2, "0")}-${String(a.gd).padStart(2, "0")}`, end: `${a.gy}-${String(a.gm).padStart(2, "0")}-${String(a.gd).padStart(2, "0")}`, precision: "day" };
  }
  if (horse.birth_date_precision === "year") return { start: `${y}-01-01`, end: `${y}-12-31`, precision: "year" };
  if (horse.birth_date_precision === "month") { const last = gregorianDaysInMonth(y, m); return { start: `${y}-${String(m).padStart(2, "0")}-01`, end: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`, precision: "month" }; }
  return { start: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, end: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, precision: "day" };
}

const anomalies = [];

function report(row, code, detail) {
  anomalies.push({ record_id: row.id, sire_id: row.sire_id, dam_id: row.dam_id, foal_id: row.foal_id, code, detail, covering_date: row.covering_date, season: row.season });
}

try {
  const rows = await sql`
    SELECT b.id, b.sire_id, b.dam_id, b.foal_id, b.covering_date, b.season, b.provenance,
           s.birth_date_value AS sire_birth_value, s.birth_date_precision AS sire_birth_precision, s.birth_date_calendar AS sire_birth_calendar,
           d.birth_date_value AS dam_birth_value, d.birth_date_precision AS dam_birth_precision, d.birth_date_calendar AS dam_birth_calendar,
           f.birth_date_value AS foal_birth_value, f.birth_date_precision AS foal_birth_precision, f.birth_date_calendar AS foal_birth_calendar
    FROM breeding_records b
    LEFT JOIN horses s ON s.id = b.sire_id
    LEFT JOIN horses d ON d.id = b.dam_id
    LEFT JOIN horses f ON f.id = b.foal_id
    ORDER BY b.id
  `;

  for (const row of rows) {
    // 1. Gregorian-looking / out-of-range seasons
    if (row.season != null && (!Number.isInteger(row.season) || row.season < 1380 || row.season > 1500)) {
      report(row, "season_not_solar_hijri", `season=${row.season} is outside the Solar Hijri range 1380-1500 (looks Gregorian); correct it through the reviewed correction endpoint`);
    }
    // 2./3. missing temporal anchors
    if (row.season == null && row.covering_date != null) {
      report(row, "season_missing", "covering_date present but season NULL — derive the Solar Hijri season via a reviewed correction");
    }
    if (row.season == null && row.covering_date == null) {
      report(row, "no_temporal_anchor", "neither covering_date nor season recorded");
    }
    // 4. calendar-invalid days
    if (row.covering_date != null && !isRealGregorianDay(row.covering_date)) {
      report(row, "covering_date_invalid", `covering_date=${row.covering_date} is not a real Gregorian day (e.g. Feb 30, month 13, non-leap Feb 29)`);
    }
    // 5. date/season mismatch
    if (row.covering_date != null && isRealGregorianDay(row.covering_date) && row.season != null && row.season >= 1380 && row.season <= 1500) {
      const [gy, gm, gd] = row.covering_date.split("-").map(Number);
      const derived = toSolarHijri(gy, gm, gd).jy;
      if (derived !== row.season) {
        report(row, "season_date_mismatch", `covering_date=${row.covering_date} is Solar Hijri ${derived} but season=${row.season}`);
      }
    }
    // 6. covering before a parent's birth (definite: covering before the parent's earliest possible birth day)
    if (row.covering_date != null && isRealGregorianDay(row.covering_date)) {
      for (const [label, value, precision, calendar] of [
        ["sire", row.sire_birth_value, row.sire_birth_precision, row.sire_birth_calendar],
        ["dam", row.dam_birth_value, row.dam_birth_precision, row.dam_birth_calendar],
      ]) {
        const interval = typedBirthInterval({ birth_date_value: value, birth_date_precision: precision, birth_date_calendar: calendar });
        if (interval && daysBetween(interval.start, row.covering_date) < 0) {
          report(row, "covering_before_parent_birth", `covering_date=${row.covering_date} is before the ${label}'s recorded birth interval start ${interval.start} (${interval.precision} precision)`);
        }
      }
      // 7./8. foal ordering + gestation plausibility (day-precision only)
      const foalInterval = typedBirthInterval({ birth_date_value: row.foal_birth_value, birth_date_precision: row.foal_birth_precision, birth_date_calendar: row.foal_birth_calendar });
      if (foalInterval && foalInterval.precision === "day") {
        const gestation = daysBetween(row.covering_date, foalInterval.start);
        if (gestation < 0) {
          report(row, "foal_birth_before_covering", `foal birth ${foalInterval.start} is ${-gestation} day(s) BEFORE covering_date=${row.covering_date}`);
        } else if (gestation < 280 || gestation > 400) {
          report(row, "implausible_gestation", `foal birth ${foalInterval.start} is ${gestation} days after covering_date=${row.covering_date} (plausible equine gestation is ~280-400 days)`);
        }
      }
    }
  }

  if (json) {
    console.log(JSON.stringify({ generated_at: new Date().toISOString(), breeding_records_scanned: rows.length, anomaly_count: anomalies.length, anomalies }, null, 2));
  } else {
    console.log(`audit-breeding-dates — READ-ONLY anomaly report (P08)`);
    console.log(`Scanned ${rows.length} breeding records. Found ${anomalies.length} anomalies.\n`);
    const byCode = {};
    for (const a of anomalies) byCode[a.code] = (byCode[a.code] ?? 0) + 1;
    for (const [code, count] of Object.entries(byCode)) console.log(`  ${count.toString().padStart(5)}  ${code}`);
    if (anomalies.length) {
      console.log(`\nSample rows (first 20):`);
      for (const a of anomalies.slice(0, 20)) console.log(`  #${a.record_id} [${a.code}] ${a.detail}`);
      console.log(`\nCorrections are a HUMAN review workflow:`);
      console.log(`  POST /api/admin/breeding/:id/correct  { covering_date?, season?, reason }`);
      console.log(`  (reason required; old values preserved in audit_events; never mass-converted).`);
      console.log(`This tool executed only SELECT statements — it cannot write.`);
    }
  }
  await sql.end({ timeout: 5 });
  process.exit(0);
} catch (error) {
  console.error(`Query failure: ${error instanceof Error ? error.message : String(error)}`);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(3);
}
