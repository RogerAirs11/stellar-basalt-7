import { esc, attr } from './core.js';

/** One route list renders as a labeled picker or links; the route is the state. */
export function contextNavigation(label, items, active) {
  const chosen = items.some(item => item.id === active) ? active : items[0]?.id;
  return `<div class="classic-page-navigation ${items.length > 4 ? 'classic-page-navigation--many' : ''}" data-context-navigation><label class="classic-context-picker"><span>${esc(label)}</span><select data-context-route aria-label="${attr(label)}">${items.map(item => `<option value="${attr(item.href)}" ${item.id === chosen ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label><nav class="tabs" aria-label="${attr(label)}">${items.map(item => `<a class="tab" href="${attr(item.href)}" ${item.id === chosen ? 'aria-current="page"' : ''}>${esc(item.label)}</a>`).join('')}</nav></div>`;
}
