import type { PedigreeNode } from "../contracts/platform";

/**
 * Pure pedigree presentation geometry shared by independent frontend engines.
 *
 * This module deliberately contains no DOM/CSS/branding. It normalizes only
 * graph geometry so each frontend can render the same canonical pedigree with
 * its own visual language without reimplementing traversal/positioning logic.
 */
export interface PedigreeLayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  columnGap?: number;
  rowGap?: number;
  paddingX?: number;
  paddingY?: number;
  maxGeneration?: number;
  rtl?: boolean;
}

export interface PedigreeLayoutNode {
  key: string;
  node: PedigreeNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PedigreeLayoutEdge {
  key: string;
  from: string;
  to: string;
  relation: PedigreeNode["relation"];
  repeated: boolean;
  cycle: boolean;
}

export interface PedigreeTreeLayout {
  nodes: PedigreeLayoutNode[];
  edges: PedigreeLayoutEdge[];
  width: number;
  height: number;
  maxGeneration: number;
  direction: "ancestors" | "descendants";
}

export interface PedigreeRadialSlot {
  key: string;
  node: PedigreeNode;
  generation: number;
  slot: number;
  slots: number;
}

export function pedigreeBranches(node: PedigreeNode): PedigreeNode[] {
  return node.parents?.length ? node.parents : (node.children ?? []);
}

export function pedigreeDirection(root: PedigreeNode): "ancestors" | "descendants" {
  return root.parents?.length ? "ancestors" : "descendants";
}

/**
 * Leaf-balanced tree layout. Repeated ancestors remain distinct recorded
 * positions (as the API models them), while repeat/cycle flags travel with the
 * node for the renderer to encode semantically.
 */
export function buildPedigreeTreeLayout(root: PedigreeNode, options: PedigreeLayoutOptions = {}): PedigreeTreeLayout {
  const nodeWidth = Math.max(120, options.nodeWidth ?? 190);
  const nodeHeight = Math.max(64, options.nodeHeight ?? 82);
  const columnGap = Math.max(28, options.columnGap ?? 72);
  const rowGap = Math.max(12, options.rowGap ?? 24);
  const paddingX = Math.max(8, options.paddingX ?? 24);
  const paddingY = Math.max(8, options.paddingY ?? 24);
  const requestedMax = Math.max(0, options.maxGeneration ?? 12);
  const direction = pedigreeDirection(root);
  let leafIndex = 0;
  let observedMax = 0;
  const staged: Array<{ key: string; node: PedigreeNode; centerY: number }> = [];
  const edges: PedigreeLayoutEdge[] = [];

  const walk = (node: PedigreeNode, key: string, parentKey?: string): number => {
    observedMax = Math.max(observedMax, node.generation);
    const children = node.generation >= requestedMax ? [] : pedigreeBranches(node);
    let centerY: number;
    if (children.length) {
      const centers = children.map((child, index) => walk(child, `${key}.${index}`, key));
      centerY = (Math.min(...centers) + Math.max(...centers)) / 2;
    } else {
      centerY = paddingY + nodeHeight / 2 + leafIndex * (nodeHeight + rowGap);
      leafIndex += 1;
    }
    staged.push({ key, node, centerY });
    if (parentKey) {
      edges.push({
        key: `${parentKey}>${key}`,
        from: parentKey,
        to: key,
        relation: node.relation,
        repeated: node.repeated,
        cycle: node.cycle,
      });
    }
    return centerY;
  };

  walk(root, "root");
  const maxGeneration = Math.min(requestedMax, observedMax);
  const width = paddingX * 2 + nodeWidth * (maxGeneration + 1) + columnGap * maxGeneration;
  const height = Math.max(
    nodeHeight + paddingY * 2,
    paddingY * 2 + Math.max(1, leafIndex) * nodeHeight + Math.max(0, leafIndex - 1) * rowGap,
  );
  const generationX = (generation: number) => paddingX + generation * (nodeWidth + columnGap);
  const nodes = staged.map(({ key, node, centerY }) => {
    const logicalX = generationX(node.generation);
    return {
      key,
      node,
      x: options.rtl ? width - logicalX - nodeWidth : logicalX,
      y: centerY - nodeHeight / 2,
      width: nodeWidth,
      height: nodeHeight,
    };
  });

  return { nodes, edges, width, height, maxGeneration, direction };
}

/** Binary ancestor slots used by sunburst/radial pedigree renderers. */
export function collectAncestorRadialSlots(root: PedigreeNode, maxGeneration = 6): PedigreeRadialSlot[] {
  const maxDepth = Math.max(1, Math.min(10, maxGeneration));
  const slots: PedigreeRadialSlot[] = [];
  const visit = (node: PedigreeNode, generation: number, slot: number, key: string) => {
    if (generation > maxDepth) return;
    if (generation > 0) slots.push({ key, node, generation, slot, slots: 2 ** generation });
    if (generation === maxDepth) return;
    const parents = node.parents ?? [];
    const sire = parents.find(parent => parent.relation === "father");
    const dam = parents.find(parent => parent.relation === "mother");
    if (sire) visit(sire, generation + 1, slot * 2, `${key}.s`);
    if (dam) visit(dam, generation + 1, slot * 2 + 1, `${key}.d`);
  };
  visit(root, 0, 0, "root");
  return slots;
}

export function polarPoint(cx: number, cy: number, radius: number, angleDegrees: number) {
  const angle = (angleDegrees - 90) * Math.PI / 180;
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

export function annularSectorPath(cx: number, cy: number, inner: number, outer: number, start: number, end: number): string {
  const a = polarPoint(cx, cy, outer, start);
  const b = polarPoint(cx, cy, outer, end);
  const c = polarPoint(cx, cy, inner, end);
  const d = polarPoint(cx, cy, inner, start);
  const largeArc = end - start > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${outer} ${outer} 0 ${largeArc} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)} L ${c.x.toFixed(2)} ${c.y.toFixed(2)} A ${inner} ${inner} 0 ${largeArc} 0 ${d.x.toFixed(2)} ${d.y.toFixed(2)} Z`;
}
