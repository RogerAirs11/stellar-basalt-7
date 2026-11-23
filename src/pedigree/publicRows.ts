import { PEDIGREE_HORSE_FIELDS } from '../db/types';

/** Public graph boundaries suppress withheld/deleted parent identifiers as well
 * as their rows. An unavailable parent is missing evidence, never a founder
 * whose hidden pedigree may influence a public prediction. */
export const PUBLIC_PEDIGREE_COLUMNS_H=PEDIGREE_HORSE_FIELDS.map(field=>{
  if(field==='father_id'||field==='mother_id')return `CASE WHEN EXISTS(SELECT 1 FROM horses vp WHERE vp.id=h.${field} AND vp.deleted_at IS NULL AND vp.is_active=1) THEN h.${field} ELSE NULL END AS ${field}`;
  return `h.${field}`;
}).join(',');
