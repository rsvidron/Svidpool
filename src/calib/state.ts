/**
 * Calibration state and persistence.
 *
 * Handle positions are stored NORMALIZED to the viewport (0..1), not in pixels.
 * Entering fullscreen changes the viewport size, and a pixel-based calibration
 * would be destroyed by that. Normalized handles survive it as long as the
 * aspect ratio holds -- which it does when the display stays 1920x1080.
 */

import { type Mat3, type Pt, solveHomography } from '../geom/homography';
import { corners, tableById, type TableSpec } from '../geom/table';

const STORAGE_KEY = 'svidpool.calibration.v1';

export type MountPreset = 'centered' | 'end' | 'side' | 'corner';

export interface CalibrationData {
  tableId: string;
  /** Four viewport-normalized points, in the corner order from table.ts. */
  handles: Pt[];
  /**
   * Quarter turns applied to the corner->handle assignment. Lets you fix a
   * projector that is rotated 90 or 180 degrees relative to the table without
   * re-dragging every handle.
   */
  rotation: 0 | 1 | 2 | 3;
}

export interface Viewport {
  w: number;
  h: number;
}

export function defaultHandles(preset: MountPreset, table: TableSpec, vp: Viewport): Pt[] {
  // Fit the table's aspect ratio inside the viewport with a margin, then bend
  // the quad into the rough shape that mount produces. These are only a
  // starting point for dragging, never a substitute for it.
  //
  // The fitting has to happen in PIXELS. Normalized x and y have different
  // pixel bases, so dividing a normalized width by an aspect ratio only gives
  // the right answer on a square viewport -- on 16:9 it seeds a quad stretched
  // to roughly 3.5:1, which then reports a huge px/in spread before you have
  // touched anything.
  const aspect = table.lengthIn / table.widthIn;
  const margin = 0.08;

  let wPx = vp.w * (1 - margin * 2);
  let hPx = wPx / aspect;
  const maxHPx = vp.h * (1 - margin * 2);
  if (hPx > maxHPx) {
    hPx = maxHPx;
    wPx = hPx * aspect;
  }

  const w = wPx / vp.w;
  const h = hPx / vp.h;
  const x0 = (1 - w) / 2;
  const y0 = (1 - h) / 2;
  const x1 = x0 + w;
  const y1 = y0 + h;

  const rect: Pt[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];

  // Perspective foreshortening: the edge farther from the lens is smaller.
  const k = 0.12;
  switch (preset) {
    case 'centered':
      return rect;
    case 'end':
      // Slung over the head rail, looking down the table: the foot end shrinks.
      return [
        { x: x0, y: y0 },
        { x: x1, y: y0 + h * k },
        { x: x1, y: y1 - h * k },
        { x: x0, y: y1 },
      ];
    case 'side':
      // Off one long rail: the far long rail shrinks.
      return [
        { x: x0 + w * k, y: y0 },
        { x: x1 - w * k, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
    case 'corner':
      // Off one corner of the room: one corner pushes out, the opposite pulls in.
      return [
        { x: x0 + w * k * 0.6, y: y0 + h * k * 0.6 },
        { x: x1, y: y0 },
        { x: x1 - w * k * 0.3, y: y1 - h * k * 0.3 },
        { x: x0, y: y1 },
      ];
  }
}

export function createCalibration(
  tableId = '8ft',
  preset: MountPreset = 'centered',
  vp: Viewport = { w: 1920, h: 1080 },
): CalibrationData {
  return { tableId, handles: defaultHandles(preset, tableById(tableId), vp), rotation: 0 };
}

export function load(): CalibrationData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as CalibrationData;
    if (!Array.isArray(data.handles) || data.handles.length !== 4) return null;
    return { tableId: data.tableId ?? '8ft', handles: data.handles, rotation: data.rotation ?? 0 };
  } catch {
    return null;
  }
}

export function save(data: CalibrationData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function clear(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Which table corner a given screen handle currently stands for.
 *
 * `rotation` re-labels the handles rather than moving them, so the label and
 * colour a handle carries must follow the corner, not the handle index --
 * otherwise "put the white one on the head-left pocket" stops being true.
 */
export function cornerForHandle(data: CalibrationData, handle: number): number {
  return (handle + data.rotation) % 4;
}

/** Normalized handles -> viewport pixels. */
export function handlePixels(data: CalibrationData, vp: Viewport): Pt[] {
  return data.handles.map((p) => ({ x: p.x * vp.w, y: p.y * vp.h }));
}

/**
 * Build the table-inches -> screen-pixels homography.
 *
 * `rotation` shifts which table corner each handle stands for, so a projector
 * mounted sideways is one keypress to fix rather than four drags.
 */
export function buildHomography(data: CalibrationData, vp: Viewport): Mat3 {
  const table = tableById(data.tableId);
  const src = corners(table);
  const dst = handlePixels(data, vp);
  const rotated = src.map((_, i) => src[(i + data.rotation) % 4]);
  return solveHomography(rotated, dst);
}

/** Index of the handle nearest to a viewport point, if within `radius` px. */
export function pickHandle(data: CalibrationData, vp: Viewport, p: Pt, radius = 40): number {
  const px = handlePixels(data, vp);
  let best = -1;
  let bestD = radius;
  for (let i = 0; i < px.length; i++) {
    const d = Math.hypot(px[i].x - p.x, px[i].y - p.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function nudge(data: CalibrationData, index: number, dxPx: number, dyPx: number, vp: Viewport): void {
  const h = data.handles[index];
  data.handles[index] = {
    x: clampNorm(h.x + dxPx / vp.w),
    y: clampNorm(h.y + dyPx / vp.h),
  };
}

export function setHandlePixel(data: CalibrationData, index: number, p: Pt, vp: Viewport): void {
  data.handles[index] = { x: clampNorm(p.x / vp.w), y: clampNorm(p.y / vp.h) };
}

/**
 * Handles are deliberately NOT clamped to the visible frame.
 *
 * When the projector cannot cover the whole table -- the usual outcome under a
 * low ceiling -- the table's corners genuinely fall outside the projected
 * rectangle. Those are valid screen coordinates that simply receive no light,
 * and the homography through them is still correct for the part that does. The
 * bound here is only a runaway guard: two frames' worth of slack in every
 * direction, which is far more than any sane setup needs.
 */
const NORM_SLACK = 2;

function clampNorm(v: number): number {
  const lo = -NORM_SLACK;
  const hi = 1 + NORM_SLACK;
  return v < lo ? lo : v > hi ? hi : v;
}
