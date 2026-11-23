/** Parse the database's UTC text convention, independent of browser/server TZ.
 * Explicit ISO offsets are honored; SQL and offset-less ISO timestamps are UTC.
 * Reject calendar rollover rather than normalizing an invalid date silently. */
export function parseUtcTimestamp(value: unknown): number | null {
  if(typeof value!=="string")return null;
  const match=/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value.trim());
  if(!match)return null;
  const [,yy,mm,dd,hh="00",mi="00",ss="00",fraction="",zone="Z"]=match;
  const y=Number(yy),m=Number(mm),d=Number(dd),h=Number(hh),minute=Number(mi),second=Number(ss);
  const day=new Date(0);day.setUTCFullYear(y,m-1,d);day.setUTCHours(0,0,0,0);
  if(day.getUTCFullYear()!==y||day.getUTCMonth()!==m-1||day.getUTCDate()!==d||h>23||minute>59||second>59)return null;
  const parsed=Date.parse(`${yy}-${mm}-${dd}T${hh}:${mi}:${ss}${fraction}${zone}`);
  return Number.isFinite(parsed)?parsed:null;
}
