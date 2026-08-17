/**
 * Workspace zoom and pan.
 *
 * This is an editing affordance, not part of the calibration. With a low
 * ceiling the projector's image lands smaller than the table, so the table's
 * corners map to screen coordinates OUTSIDE the projected frame. That is
 * perfectly valid maths -- the projector simply paints no light there -- but
 * you cannot drag a handle to a point you cannot see.
 *
 * Zooming out shrinks the whole workspace into the window so those off-frame
 * handles become reachable. Because a view transform is affine and a homography
 * is projective, composing them is just a matrix product: patterns and draw
 * helpers need no knowledge of any of this.
 *
 * Two coordinate spaces are in play here:
 *   projector space - what the projector actually paints, 0..vw by 0..vh.
 *                     Calibration handles live here. This is what gets saved.
 *   canvas space    - what the window currently shows. Equal to projector space
 *                     at 1:1, which is the only setting you should project in.
 */

import { type Mat3, type Pt } from '../geom/homography';

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;

export function identityView(): View {
  return { zoom: 1, panX: 0, panY: 0 };
}

export function isNeutral(v: View): boolean {
  return Math.abs(v.zoom - 1) < 1e-6 && v.panX === 0 && v.panY === 0;
}

export function toCanvas(v: View, p: Pt): Pt {
  return { x: (p.x - v.panX) * v.zoom, y: (p.y - v.panY) * v.zoom };
}

export function toProjector(v: View, c: Pt): Pt {
  return { x: c.x / v.zoom + v.panX, y: c.y / v.zoom + v.panY };
}

export function viewMatrix(v: View): Mat3 {
  return [v.zoom, 0, -v.panX * v.zoom, 0, v.zoom, -v.panY * v.zoom, 0, 0, 1];
}

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Zoom about a fixed canvas point, so whatever is under the cursor stays put. */
export function zoomAt(v: View, canvasPt: Pt, factor: number): View {
  const anchor = toProjector(v, canvasPt);
  const zoom = clampZoom(v.zoom * factor);
  return {
    zoom,
    panX: anchor.x - canvasPt.x / zoom,
    panY: anchor.y - canvasPt.y / zoom,
  };
}

export function pan(v: View, canvasDx: number, canvasDy: number): View {
  return { zoom: v.zoom, panX: v.panX - canvasDx / v.zoom, panY: v.panY - canvasDy / v.zoom };
}

/**
 * Zoom out far enough to show the projector frame and every handle at once,
 * with a margin. This is the "I cannot find my handles" button.
 */
export function fit(handlesPx: Pt[], vw: number, vh: number, margin = 0.12): View {
  const xs = [0, vw, ...handlesPx.map((p) => p.x)];
  const ys = [0, vh, ...handlesPx.map((p) => p.y)];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const zoom = clampZoom(Math.min(vw / w, vh / h) * (1 - margin));

  // Centre the bounding box in the window.
  return {
    zoom,
    panX: (minX + maxX) / 2 - vw / (2 * zoom),
    panY: (minY + maxY) / 2 - vh / (2 * zoom),
  };
}
