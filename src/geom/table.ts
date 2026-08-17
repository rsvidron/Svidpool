/**
 * Table geometry, in inches, measured on the playing surface.
 *
 * Coordinate system: origin at the head-rail / left-rail corner of the playing
 * surface (cushion nose to cushion nose).
 *   x runs 0 -> lengthIn, head rail to foot rail
 *   y runs 0 -> widthIn, left rail to right rail (looking from the head)
 *
 * Everything the app ever draws is authored in this space. The homography is
 * the only place screen pixels appear.
 */

import type { Pt } from './homography';

export const BALL_DIA_IN = 2.25;
export const BALL_RADIUS_IN = BALL_DIA_IN / 2;

export interface TableSpec {
  id: string;
  label: string;
  /** Playing surface, cushion nose to cushion nose. */
  lengthIn: number;
  widthIn: number;
  /** Mouth openings, jaw to jaw. Used to draw pocket targets. */
  cornerMouthIn: number;
  sideMouthIn: number;
}

export const TABLES: TableSpec[] = [
  { id: '7ft', label: '7 ft (bar box) - 78 x 39', lengthIn: 78, widthIn: 39, cornerMouthIn: 4.5, sideMouthIn: 5.0 },
  { id: '8ft', label: '8 ft (home) - 88 x 44', lengthIn: 88, widthIn: 44, cornerMouthIn: 4.75, sideMouthIn: 5.25 },
  { id: '8ftpro', label: '8 ft pro / oversize - 92 x 46', lengthIn: 92, widthIn: 46, cornerMouthIn: 4.5, sideMouthIn: 5.0 },
  { id: '9ft', label: '9 ft (tournament) - 100 x 50', lengthIn: 100, widthIn: 50, cornerMouthIn: 4.5, sideMouthIn: 5.0 },
];

export function tableById(id: string): TableSpec {
  return TABLES.find((t) => t.id === id) ?? TABLES[1];
}

/**
 * The four playing-surface corners, in cyclic order. This order is the contract
 * between the calibration handles and the homography solve -- handle N always
 * means corner N.
 *
 *   0 = head / left      1 = foot / left
 *   3 = head / right     2 = foot / right
 */
export function corners(t: TableSpec): Pt[] {
  return [
    { x: 0, y: 0 },
    { x: t.lengthIn, y: 0 },
    { x: t.lengthIn, y: t.widthIn },
    { x: 0, y: t.widthIn },
  ];
}

export const CORNER_LABELS = ['HEAD / LEFT', 'FOOT / LEFT', 'FOOT / RIGHT', 'HEAD / RIGHT'];

/** Distinct on green cloth; deliberately avoids green and deep blue. */
export const CORNER_COLORS = ['#ffffff', '#00e5ff', '#ff3ea5', '#ffc400'];

export interface Pocket {
  p: Pt;
  kind: 'corner' | 'side';
  /** Short name, used when reporting which pockets the projector fails to reach. */
  name: string;
  /** Direction the pocket faces, pointing into the table. Used to place labels. */
  inward: Pt;
}

export function pockets(t: TableSpec): Pocket[] {
  const { lengthIn: L, widthIn: W } = t;
  const d = Math.SQRT1_2;
  return [
    { p: { x: 0, y: 0 }, kind: 'corner', name: 'head-L', inward: { x: d, y: d } },
    { p: { x: L, y: 0 }, kind: 'corner', name: 'foot-L', inward: { x: -d, y: d } },
    { p: { x: L, y: W }, kind: 'corner', name: 'foot-R', inward: { x: -d, y: -d } },
    { p: { x: 0, y: W }, kind: 'corner', name: 'head-R', inward: { x: d, y: -d } },
    { p: { x: L / 2, y: 0 }, kind: 'side', name: 'side-L', inward: { x: 0, y: 1 } },
    { p: { x: L / 2, y: W }, kind: 'side', name: 'side-R', inward: { x: 0, y: -1 } },
  ];
}

export function pocketMouth(t: TableSpec, k: Pocket['kind']): number {
  return k === 'corner' ? t.cornerMouthIn : t.sideMouthIn;
}

export interface Diamond {
  /** Position on the cushion nose line. */
  p: Pt;
  /** Unit vector pointing into the table, so ticks can be drawn on the cloth. */
  inward: Pt;
}

/**
 * Diamond (sight) positions projected onto the nose line.
 *
 * Long rails are divided into eight parts by seven points, but the middle point
 * is the side pocket, so a real rail carries six diamonds. Short rails are
 * divided into four parts by three points.
 *
 * The physical diamonds sit out on the rail cap, not on the cloth, so these are
 * drawn as ticks just inside the cushion. Sight across from the real diamond to
 * the tick to check alignment.
 */
export function diamonds(t: TableSpec): Diamond[] {
  const { lengthIn: L, widthIn: W } = t;
  const out: Diamond[] = [];

  for (let i = 1; i <= 7; i++) {
    if (i === 4) continue; // side pocket
    const x = (L * i) / 8;
    out.push({ p: { x, y: 0 }, inward: { x: 0, y: 1 } });
    out.push({ p: { x, y: W }, inward: { x: 0, y: -1 } });
  }

  for (let i = 1; i <= 3; i++) {
    const y = (W * i) / 4;
    out.push({ p: { x: 0, y }, inward: { x: 1, y: 0 } });
    out.push({ p: { x: L, y }, inward: { x: -1, y: 0 } });
  }

  return out;
}

export function spots(t: TableSpec) {
  const { lengthIn: L, widthIn: W } = t;
  return {
    head: { x: L / 4, y: W / 2 },
    center: { x: L / 2, y: W / 2 },
    foot: { x: (L * 3) / 4, y: W / 2 },
    /** The head string: ball in hand behind the line after a scratch on the break. */
    headStringX: L / 4,
  };
}
