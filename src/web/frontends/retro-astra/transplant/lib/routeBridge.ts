import { parseFrontendLocalRoute, parseHorseDbRoute } from '../../../../../frontend-kit';

/** Canonical host links and Retro's native hash routes refer to the same record. */
export function retroHashForHostRoute(route: string, search = ''): string {
  const canonical = parseHorseDbRoute(route);
  if (canonical.kind === 'browse') return `#/horses${search}`;
  if (canonical.kind === 'horse') return `#/horses/${canonical.id}`;
  if (canonical.kind === 'person') return `#/collections/people?person=${canonical.id}`;
  if (canonical.kind === 'stats') return '#/insights';
  const local = parseFrontendLocalRoute(route);
  if (local?.frontendId === 'retro-astra' && local.path !== '/') return `#${local.path}${search}`;
  return '#/';
}
