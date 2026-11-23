import { motion } from 'motion/react';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { HorseMark } from '../../components/ui';
import { connectorPath, type Ancestry, type TreeLayout } from './model';

interface TreeDiagramProps {
  ancestry: Ancestry;
  layout: TreeLayout;
  selectedId: string;
  highlight: boolean;
  onSelect: (id: string) => void;
}

export function TreeDiagram({ ancestry, layout, selectedId, highlight, onSelect }: TreeDiagramProps) {
  const { t, text, n, rtl } = usePreferences();
  const positions = new Map(layout.nodes.map(node => [node.key, node]));
  return <div className="ancestry-tree" style={{ width: layout.width, height: layout.height }}>
    {!layout.vertical && <div className="generation-labels">{Array.from({ length: ancestry.generations + 1 }, (_, depth) => {
      const first = layout.nodes.find(node => node.depth === depth)!;
      return <span key={depth} style={{ left: first.x, width: layout.nodeWidth }}>{depth === 0 ? t('subject') : t('generation', { count: depth })}</span>;
    })}</div>}
    <svg className="tree-connectors" width={layout.width} height={layout.height} aria-hidden="true">{layout.nodes.filter(node => node.parentKey).map(node => <motion.path key={node.key} d={connectorPath(node, positions.get(node.parentKey!)!, layout, rtl)} className={`connector connector--${node.side} ${!node.horse ? 'connector--unknown' : ''}`} fill="none" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: node.depth * 0.04 }}/>)}</svg>
    {layout.nodes.map(node => {
      // R117-29: structural side only — the recorded parent relationship
      // (father_id/mother_id path from the pedigree model), never the donor
      // sex icon. A dam-slot mother with an unknown recorded sex is still a dam.
      const side = node.side;
      const occurrences = node.horse ? ancestry.occurrences[node.horse.id] ?? 0 : 0;
      return <button key={node.key} className={`pedigree-node pedigree-node--${side} ${selectedId === node.horse?.id ? 'is-selected' : ''} ${!node.horse ? 'is-unknown' : ''} ${highlight && occurrences > 1 ? 'is-shared' : ''}`} style={{ left: node.x, top: node.y, width: layout.nodeWidth, height: layout.nodeHeight }} disabled={!node.horse} onClick={() => node.horse && onSelect(node.horse.id)} aria-label={node.horse ? t('selectAncestor', { name: text(node.horse.name) }) : t('unknownAncestor')} aria-pressed={Boolean(node.horse && selectedId === node.horse.id)} title={node.horse ? text(node.horse.name) : t('unknownAncestor')}>
        <span className="pedigree-node-name">{side === 'root' && <HorseMark/>}{node.horse ? text(node.horse.name) : t('noData')}</span>
        <span className="pedigree-node-meta">{node.horse ? `${n(node.horse.year, { useGrouping: false })} / ${text(node.horse.coat)} / ${node.horse.country}` : t(node.side === 'dam' ? 'dam' : 'sire')}</span>
        {highlight && occurrences > 1 && <span className="shared-marker">{n(occurrences)}×</span>}
      </button>;
    })}
  </div>;
}