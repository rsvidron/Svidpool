/**
 * Canvas drawing helpers that take table-space (inch) coordinates and emit
 * screen-space paths through the homography.
 *
 * Points are transformed directly rather than warping the whole canvas with a
 * CSS matrix3d. Both are correct; direct transform avoids a second resample,
 * which matters when the projector only has 1080p to spend on an 88-inch table.
 *
 * A homography maps lines to lines, so segments only need their endpoints
 * transformed. Circles map to conics, so they are sampled as polygons.
 */

import { apply, type Mat3, type Pt } from '../geom/homography';

export type Ctx = CanvasRenderingContext2D;

export function line(ctx: Ctx, H: Mat3, a: Pt, b: Pt): void {
  const p = apply(H, a);
  const q = apply(H, b);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(q.x, q.y);
  ctx.stroke();
}

export function polyPath(ctx: Ctx, H: Mat3, pts: Pt[], close = true): void {
  ctx.beginPath();
  pts.forEach((pt, i) => {
    const s = apply(H, pt);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  if (close) ctx.closePath();
}

export function circlePath(ctx: Ctx, H: Mat3, c: Pt, rIn: number, segments = 64): void {
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const s = apply(H, { x: c.x + Math.cos(a) * rIn, y: c.y + Math.sin(a) * rIn });
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
  ctx.closePath();
}

export function ring(ctx: Ctx, H: Mat3, c: Pt, rIn: number, color: string, width = 2): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  circlePath(ctx, H, c, rIn);
  ctx.stroke();
}

/**
 * An arc of a circle in table space, from angle a0 to a1 (radians, table space).
 * Used for pocket mouths.
 */
export function arc(ctx: Ctx, H: Mat3, c: Pt, rIn: number, a0: number, a1: number, segments = 32): void {
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments;
    const s = apply(H, { x: c.x + Math.cos(a) * rIn, y: c.y + Math.sin(a) * rIn });
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
}

/**
 * Text anchored at a table-space point but drawn upright in screen space.
 * Rotating glyphs with the table is legible in a mockup and unreadable on cloth.
 */
export function label(
  ctx: Ctx,
  H: Mat3,
  at: Pt,
  text: string,
  color: string,
  size = 13,
  align: CanvasTextAlign = 'center',
): void {
  const s = apply(H, at);
  ctx.fillStyle = color;
  ctx.font = `${size}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, s.x, s.y);
}

export function dashed(ctx: Ctx, pattern: number[], fn: () => void): void {
  ctx.save();
  ctx.setLineDash(pattern);
  fn();
  ctx.restore();
}
