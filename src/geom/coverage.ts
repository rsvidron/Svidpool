/**
 * How much of the table the projector actually reaches.
 *
 * With a limited ceiling height the projected image is often smaller than the
 * slate. Throw distance = throw ratio x image width, so covering an 88 inch
 * table with a 1.2 throw-ratio lens wants ~105 inches of air above the bed.
 * Short-throw glass is the usual fix, but before buying anything it is worth
 * knowing exactly what the current setup misses.
 *
 * The projector frame is a rectangle in screen space; pushed through the
 * inverse homography it becomes a quad in table space. Clipping that quad
 * against the playing surface gives the lit area, and testing each pocket
 * against it says which targets are unreachable -- the part that actually
 * decides whether a drill is projectable.
 */

import { apply, invert, type Mat3, type Pt } from './homography';
import { corners, pockets, type TableSpec } from './table';

export interface Coverage {
  /** Fraction of the playing surface that receives light, 0..1. */
  fraction: number;
  /** The projector frame mapped into table space (inches). */
  litQuad: Pt[];
  /** Names of pockets outside the lit area. */
  unlitPockets: string[];
  /** True when the maths degenerated; treat the rest as meaningless. */
  invalid: boolean;
}

export function signedArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function area(poly: Pt[]): number {
  return Math.abs(signedArea(poly));
}

function lineIntersect(p: Pt, q: Pt, a: Pt, b: Pt): Pt {
  const r = { x: q.x - p.x, y: q.y - p.y };
  const s = { x: b.x - a.x, y: b.y - a.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-12) return q;
  const t = ((a.x - p.x) * s.y - (a.y - p.y) * s.x) / denom;
  return { x: p.x + r.x * t, y: p.y + r.y * t };
}

/** Sutherland-Hodgman. `clipPoly` must be convex; the table rectangle is. */
export function clipPolygon(subject: Pt[], clipPoly: Pt[]): Pt[] {
  const orient = signedArea(clipPoly) > 0 ? 1 : -1;
  let output = subject;

  for (let i = 0; i < clipPoly.length && output.length > 0; i++) {
    const a = clipPoly[i];
    const b = clipPoly[(i + 1) % clipPoly.length];
    const inside = (p: Pt) =>
      orient * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= 0;

    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) output.push(lineIntersect(prev, cur, a, b));
        output.push(cur);
      } else if (prevIn) {
        output.push(lineIntersect(prev, cur, a, b));
      }
    }
  }

  return output;
}

/** Even-odd test, so it holds up even if the lit quad comes out non-convex. */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

export function distanceToBoundary(p: Pt, poly: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    d = Math.min(d, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  }
  return d;
}

/**
 * Every pocket sits exactly on the table boundary, so a projector aimed to just
 * cover the slate puts all six of them precisely on the edge of the lit quad --
 * where a strict inside/outside test is a coin flip. The tolerance makes "the
 * light reaches the pocket" count as lit, which is both numerically stable and
 * the answer that matters in practice.
 */
export const POCKET_LIT_TOLERANCE_IN = 0.5;

export function isLit(p: Pt, poly: Pt[], toleranceIn = POCKET_LIT_TOLERANCE_IN): boolean {
  return pointInPolygon(p, poly) || distanceToBoundary(p, poly) <= toleranceIn;
}

export function coverage(H: Mat3, vw: number, vh: number, table: TableSpec): Coverage {
  const empty: Coverage = { fraction: 0, litQuad: [], unlitPockets: [], invalid: true };
  if (vw <= 0 || vh <= 0) return empty;

  let inv: Mat3;
  try {
    inv = invert(H);
  } catch {
    return empty;
  }

  const frame: Pt[] = [
    { x: 0, y: 0 },
    { x: vw, y: 0 },
    { x: vw, y: vh },
    { x: 0, y: vh },
  ];

  const litQuad = frame.map((p) => apply(inv, p));
  if (litQuad.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return empty;

  const surface = corners(table);
  const clipped = clipPolygon(litQuad, surface);
  const fraction = clipped.length < 3 ? 0 : area(clipped) / area(surface);

  const unlitPockets = pockets(table)
    .filter((pk) => !isLit(pk.p, litQuad))
    .map((pk) => pk.name);

  return { fraction, litQuad, unlitPockets, invalid: false };
}

/**
 * Throw distance needed to cover a table, measured from the lens to the cloth.
 *
 * A 16:9 image over a 2:1 table is width-bound, so the image must be at least
 * as wide as the table is long.
 */
export function requiredThrowDistanceIn(table: TableSpec, throwRatio: number): number {
  return throwRatio * table.lengthIn;
}
