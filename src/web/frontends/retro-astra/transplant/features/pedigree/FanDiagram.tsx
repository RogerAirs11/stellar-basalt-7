import { usePreferences } from '../../preferences/PreferencesProvider';
import { fanSegment, type Ancestry } from './model';

export function FanDiagram({ ancestry, selectedId, highlight, onSelect }: { ancestry: Ancestry; selectedId: string; highlight: boolean; onSelect: (id: string) => void }) {
  const { t, text, n, rtl } = usePreferences();
  const root = ancestry.nodes[0].horse!;
  const rootName = text(root.name);
  const rootLabel = rootName.length > 22 ? `${rootName.slice(0, 21)}…` : rootName;
  const ring = 364 / ancestry.generations;
  return <svg className="fan-diagram" width="1000" height="605" viewBox="0 0 1000 605" aria-label={t('treeFan')}>
    {ancestry.nodes.filter(node => node.depth > 0).map(node => {
      const parts = 2 ** node.depth, slot = rtl ? parts - 1 - node.index : node.index;
      const start = -Math.PI + slot / parts * Math.PI + 0.003, end = -Math.PI + (slot + 1) / parts * Math.PI - 0.003;
      const inner = 89 + (node.depth - 1) * ring, outer = inner + ring - 3;
      const middle = (start + end) / 2, radius = (inner + outer) / 2;
      const x = 500 + radius * Math.cos(middle), y = 490 + radius * Math.sin(middle);
      // R117-29: structural side only — the recorded parent relationship
      // (father_id/mother_id path from the pedigree model), never the donor
      // sex icon. A dam-slot mother with an unknown recorded sex is still a dam.
      const side = node.side;
      const shared = Boolean(node.horse && highlight && ancestry.occurrences[node.horse.id] > 1);
      const name = node.horse ? text(node.horse.name) : t('noData');
      const limit = node.depth === 4 ? 13 : 23;
      const label = name.length > limit ? `${name.slice(0, limit - 1)}…` : name;
      const activate = () => { if (node.horse) onSelect(node.horse.id); };
      return <g key={node.key} className={`fan-segment fan-segment--${side} ${!node.horse ? 'is-unknown' : ''} ${selectedId === node.horse?.id ? 'is-selected' : ''} ${shared ? 'is-shared' : ''}`} role={node.horse ? 'button' : undefined} tabIndex={node.horse ? 0 : undefined} aria-label={node.horse ? t('selectAncestor', { name }) : t('unknownAncestor')} aria-pressed={node.horse ? selectedId === node.horse.id : undefined} onClick={activate} onKeyDown={event => { if (node.horse && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); activate(); } }}>
        <title>{name}{node.horse ? ` / ${n(node.horse.year, { useGrouping: false })}` : ''}</title>
        <path d={fanSegment(inner, outer, start, end)}/>
        <g transform={`translate(${x} ${y}) rotate(${middle * 180 / Math.PI + 90})`} pointerEvents="none"><text textAnchor="middle" dy="-3" direction={rtl ? 'rtl' : 'ltr'} className="fan-name">{label}</text><text textAnchor="middle" dy="15" className="fan-year">{node.horse ? n(node.horse.year, { useGrouping: false }) : t(node.side === 'dam' ? 'dam' : 'sire')}</text></g>
      </g>;
    })}
    <g className={`fan-root ${selectedId === root.id ? 'is-selected' : ''}`} role="button" tabIndex={0} aria-label={t('selectAncestor', { name: text(root.name) })} onClick={() => onSelect(root.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(root.id); } }}>
      <title>{rootName}</title><circle cx="500" cy="490" r="83"/>
      <text x="500" y="470" textAnchor="middle" className="fan-root-eyebrow">{t('subject')}</text><text x="500" y="494" textAnchor="middle" className="fan-root-name">{rootLabel}</text><text x="500" y="517" textAnchor="middle" className="fan-root-year">{n(root.year, { useGrouping: false })}</text>
    </g>
  </svg>;
}