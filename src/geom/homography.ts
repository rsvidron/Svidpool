/**
 * Planar homography: maps table space (inches) -> screen space (CSS pixels).
 *
 * A projector aimed at a table produces a perspective projection of a plane
 * onto a plane, which is exactly a homography. This is true whether the
 * projector is centered above the table or slung off at an angle from the end
 * of the room -- the only difference is how far the destination quad departs
 * from a rectangle. So there is one calibration model, not two.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Row-major 3x3: [a b c  d e f  g h i] */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Solve the 8-DOF homography taking each src[i] to dst[i]. Needs exactly four
 * correspondences, no three of them collinear.
 *
 * For u = (h0 x + h1 y + h2) / (h6 x + h7 y + 1) and likewise for v, each
 * correspondence contributes two linear rows in the eight unknowns.
 */
export function solveHomography(src: Pt[], dst: Pt[]): Mat3 {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error('solveHomography needs exactly 4 point pairs');
  }

  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinear(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gauss-Jordan with partial pivoting. n is small (8), so clarity beats cleverness. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) {
      throw new Error('degenerate calibration quad (three points collinear?)');
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const d = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= d;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }

  return M.map((row) => row[n]);
}

/** A * B, row-major. Composing a view transform with a homography stays a homography. */
export function multiply(A: Mat3, B: Mat3): Mat3 {
  const out = new Array(9).fill(0) as number[];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    }
  }
  return out as Mat3;
}

export function apply(H: Mat3, p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}

export function invert(H: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('singular homography');
  const s = 1 / det;
  return [
    A * s,
    -(b * i - c * h) * s,
    (b * f - c * e) * s,
    B * s,
    (a * i - c * g) * s,
    -(a * f - c * d) * s,
    C * s,
    -(a * h - b * g) * s,
    (a * e - b * d) * s,
  ];
}

/**
 * Local scale in screen pixels per table inch at a given table point, sampled
 * along each axis. Under perspective this varies across the table; the ratio
 * of max to min tells you how much resolution the far end is giving up.
 */
export function localScale(H: Mat3, p: Pt): { sx: number; sy: number } {
  const o = apply(H, p);
  const dx = apply(H, { x: p.x + 1, y: p.y });
  const dy = apply(H, { x: p.x, y: p.y + 1 });
  return {
    sx: Math.hypot(dx.x - o.x, dx.y - o.y),
    sy: Math.hypot(dy.x - o.x, dy.y - o.y),
  };
}

/**
 * CSS `matrix3d` string for warping a DOM subtree by this homography.
 * Unused by the canvas renderer (which transforms points directly, avoiding a
 * second resample), but kept because it is the easy path for overlaying HTML
 * on the cloth later.
 *
 * matrix3d takes column-major arguments.
 */
export function toCssMatrix3d(H: Mat3): string {
  const m = [H[0], H[3], 0, H[6], H[1], H[4], 0, H[7], 0, 0, 1, 0, H[2], H[5], 0, H[8]];
  return `matrix3d(${m.join(',')})`;
}
