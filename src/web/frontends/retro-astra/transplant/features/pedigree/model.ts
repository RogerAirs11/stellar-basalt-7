import type { Horse } from '../../data/horses';

export type ParentSide = 'sire' | 'dam';
export type PedigreeView = 'classic' | 'vertical' | 'fan' | 'register';
export interface AncestorNode {
  key: string;
  slot: number;
  horse?: Horse;
  depth: number;
  index: number;
  parentKey?: string;
  side: 'root' | ParentSide;
  path: ParentSide[];
}
export interface Ancestry {
  nodes: AncestorNode[];
  generations: number;
  known: number;
  total: number;
  occurrences: Record<string, number>;
}
export interface PositionedAncestor extends AncestorNode { x: number; y: number }
export interface TreeLayout {
  nodes: PositionedAncestor[];
  width: number;
  height: number;
  nodeWidth: number;
  nodeHeight: number;
  vertical: boolean;
}

/** Slots identify positions, not horses: shared ancestors must appear in each branch. */
export function buildAncestry(horses: readonly Horse[], rootId: string, generations: number): Ancestry {
  const lookup = new Map(horses.map(horse => [horse.id, horse]));
  const nodes: AncestorNode[] = [];
  const occurrences: Record<string, number> = {};
  const depthLimit = Number.isFinite(generations) ? Math.max(1, Math.min(4, Math.floor(generations))) : 3;
  const visit = (id: string | undefined, depth: number, index: number, slot: number, path: ParentSide[], parentKey?: string) => {
    const horse = id ? lookup.get(id) : undefined;
    const key = String(slot);
    nodes.push({ key, slot, horse, depth, index, parentKey, side: path[path.length - 1] ?? 'root', path });
    if (horse && depth > 0) occurrences[horse.id] = (occurrences[horse.id] ?? 0) + 1;
    if (depth < depthLimit) {
      visit(horse?.sireId, depth + 1, index * 2, slot * 2, [...path, 'sire'], key);
      visit(horse?.damId, depth + 1, index * 2 + 1, slot * 2 + 1, [...path, 'dam'], key);
    }
  };
  visit(rootId, 0, 0, 1, []);
  return { nodes, generations: depthLimit, occurrences, known: nodes.filter(node => node.depth > 0 && node.horse).length, total: nodes.length - 1 };
}

export function layoutTree(ancestry: Ancestry, vertical: boolean, rtl: boolean): TreeLayout {
  const nodeWidth = vertical ? 174 : 196, nodeHeight = 59;
  const padding = 22, columnStep = nodeWidth + 37;
  const breadth = 2 ** ancestry.generations;
  const width = vertical ? breadth * (nodeWidth + 15) + padding * 2 : padding * 2 + nodeWidth + ancestry.generations * columnStep;
  const height = vertical ? 74 + (ancestry.generations + 1) * 115 : 42 + breadth * 76;
  const nodes = ancestry.nodes.map(node => {
    let x: number, y: number;
    if (vertical) {
      x = padding + (node.index + 0.5) * ((width - padding * 2) / 2 ** node.depth) - nodeWidth / 2;
      y = 30 + (ancestry.generations - node.depth) * 115;
      if (rtl) x = width - x - nodeWidth;
    } else {
      x = padding + node.depth * columnStep;
      if (rtl) x = width - x - nodeWidth;
      y = 40 + (node.index + 0.5) * ((height - 48) / 2 ** node.depth) - nodeHeight / 2;
    }
    return { ...node, x, y };
  });
  return { nodes, width, height, nodeWidth, nodeHeight, vertical };
}

export function connectorPath(node: PositionedAncestor, parent: PositionedAncestor, layout: TreeLayout, rtl: boolean): string {
  if (layout.vertical) {
    const x1 = parent.x + layout.nodeWidth / 2, y1 = parent.y;
    const x2 = node.x + layout.nodeWidth / 2, y2 = node.y + layout.nodeHeight;
    const mid = (y1 + y2) / 2;
    return `M ${x1} ${y1} V ${mid} H ${x2} V ${y2}`;
  }
  const x1 = parent.x + (rtl ? 0 : layout.nodeWidth), y1 = parent.y + layout.nodeHeight / 2;
  const x2 = node.x + (rtl ? layout.nodeWidth : 0), y2 = node.y + layout.nodeHeight / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`;
}

export function fanSegment(inner: number, outer: number, start: number, end: number): string {
  const point = (radius: number, angle: number) => `${500 + radius * Math.cos(angle)} ${490 + radius * Math.sin(angle)}`;
  return `M ${point(inner, start)} L ${point(outer, start)} A ${outer} ${outer} 0 0 1 ${point(outer, end)} L ${point(inner, end)} A ${inner} ${inner} 0 0 0 ${point(inner, start)} Z`;
}