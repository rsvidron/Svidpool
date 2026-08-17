/**
 * Calibration test patterns.
 *
 * Each pattern is a different way to catch a different calibration error:
 *   outline   - does the boundary hug the cushion noses all the way round?
 *   diamonds  - do the sights line up with the real rail diamonds?
 *   grid      - is the scale right, and is it right everywhere?
 *   rings     - place a real ball in a ring; does it fit exactly?
 *   circles   - a circle that reads as an egg means the quad is off
 *   fill      - where exactly does the light land, and is it bright enough?
 *   crosshair - fast coarse alignment before fine work
 *
 * Palette note: green cloth swallows green and dark blue. Everything here is
 * white, cyan, magenta or amber.
 */

import type { Mat3, Pt } from '../geom/homography';
import {
  BALL_RADIUS_IN,
  corners,
  diamonds,
  pocketMouth,
  pockets,
  spots,
  type TableSpec,
} from '../geom/table';
import { arc, type Ctx, circlePath, dashed, label, line, polyPath, ring } from './draw';

export interface Pattern {
  id: string;
  name: string;
  hint: string;
  draw(ctx: Ctx, H: Mat3, t: TableSpec): void;
}

const WHITE = '#ffffff';
const CYAN = '#00e5ff';
const MAGENTA = '#ff3ea5';
const AMBER = '#ffc400';
const DIM = 'rgba(255,255,255,0.22)';

function surface(ctx: Ctx, H: Mat3, t: TableSpec, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  polyPath(ctx, H, corners(t));
  ctx.stroke();
}

function drawPockets(ctx: Ctx, H: Mat3, t: TableSpec): void {
  for (const pk of pockets(t)) {
    const r = pocketMouth(t, pk.kind) / 2;
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 2.5;
    // Only the half of the mouth that faces into the table is on the cloth.
    const facing = Math.atan2(pk.inward.y, pk.inward.x);
    arc(ctx, H, pk.p, r, facing - Math.PI / 2, facing + Math.PI / 2);
    ctx.stroke();
  }
}

function drawDiamondTicks(ctx: Ctx, H: Mat3, t: TableSpec): void {
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 2;
  const len = 2.5;
  for (const d of diamonds(t)) {
    line(ctx, H, d.p, { x: d.p.x + d.inward.x * len, y: d.p.y + d.inward.y * len });
  }
}

function drawSpots(ctx: Ctx, H: Mat3, t: TableSpec): void {
  const s = spots(t);
  ring(ctx, H, s.foot, BALL_RADIUS_IN, MAGENTA, 2);
  ring(ctx, H, s.head, BALL_RADIUS_IN, MAGENTA, 2);
  ring(ctx, H, s.center, BALL_RADIUS_IN, DIM, 1.5);
  dashed(ctx, [8, 8], () => {
    ctx.strokeStyle = DIM;
    ctx.lineWidth = 1.5;
    line(ctx, H, { x: s.headStringX, y: 0 }, { x: s.headStringX, y: t.widthIn });
    line(ctx, H, { x: 0, y: t.widthIn / 2 }, { x: t.lengthIn, y: t.widthIn / 2 });
  });
}

export const PATTERNS: Pattern[] = [
  {
    id: 'outline',
    name: 'Table outline',
    hint: 'The white boundary must sit exactly on the cushion noses the whole way round.',
    draw(ctx, H, t) {
      surface(ctx, H, t, WHITE, 3);
      drawPockets(ctx, H, t);
      drawDiamondTicks(ctx, H, t);
      drawSpots(ctx, H, t);
    },
  },
  {
    id: 'diamonds',
    name: 'Diamond sights',
    hint: 'Sight from each real rail diamond to its tick. Any drift means a corner is off.',
    draw(ctx, H, t) {
      surface(ctx, H, t, 'rgba(255,255,255,0.45)', 1.5);
      ctx.strokeStyle = CYAN;
      ctx.lineWidth = 2.5;
      const len = 4;
      for (const d of diamonds(t)) {
        line(ctx, H, d.p, { x: d.p.x + d.inward.x * len, y: d.p.y + d.inward.y * len });
      }
      // Rail-to-rail lines through matching diamonds: a straight, unbroken run
      // confirms the whole quad, not just the corners.
      dashed(ctx, [6, 10], () => {
        ctx.strokeStyle = 'rgba(0,229,255,0.35)';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 7; i++) {
          const x = (t.lengthIn * i) / 8;
          line(ctx, H, { x, y: 0 }, { x, y: t.widthIn });
        }
        for (let i = 1; i <= 3; i++) {
          const y = (t.widthIn * i) / 4;
          line(ctx, H, { x: 0, y }, { x: t.lengthIn, y });
        }
      });
      drawPockets(ctx, H, t);
    },
  },
  {
    id: 'grid',
    name: 'Inch grid',
    hint: 'Lay a tape on the cloth. Six-inch majors should land dead on the tape marks.',
    draw(ctx, H, t) {
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.lineWidth = 1;
      for (let x = 1; x < t.lengthIn; x++) {
        if (x % 6 === 0) continue;
        line(ctx, H, { x, y: 0 }, { x, y: t.widthIn });
      }
      for (let y = 1; y < t.widthIn; y++) {
        if (y % 6 === 0) continue;
        line(ctx, H, { x: 0, y }, { x: t.lengthIn, y });
      }

      ctx.strokeStyle = 'rgba(0,229,255,0.55)';
      ctx.lineWidth = 1.5;
      for (let x = 6; x < t.lengthIn; x += 6) line(ctx, H, { x, y: 0 }, { x, y: t.widthIn });
      for (let y = 6; y < t.widthIn; y += 6) line(ctx, H, { x: 0, y }, { x: t.lengthIn, y });

      for (let x = 12; x < t.lengthIn; x += 12) {
        label(ctx, H, { x, y: 3 }, String(x), AMBER, 12);
      }
      for (let y = 12; y < t.widthIn; y += 12) {
        label(ctx, H, { x: 4, y }, String(y), AMBER, 12);
      }
      surface(ctx, H, t, WHITE, 2.5);
    },
  },
  {
    id: 'rings',
    name: 'Ball rings',
    hint: 'Set a real ball inside a ring. It should touch all the way around, everywhere on the table.',
    draw(ctx, H, t) {
      const stepX = t.lengthIn / 8;
      const stepY = t.widthIn / 4;
      for (let i = 1; i < 8; i++) {
        for (let j = 1; j < 4; j++) {
          ring(ctx, H, { x: stepX * i, y: stepY * j }, BALL_RADIUS_IN, CYAN, 2);
        }
      }
      const s = spots(t);
      ring(ctx, H, s.foot, BALL_RADIUS_IN, MAGENTA, 2.5);
      label(ctx, H, { x: s.foot.x, y: s.foot.y - 4 }, 'FOOT', MAGENTA, 11);
      ring(ctx, H, s.head, BALL_RADIUS_IN, MAGENTA, 2.5);
      label(ctx, H, { x: s.head.x, y: s.head.y - 4 }, 'HEAD', MAGENTA, 11);
      surface(ctx, H, t, 'rgba(255,255,255,0.5)', 2);
    },
  },
  {
    id: 'circles',
    name: 'Circles',
    hint: 'These must read as circles from above, not eggs. Distortion here means a bad quad.',
    draw(ctx, H, t) {
      const c = { x: t.lengthIn / 2, y: t.widthIn / 2 };
      for (let r = 5; r <= t.widthIn / 2 - 1; r += 5) {
        ring(ctx, H, c, r, r % 10 === 0 ? CYAN : DIM, r % 10 === 0 ? 2 : 1.2);
      }
      for (const pk of pockets(t)) {
        if (pk.kind !== 'corner') continue;
        ring(ctx, H, pk.p, 8, 'rgba(255,196,0,0.5)', 1.5);
        ring(ctx, H, pk.p, 16, 'rgba(255,196,0,0.3)', 1.2);
      }
      surface(ctx, H, t, WHITE, 2.5);
    },
  },
  {
    id: 'fill',
    name: 'Solid fill',
    hint: 'Shows exactly where light lands and how bright the room is. Kill the lights and compare.',
    draw(ctx, H, t) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      polyPath(ctx, H, corners(t));
      ctx.fill();
      for (const pk of pockets(t)) {
        ctx.fillStyle = '#000000';
        circlePath(ctx, H, pk.p, pocketMouth(t, pk.kind) / 2);
        ctx.fill();
      }
    },
  },
  {
    id: 'crosshair',
    name: 'Crosshair',
    hint: 'Coarse pass: get the diagonals crossing over the center spot before fine-tuning corners.',
    draw(ctx, H, t) {
      const c = corners(t);
      ctx.strokeStyle = MAGENTA;
      ctx.lineWidth = 2;
      line(ctx, H, c[0], c[2]);
      line(ctx, H, c[1], c[3]);
      const s = spots(t);
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = 2;
      line(ctx, H, { x: s.center.x - 6, y: s.center.y }, { x: s.center.x + 6, y: s.center.y });
      line(ctx, H, { x: s.center.x, y: s.center.y - 6 }, { x: s.center.x, y: s.center.y + 6 });
      ring(ctx, H, s.center, BALL_RADIUS_IN, AMBER, 2);
      surface(ctx, H, t, WHITE, 3);
    },
  },
];

export function patternIndex(id: string): number {
  const i = PATTERNS.findIndex((p) => p.id === id);
  return i < 0 ? 0 : i;
}

/**
 * The edge of the projected image, drawn in canvas space while zoomed out.
 *
 * Outside this rectangle there is no light. Under a low ceiling the table's
 * corners often sit beyond it, and seeing that boundary is what makes placing
 * an off-frame handle possible rather than guesswork.
 */
export function drawProjectorFrame(ctx: Ctx, frameCanvasPts: Pt[]): void {
  ctx.save();
  // Dim everything outside the frame so the lit region reads at a glance.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.rect(-1e5, -1e5, 2e5, 2e5);
  frameCanvasPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill('evenodd');

  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  frameCanvasPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  const top = frameCanvasPts[0];
  ctx.fillStyle = AMBER;
  ctx.font = '11px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('PROJECTOR FRAME — no light outside this edge', top.x + 4, top.y - 4);
  ctx.restore();
}

/** Screen-space handle markers. Drawn last, on top of whatever pattern is up. */
export function drawHandles(
  ctx: Ctx,
  handlesPx: Pt[],
  colors: string[],
  labels: string[],
  active: number,
): void {
  handlesPx.forEach((p, i) => {
    const isActive = i === active;
    const color = colors[i];
    const arm = isActive ? 34 : 22;
    const gap = 7;

    ctx.strokeStyle = color;
    ctx.lineWidth = isActive ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x - arm, p.y);
    ctx.lineTo(p.x - gap, p.y);
    ctx.moveTo(p.x + gap, p.y);
    ctx.lineTo(p.x + arm, p.y);
    ctx.moveTo(p.x, p.y - arm);
    ctx.lineTo(p.x, p.y - gap);
    ctx.moveTo(p.x, p.y + gap);
    ctx.lineTo(p.x, p.y + arm);
    ctx.stroke();

    if (isActive) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, arm + 8, 0, Math.PI * 2);
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = color;
    ctx.font = `${isActive ? 14 : 11}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(labels[i], p.x + arm + 6, p.y + 6);
  });
}
