import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { SexBadge } from '../../components/ui';
import type { Ancestry } from './model';

export function GenerationRegister({ ancestry, selectedId, highlight, onSelect }: { ancestry: Ancestry; selectedId: string; highlight: boolean; onSelect: (id: string) => void }) {
  const { t, text, n } = usePreferences();
  const [expanded, setExpanded] = useState<number[]>([0, 1, 2]);
  return <div className="generation-register">{Array.from({ length: ancestry.generations + 1 }, (_, depth) => {
    const nodes = ancestry.nodes.filter(node => node.depth === depth);
    return <details className="generation-group" key={depth} open={expanded.includes(depth)} onToggle={event => { const open = event.currentTarget.open; setExpanded(previous => open ? previous.includes(depth) ? previous : [...previous, depth] : previous.filter(value => value !== depth)); }}>
      <summary><ChevronDown size={15}/><strong>{depth === 0 ? t('subject') : t('generation', { count: depth })}</strong><span>{t('ancestorsRecorded', { known: nodes.filter(node => node.horse).length, total: nodes.length })}</span></summary>
      <div className="generation-group-records">{nodes.map(node => <button key={node.key} className={`generation-record ${selectedId === node.horse?.id ? 'is-selected' : ''} ${!node.horse ? 'is-unknown' : ''} ${highlight && node.horse && ancestry.occurrences[node.horse.id] > 1 ? 'is-shared' : ''}`} disabled={!node.horse} onClick={() => node.horse && onSelect(node.horse.id)} aria-pressed={Boolean(node.horse && selectedId === node.horse.id)}>
        <span className="ancestor-slot">{n(node.slot, { minimumIntegerDigits: 2 })}</span><span className="generation-record-copy"><small>{node.path.length ? node.path.map(side => t(side)).join(' / ') : t('subject')}</small><strong>{node.horse ? text(node.horse.name) : t('noData')}</strong><span>{node.horse ? `${n(node.horse.year, { useGrouping: false })} / ${text(node.horse.coat)}` : t('unknownAncestor')}</span></span>{node.horse && <SexBadge sex={node.horse.sex} recordedSex={node.horse.recordedSex} abbreviated/>}<ChevronRight size={14}/>
      </button>)}</div>
    </details>;
  })}</div>;
}