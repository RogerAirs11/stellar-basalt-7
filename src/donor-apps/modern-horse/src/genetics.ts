import { shownSex, ancestor, BREEDS, COLOUR_L, hash, horseById, type Colour, type Horse, type Ref } from './data';
import { L } from './i18n';

export interface PNode {
  id: number; // heap index (1 = subject)
  gen: number;
  key: string; // ancestor key, unique per real individual
  name: L | null;
  colour?: Colour;
  year?: number;
  sex: 'M' | 'F' | 'U';
  isRoot?: boolean;
  horseId?: string;
  parents?: [PNode, PNode];
}

const frac = (x: number) => x - Math.floor(x);
const pick = (i: number, salt: number) => Math.floor(i * (0.3 + 0.65 * frac(Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453)));

function parentsOf(r: Ref): [Ref, Ref] | null {
  if (r.i <= 3) return null;
  const s = r.p === 'S' ? 1 : 3;
  return [
    { p: 'S', i: pick(r.i, s) },
    { p: 'D', i: pick(r.i, s + 1) },
  ];
}

function build(ref: Ref | null, id: number, gen: number, depth: number): PNode {
  if (!ref) return { id, gen, key: 'U' + id, name: null, sex: id % 2 === 0 ? 'M' : 'F' };
  const e = ancestor(ref.p, ref.i);
  const node: PNode = { id, gen, key: ref.p + ref.i, name: e.name, colour: e.colour, year: e.year, sex: ref.p === 'S' ? 'M' : 'F' };
  if (gen < depth) {
    const ps = parentsOf(ref);
    node.parents = [build(ps ? ps[0] : null, id * 2, gen + 1, depth), build(ps ? ps[1] : null, id * 2 + 1, gen + 1, depth)];
  }
  return node;
}

function buildH(h: Horse, id: number, gen: number, depth: number): PNode {
  // LIVE WIRING: name-only ancestor shells carry no real birth year or colour —
  // keep those unknown instead of inventing the placeholder values.
  const by = Number(h.birth.slice(0, 4));
  const node: PNode = { id, gen, key: 'H:' + h.id, name: h.name, colour: h.shell || h.registryFacts?.simpleCoat===false ? undefined : h.colour, year: !h.shell && by > 0 ? by : undefined, sex: shownSex(h)===undefined ? 'U' : shownSex(h) === 'mare' ? 'F' : 'M', isRoot: gen === 0, horseId: h.id };
  if (gen < depth) {
    const par = (hid: string | undefined, ref: Ref | null, nid: number): PNode => {
      const ph = hid ? horseById(hid) : undefined;
      return ph ? buildH(ph, nid, gen + 1, depth) : build(ref, nid, gen + 1, depth);
    };
    node.parents = [par(h.sireId, h.sire, id * 2), par(h.damId, h.dam, id * 2 + 1)];
  }
  return node;
}

export function buildPedigree(h: Horse, depth: number): PNode {
  return buildH(h, 1, 0, depth);
}

export function completeness(h: Horse, depth: number) {
  const known = flatten(buildPedigree(h, depth)).filter((n) => !n.isRoot && n.name).length;
  const total = Math.pow(2, depth + 1) - 2;
  return { known, total, pct: Math.round((known / total) * 100) };
}

export function flatten(root: PNode): PNode[] {
  const out: PNode[] = [];
  const walk = (n: PNode) => {
    out.push(n);
    n.parents?.forEach(walk);
  };
  walk(root);
  return out;
}

/* ---------- layout ---------- */

export interface LNode {
  node: PNode;
  x: number;
  y: number;
}
export interface LEdge {
  child: LNode;
  parent: LNode;
  d: string;
}
export interface LayoutOpts {
  nodeW: number;
  nodeH: number;
  gapX: number;
  gapY: number;
  rtl: boolean;
  orient: 'h' | 'v';
}

export function layoutTree(root: PNode, o: LayoutOpts) {
  const maxGen = Math.max(...flatten(root).map((n) => n.gen));
  const stepX = o.nodeW + o.gapX;
  const stepY = o.nodeH + o.gapY;
  let leaf = 0;
  const map = new Map<number, LNode>();
  const leaves = Math.pow(2, maxGen);
  const width = o.orient === 'h' ? maxGen * stepX + o.nodeW : (leaves - 1) * stepX + o.nodeW;
  const height = o.orient === 'h' ? (leaves - 1) * stepY + o.nodeH : maxGen * stepY + o.nodeH;
  const place = (n: PNode): LNode => {
    let t: number;
    if (n.parents) {
      const a = place(n.parents[0]);
      const b = place(n.parents[1]);
      t = o.orient === 'h' ? (a.y + b.y) / 2 : (a.x + b.x) / 2;
    } else {
      t = leaf++ * (o.orient === 'h' ? stepY : stepX);
    }
    let x: number, y: number;
    if (o.orient === 'h') {
      const gx = n.gen * stepX;
      x = o.rtl ? width - o.nodeW - gx : gx;
      y = t;
    } else {
      x = o.rtl ? width - o.nodeW - t : t;
      y = n.gen * stepY;
    }
    const ln = { node: n, x, y };
    map.set(n.id, ln);
    return ln;
  };
  place(root);
  const nodes = [...map.values()];
  const edges: LEdge[] = [];
  for (const ln of nodes) {
    ln.node.parents?.forEach((p) => {
      const pl = map.get(p.id)!;
      let d: string;
      if (o.orient === 'h') {
        const sx = o.rtl ? ln.x : ln.x + o.nodeW;
        const ex = o.rtl ? pl.x + o.nodeW : pl.x;
        const sy = ln.y + o.nodeH / 2;
        const ey = pl.y + o.nodeH / 2;
        const mx = (sx + ex) / 2;
        d = `M${sx} ${sy} C${mx} ${sy} ${mx} ${ey} ${ex} ${ey}`;
      } else {
        // top-down: leave the child's bottom edge, run along a shared bus, drop onto the ancestor's top edge.
        // The first part (child -> bus) is drawn once per child by the view; this path starts on the bus.
        const sx = ln.x + o.nodeW / 2;
        const ex = pl.x + o.nodeW / 2;
        const sy = ln.y + o.nodeH;
        const ey = pl.y;
        const my = sy + (ey - sy) / 2;
        const r = Math.min(6, (ey - sy) / 4);
        const dir = ex > sx ? 1 : -1;
        d = `M${sx} ${my - r} Q${sx} ${my} ${sx + dir * r} ${my} H${ex - dir * r} Q${ex} ${my} ${ex} ${my + r} V${ey}`;
      }
      edges.push({ child: ln, parent: pl, d });
    });
  }
  return { nodes, edges, width, height, maxGen };
}

/** relationship label like "Sire's dam's sire" */
export function positionLabel(id: number, tx: (en: string, fa: string) => string): string {
  if (id === 1) return tx('Subject', 'اسب مورد نظر');
  const bits = id.toString(2).slice(1).split('');
  const en = bits.map((b) => (b === '0' ? 'sire' : 'dam'));
  const fa = bits.map((b) => (b === '0' ? 'پدر' : 'مادر'));
  const enS = en.map((w, i) => (i === en.length - 1 ? w : w + "'s")).join(' ');
  const faS = [...fa].reverse().join(' ');
  const sentence = enS.charAt(0).toUpperCase() + enS.slice(1);
  return tx(sentence, faS);
}

/* ---------- repeated (linebred) ancestors ---------- */
export function repeatedKeys(root: PNode): Map<string, number> {
  const counts = new Map<string, number>();
  flatten(root).forEach((n) => {
    if (n.key.startsWith('U') || n.isRoot) return;
    counts.set(n.key, (counts.get(n.key) || 0) + 1);
  });
  const out = new Map<string, number>();
  counts.forEach((c, k) => c > 1 && out.set(k, c));
  return out;
}

/* ---------- mating analysis ---------- */

export interface Shared {
  key: string;
  name: L;
  colour: Colour;
  year: number;
  sex: 'M' | 'F' | 'U';
  sireGens: number[];
  damGens: number[];
  contribution: number;
}

export function analyseMating(sire: Horse, dam: Horse, depth = 6) {
  const collect = (h: Horse) => {
    const m = new Map<string, { node: PNode; gens: number[] }>();
    flatten(buildPedigree(h, depth)).forEach((n) => {
      if (n.isRoot || n.key.startsWith('U')) return;
      const e = m.get(n.key) || { node: n, gens: [] };
      e.gens.push(n.gen);
      m.set(n.key, e);
    });
    return m;
  };
  const a = collect(sire);
  const b = collect(dam);
  const shared: Shared[] = [];
  let coef = 0;
  a.forEach((ea, key) => {
    const eb = b.get(key);
    if (!eb) return;
    let c = 0;
    ea.gens.forEach((g1) => eb.gens.forEach((g2) => (c += Math.pow(0.5, g1 + g2 + 1))));
    coef += c;
    shared.push({ key, name: ea.node.name!, colour: ea.node.colour!, year: ea.node.year!, sex: ea.node.sex, sireGens: ea.gens, damGens: eb.gens, contribution: c });
  });
  shared.sort((x, y) => y.contribution - x.contribution);
  return { shared, coefficient: coef * 100, depth, completeness: { sire: completeness(sire, depth).pct, dam: completeness(dam, depth).pct } };
}

export type RiskLevel = 'safe' | 'moderate' | 'high';
export const riskLevel = (pct: number): RiskLevel => (pct < 8 ? 'safe' : pct < 12.5 ? 'moderate' : 'high');

/* ---------- coat colour ---------- */

const baseDist: Record<Colour, Record<Colour, number>> = {
  bay: { bay: 0.62, chestnut: 0.25, black: 0.13, grey: 0 },
  chestnut: { bay: 0, chestnut: 1, black: 0, grey: 0 },
  black: { bay: 0.2, chestnut: 0.1, black: 0.7, grey: 0 },
  grey: { bay: 0.55, chestnut: 0.3, black: 0.15, grey: 0 }, // hidden base colour guess
};

export function coatProbabilities(a: Colour, b: Colour): { colour: Colour; pct: number }[] {
  const greys = [a, b].filter((c) => c === 'grey').length;
  const g = greys === 2 ? 0.75 : greys === 1 ? 0.5 : 0;
  const rest: Record<Colour, number> = { bay: 0, chestnut: 0, black: 0, grey: 0 };
  (['bay', 'chestnut', 'black'] as Colour[]).forEach((c) => {
    rest[c] = (baseDist[a][c] + baseDist[b][c]) / 2;
  });
  const out = (['grey', 'bay', 'chestnut', 'black'] as Colour[]).map((c) => ({
    colour: c,
    pct: Math.round((c === 'grey' ? g : rest[c] * (1 - g)) * 100),
  }));
  const sum = out.reduce((s, x) => s + x.pct, 0);
  const top = out.reduce((m, x) => (x.pct > m.pct ? x : m), out[0]);
  top.pct += 100 - sum;
  return out.filter((x) => x.pct > 0).sort((x, y) => y.pct - x.pct);
}

export { COLOUR_L };

/* ---------- coat colour genetics (genotype based) ---------- */
export interface Genotype { e: 'EE' | 'Ee' | 'ee'; a: 'AA' | 'Aa' | 'aa'; g: 'GG' | 'Gg' | 'gg' }
export function genotypeOf(h: Horse): Genotype | null {
  if (!h.dna) return null;
  const s = hash(h.id + 'geno');
  const E: Genotype['e'][] = ['EE', 'Ee'];
  if (h.colour === 'chestnut') return { e: 'ee', a: s % 2 ? 'Aa' : 'aa', g: 'gg' };
  if (h.colour === 'bay') return { e: E[s % 2], a: s % 3 ? 'AA' : 'Aa', g: 'gg' };
  if (h.colour === 'black') return { e: E[s % 2], a: 'aa', g: 'gg' };
  const base = s % 3;
  return { e: base === 0 ? 'ee' : E[s % 2], a: base === 2 ? 'aa' : 'Aa', g: s % 2 ? 'GG' : 'Gg' };
}
const cross = (x: string, y: string) => {
  const out: Record<string, number> = {};
  for (const i of x) for (const j of y) { const gt = [i, j].sort().join(''); out[gt] = (out[gt] || 0) + 0.25; }
  return out;
};
export function predictCoat(a: Horse, b: Horse) {
  const ga = genotypeOf(a), gb = genotypeOf(b);
  if (!ga || !gb) return { ok: false as const, missing: [a, b].filter((h) => !genotypeOf(h)) };
  const ge = cross(ga.e, gb.e), gaa = cross(ga.a, gb.a), gg = cross(ga.g, gb.g);
  const pee = ge['ee'] || 0, paa = gaa['aa'] || 0, pg = 1 - (gg['gg'] || 0);
  const raw: Record<Colour, number> = {
    grey: pg, chestnut: (1 - pg) * pee, bay: (1 - pg) * (1 - pee) * (1 - paa), black: (1 - pg) * (1 - pee) * paa,
  };
  const colours = (Object.keys(raw) as Colour[]).map((colour) => ({ colour, pct: Math.round(raw[colour] * 100) })).filter((x) => x.pct > 0).sort((x, y) => y.pct - x.pct);
  const diff = 100 - colours.reduce((t, x) => t + x.pct, 0);
  if (colours.length) colours[0].pct += diff;
  const genes = [
    { gene: 'MC1R · Extension', a: ga.e, b: gb.e, out: ge },
    { gene: 'ASIP · Agouti', a: ga.a, b: gb.a, out: gaa },
    { gene: 'STX17 · Grey', a: ga.g, b: gb.g, out: gg },
  ];
  return { ok: true as const, colours, genes };
}

/* ---------- hereditary conditions ---------- */
export interface DiseaseDef { code: string; name: L; breeds: number[] | 'all'; mode: L }
export const DISEASES: DiseaseDef[] = [
  { code: 'SCID', name: L('Severe combined immunodeficiency', 'نقص ایمنی ترکیبی شدید'), breeds: [0], mode: L('Recessive', 'مغلوب') },
  { code: 'CA', name: L('Cerebellar abiotrophy', 'آبیوتروفی مخچه'), breeds: [0], mode: L('Recessive', 'مغلوب') },
  { code: 'LFS', name: L('Lavender foal syndrome', 'سندروم کره اسطوخودوسی'), breeds: [0], mode: L('Recessive', 'مغلوب') },
  { code: 'HYPP', name: L('Hyperkalemic periodic paralysis', 'فلج تناوبی هیپرکالمیک'), breeds: 'all', mode: L('Dominant', 'غالب') },
];
export type DStatus = 'clear' | 'carrier' | 'affected' | 'untested' | 'na';
const breedIdx = (h: Horse) => BREEDS.findIndex((b) => b.en === h.breed.en);
export function diseaseStatus(h: Horse, code: string): DStatus {
  const d = DISEASES.find((x) => x.code === code)!;
  if (d.breeds !== 'all' && !d.breeds.includes(breedIdx(h))) return 'na';
  if (!h.dna) return 'untested';
  if (h.carrier?.includes(code)) return 'carrier';
  if (!/^h\d+$/.test(h.id)) return 'clear';
  return hash(h.id + code) % 19 === 0 ? 'carrier' : 'clear';
}
export interface DiseaseRow { d: DiseaseDef; sire: DStatus; dam: DStatus; risk: 'none' | 'carrier' | 'high' | 'unknown'; affected: number; carrier: number }
export function assessDiseases(sire: Horse, dam: Horse): DiseaseRow[] {
  const rows: DiseaseRow[] = [];
  DISEASES.forEach((d) => {
    const s = diseaseStatus(sire, d.code), m = diseaseStatus(dam, d.code);
    if (s === 'na' && m === 'na') return;
    const sc = s === 'carrier', mc = m === 'carrier';
    const unk = s === 'untested' || m === 'untested';
    let risk: DiseaseRow['risk'] = 'none', affected = 0, carrier = 0;
    if (sc && mc) { risk = 'high'; affected = 25; carrier = 50; }
    else if ((sc || mc) && unk) risk = 'unknown';
    else if (sc || mc) { risk = 'carrier'; carrier = 50; }
    else if (unk) risk = 'unknown';
    rows.push({ d, sire: s, dam: m, risk, affected, carrier });
  });
  return rows;
}
