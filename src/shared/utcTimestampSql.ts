/**
 * Strict portable SQL equivalent of parseUtcTimestamp, returning epoch ms.
 *
 * Do not cast unvalidated legacy text to a database timestamp: SQLite may
 * normalize an impossible day and PostgreSQL may throw for the whole query.
 * This bounded scalar expression validates text/calendar parts and computes
 * a proleptic Gregorian day number using integer arithmetic on both engines.
 * Fractions are truncated to milliseconds, as JavaScript Date.parse does.
 * Input is a trusted column name, never user-supplied SQL or a value literal.
 */
export function utcTimestampMillisSql(column: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(column)) throw new Error("Expected a timestamp column identifier");
  const trim = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  const digits = (value: string) => Array.from({ length: 10 }, (_, n) => String(n))
    .reduce((sql, digit) => `REPLACE(${sql},'${digit}','')`, value) + "=''";
  const dateDigits = "SUBSTR(body,1,4)||SUBSTR(body,6,2)||SUBSTR(body,9,2)";
  const timeDigits = "SUBSTR(body,12,2)||SUBSTR(body,15,2)||SUBSTR(body,18,2)||SUBSTR(body,21)";
  const numeric = (expression: string) => `CASE WHEN shape_ok THEN CAST(${expression} AS BIGINT) ELSE 0 END`;
  return `(WITH
    _ut_stamp AS (SELECT LTRIM(RTRIM(${column},'${trim}'),'${trim}') AS stamp),
    _ut_zone AS (SELECT stamp,CASE WHEN SUBSTR(stamp,LENGTH(stamp),1)='Z' THEN 1
      WHEN LENGTH(stamp)>=25 AND SUBSTR(stamp,LENGTH(stamp)-5,1) IN ('+','-') THEN 6 ELSE 0 END AS zone_length FROM _ut_stamp),
    _ut_body AS (SELECT SUBSTR(stamp,1,LENGTH(stamp)-zone_length) AS body,
      CASE WHEN zone_length=0 THEN '' ELSE SUBSTR(stamp,LENGTH(stamp)-zone_length+1) END AS zone,
      zone_length FROM _ut_zone),
    _ut_shape AS (SELECT body,zone,zone_length,
      (SUBSTR(body,5,1)='-' AND SUBSTR(body,8,1)='-' AND ${digits(dateDigits)}
        AND ((LENGTH(body)=10 AND zone_length=0) OR
          ((LENGTH(body)=19 OR (LENGTH(body) BETWEEN 21 AND 29 AND SUBSTR(body,20,1)='.'))
            AND SUBSTR(body,11,1) IN ('T',' ') AND SUBSTR(body,14,1)=':' AND SUBSTR(body,17,1)=':'
            AND ${digits(timeDigits)}))
        AND (zone_length=0 OR zone='Z' OR (zone_length=6 AND SUBSTR(zone,4,1)=':'
          AND ${digits("SUBSTR(zone,2,2)||SUBSTR(zone,5,2)")}))) AS shape_ok FROM _ut_body),
    _ut_parts AS (SELECT shape_ok,
      ${numeric("SUBSTR(body,1,4)")} AS y,${numeric("SUBSTR(body,6,2)")} AS m,${numeric("SUBSTR(body,9,2)")} AS d,
      ${numeric("CASE WHEN LENGTH(body)=10 THEN '0' ELSE SUBSTR(body,12,2) END")} AS h,
      ${numeric("CASE WHEN LENGTH(body)=10 THEN '0' ELSE SUBSTR(body,15,2) END")} AS mi,
      ${numeric("CASE WHEN LENGTH(body)=10 THEN '0' ELSE SUBSTR(body,18,2) END")} AS s,
      ${numeric("SUBSTR(SUBSTR(body,21)||'000',1,3)")} AS ms,
      ${numeric("CASE WHEN zone_length=6 THEN SUBSTR(zone,2,2) ELSE '0' END")} AS zh,
      ${numeric("CASE WHEN zone_length=6 THEN SUBSTR(zone,5,2) ELSE '0' END")} AS zm,
      CASE WHEN SUBSTR(zone,1,1)='-' THEN -1 ELSE 1 END AS zs FROM _ut_shape),
    _ut_adjusted AS (SELECT *,y-CASE WHEN m<=2 THEN 1 ELSE 0 END AS ay FROM _ut_parts),
    _ut_era AS (SELECT *,CASE WHEN ay>=0 THEN ay ELSE ay-399 END/400 AS era FROM _ut_adjusted),
    _ut_year AS (SELECT *,ay-era*400 AS ey FROM _ut_era)
    SELECT CASE WHEN shape_ok AND m BETWEEN 1 AND 12 AND d BETWEEN 1 AND
      CASE WHEN m=2 THEN CASE WHEN y%400=0 OR (y%4=0 AND y%100<>0) THEN 29 ELSE 28 END
        WHEN m IN (4,6,9,11) THEN 30 ELSE 31 END
      AND h<=23 AND mi<=59 AND s<=59 AND zh<=23 AND zm<=59
    THEN (era*146097+ey*365+ey/4-ey/100+(153*(m+CASE WHEN m>2 THEN -3 ELSE 9 END)+2)/5+d-1-719468)*86400000
      +(h*3600+mi*60+s)*1000+ms-zs*(zh*60+zm)*60000
    ELSE NULL END FROM _ut_year)`;
}
