import './style.css';
import { apply, invert, localScale, type Mat3, multiply, type Pt } from './geom/homography';
import { CORNER_COLORS, CORNER_LABELS, corners, TABLES, tableById } from './geom/table';
import { coverage } from './geom/coverage';
import * as calib from './calib/state';
import * as V from './calib/view';
import { drawHandles, drawProjectorFrame, PATTERNS } from './render/patterns';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;

const el = {
  panel: document.getElementById('panel') as HTMLElement,
  table: document.getElementById('table') as HTMLSelectElement,
  mounts: document.getElementById('mounts') as HTMLElement,
  patterns: document.getElementById('patterns') as HTMLElement,
  hint: document.getElementById('hint') as HTMLElement,
  corner: document.getElementById('corner') as HTMLElement,
  scale: document.getElementById('scale') as HTMLElement,
  coverage: document.getElementById('coverage') as HTMLElement,
  warn: document.getElementById('warn') as HTMLElement,
  status: document.getElementById('status') as HTMLElement,
  zoomPct: document.getElementById('zoomPct') as HTMLElement,
  importFile: document.getElementById('importFile') as HTMLInputElement,
};

/** Projector-space size. Declared before state, which seeds handles from it. */
const vp = (): calib.Viewport => ({ w: window.innerWidth, h: window.innerHeight });

let data = calib.load() ?? calib.createCalibration('8ft', 'centered', vp());
let view = V.identityView();
let activeCorner = 0;
let patternIdx = 0;
/** 0 = panel + handles, 1 = handles only, 2 = clean projection. */
let uiMode: 0 | 1 | 2 = 0;
let dragging = -1;
let panning = false;
let lastPointer: Pt = { x: 0, y: 0 };

/** Calibration only: table inches -> projector pixels. This is what gets saved. */
let Hcal: Mat3 | null = null;
/** Calibration composed with the workspace view: table inches -> canvas pixels. */
let Hview: Mat3 | null = null;
let solveError = '';
let cursor: Pt | null = null;
let dpr = 1;

// ---------------------------------------------------------------- rendering

/**
 * Sized every frame rather than on the resize event. Moving the window to the
 * projector can change both size and devicePixelRatio, and a missed or
 * early-fired resize event leaves a zero-size backing store that draws nothing.
 * The assignment is skipped unless something actually changed.
 */
function syncCanvasSize(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { w, h } = vp();
  const cw = Math.max(1, Math.round(w * dpr));
  const ch = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== cw) canvas.width = cw;
  if (canvas.height !== ch) canvas.height = ch;
}

function render(): void {
  syncCanvasSize();
  const { w, h } = vp();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineDashOffset = 0;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const table = tableById(data.tableId);

  try {
    Hcal = calib.buildHomography(data, { w, h });
    Hview = multiply(V.viewMatrix(view), Hcal);
    solveError = '';
  } catch (e) {
    Hcal = null;
    Hview = null;
    solveError = e instanceof Error ? e.message : String(e);
  }

  if (Hview) PATTERNS[patternIdx].draw(ctx, Hview, table);

  // Only meaningful once zoomed out; at 1:1 the frame is the window edge.
  if (!V.isNeutral(view) && uiMode < 2) {
    const frame: Pt[] = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
    drawProjectorFrame(
      ctx,
      frame.map((p) => V.toCanvas(view, p)),
    );
  }

  if (uiMode < 2) {
    // Marching ants on the active corner make it findable while you are looking
    // at the cloth rather than the screen.
    ctx.lineDashOffset = -(performance.now() / 60) % 9;
    const map = [0, 1, 2, 3].map((i) => calib.cornerForHandle(data, i));
    drawHandles(
      ctx,
      calib.handlePixels(data, { w, h }).map((p) => V.toCanvas(view, p)),
      map.map((c) => CORNER_COLORS[c]),
      map.map((c) => CORNER_LABELS[c]),
      activeCorner,
    );
  }

  updateReadout();
  requestAnimationFrame(render);
}

// ----------------------------------------------------------------- readouts

function isConvex(p: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    const c = p[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

function updateReadout(): void {
  const view3 = vp();
  const table = tableById(data.tableId);
  const px = calib.handlePixels(data, view3);
  const a = px[activeCorner];

  const cornerName = CORNER_LABELS[calib.cornerForHandle(data, activeCorner)];
  el.corner.textContent = `${cornerName}   ${a.x.toFixed(1)}, ${a.y.toFixed(1)} px`;

  const zoomTxt = `${(view.zoom * 100).toFixed(0)}%`;
  el.zoomPct.textContent = zoomTxt;
  el.zoomPct.classList.toggle('off', !V.isNeutral(view));

  const warnings: string[] = [];
  if (solveError) warnings.push(solveError);
  if (!isConvex(px)) warnings.push('handles are crossed — drag them back into cyclic order');
  if (!V.isNeutral(view)) warnings.push('VIEW ZOOMED — press 0 for 1:1 before projecting');

  if (Hcal) {
    // Scale is reported from the calibration homography, never the composed
    // one: zooming the workspace must not change the physical px/in you get.
    //
    // Resolution at a point is the geometric mean of the two axis scales -- the
    // area-equivalent px/in. Pooling sx and sy separately would fold the axis
    // anisotropy that perspective always produces into a number that is meant
    // to answer one question: how much worse is the far end than the near end.
    const samples = [...corners(table), { x: table.lengthIn / 2, y: table.widthIn / 2 }];
    const res = samples.map((s) => {
      const { sx, sy } = localScale(Hcal!, s);
      return Math.sqrt(sx * sy);
    });
    const min = Math.min(...res);
    const max = Math.max(...res);
    const spread = (max / min - 1) * 100;

    let cursorTxt = '';
    if (cursor && Hview) {
      try {
        const t = apply(invert(Hview), cursor);
        cursorTxt = `   ·   cursor ${t.x.toFixed(1)}, ${t.y.toFixed(1)} in`;
      } catch {
        /* singular during a bad drag; nothing useful to show */
      }
    }

    el.scale.textContent =
      `${min.toFixed(1)}–${max.toFixed(1)} px/in · spread ${spread.toFixed(0)}%` +
      ` · rot ${data.rotation * 90}°${cursorTxt}`;

    const cov = coverage(Hcal, view3.w, view3.h, table);
    if (cov.invalid) {
      el.coverage.textContent = 'coverage —';
    } else {
      const pct = cov.fraction * 100;
      el.coverage.textContent =
        `lights ${pct.toFixed(1)}% of the cloth` +
        (cov.unlitPockets.length ? ` · dark pockets: ${cov.unlitPockets.join(' ')}` : ' · all 6 pockets lit');
      if (cov.unlitPockets.length) {
        warnings.push(
          `${cov.unlitPockets.length} pocket(s) get no light — shorten the throw or accept partial-table drills`,
        );
      }
    }

    if (min < 8) warnings.push(`only ${min.toFixed(1)} px/in at the far end — move the projector closer or reduce throw`);
    else if (spread > 60) warnings.push(`${spread.toFixed(0)}% scale spread — the far end is losing a lot of resolution`);
  } else {
    el.scale.textContent = '—';
    el.coverage.textContent = '—';
  }

  el.warn.textContent = warnings.join(' · ');
}

let statusTimer = 0;
function status(msg: string): void {
  el.status.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (el.status.textContent = ''), 2600);
}

// -------------------------------------------------------------- interaction

canvas.addEventListener('pointerdown', (e) => {
  const c = { x: e.clientX, y: e.clientY };
  lastPointer = c;
  // Handles live in projector space; the pointer arrives in canvas space.
  const i = calib.pickHandle(data, vp(), V.toProjector(view, c), 40 / view.zoom);
  if (i >= 0) {
    activeCorner = i;
    dragging = i;
  } else {
    panning = true;
  }
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  const c = { x: e.clientX, y: e.clientY };
  cursor = c;
  if (dragging >= 0) {
    calib.setHandlePixel(data, dragging, V.toProjector(view, c), vp());
  } else if (panning) {
    view = V.pan(view, c.x - lastPointer.x, c.y - lastPointer.y);
  }
  lastPointer = c;
});

const endDrag = () => {
  dragging = -1;
  panning = false;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const factor = Math.pow(0.999, e.deltaY);
    view = V.zoomAt(view, { x: e.clientX, y: e.clientY }, factor);
  },
  { passive: false },
);

function zoomBy(factor: number): void {
  const { w, h } = vp();
  view = V.zoomAt(view, { x: w / 2, y: h / 2 }, factor);
}

function zoomReset(): void {
  view = V.identityView();
  status('view back to 1:1 — safe to project');
}

function zoomFit(): void {
  const v = vp();
  view = V.fit(calib.handlePixels(data, v), v.w, v.h);
  status('fitted — remember to return to 1:1 before shooting');
}

const NUDGE_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

window.addEventListener('keydown', (e) => {
  const tag = (document.activeElement?.tagName ?? '').toLowerCase();
  if (tag === 'select' || tag === 'input') return;

  const dir = NUDGE_KEYS[e.key];
  if (dir) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : e.altKey ? 0.25 : 1;
    calib.nudge(data, activeCorner, dir[0] * step, dir[1] * step, vp());
    return;
  }

  switch (e.key) {
    case 'Tab':
      e.preventDefault();
      activeCorner = (activeCorner + (e.shiftKey ? 3 : 1)) % 4;
      break;
    case ' ':
      e.preventDefault();
      setPattern((patternIdx + 1) % PATTERNS.length);
      break;
    case '-':
    case '_':
      zoomBy(1 / 1.25);
      break;
    case '=':
    case '+':
      zoomBy(1.25);
      break;
    case '0':
      zoomReset();
      break;
    case 'z':
    case 'Z':
      zoomFit();
      break;
    case 'f':
    case 'F':
      toggleFullscreen();
      break;
    case 'h':
    case 'H':
      uiMode = ((uiMode + 1) % 3) as 0 | 1 | 2;
      el.panel.hidden = uiMode !== 0;
      break;
    case 'r':
    case 'R':
      rotateMapping();
      break;
    case 's':
    case 'S':
      doSave();
      break;
    default:
      if (e.key >= '1' && e.key <= String(Math.min(9, PATTERNS.length))) {
        setPattern(Number(e.key) - 1);
      }
  }
});

// ---------------------------------------------------------------- UI wiring

function setPattern(i: number): void {
  patternIdx = i;
  el.hint.textContent = PATTERNS[i].hint;
  [...el.patterns.children].forEach((b, n) => b.classList.toggle('active', n === i));
}

function rotateMapping(): void {
  data.rotation = ((data.rotation + 1) % 4) as 0 | 1 | 2 | 3;
  status(`corner mapping rotated to ${data.rotation * 90}°`);
}

function doSave(): void {
  calib.save(data);
  status('calibration saved');
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
      requestWakeLock();
    }
  } catch (e) {
    status(e instanceof Error ? e.message : 'fullscreen failed');
  }
}

let wakeLock: unknown = null;
async function requestWakeLock(): Promise<void> {
  const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<unknown> } };
  try {
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
  } catch {
    /* not supported, or blocked; the projector just may sleep */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && document.fullscreenElement && !wakeLock) {
    requestWakeLock();
  }
});

TABLES.forEach((t) => {
  const opt = document.createElement('option');
  opt.value = t.id;
  opt.textContent = t.label;
  el.table.appendChild(opt);
});
el.table.value = data.tableId;
el.table.addEventListener('change', () => {
  // The handles mark where the physical cloth corners fall on screen, so they
  // stay put; only the inches they stand for change.
  data.tableId = el.table.value;
  status(`table set to ${tableById(data.tableId).label}`);
  el.table.blur();
});

PATTERNS.forEach((p, i) => {
  const b = document.createElement('button');
  b.textContent = `${i + 1}. ${p.name}`;
  b.addEventListener('click', () => {
    setPattern(i);
    b.blur();
  });
  el.patterns.appendChild(b);
});

el.mounts.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const mount = target.dataset.mount as calib.MountPreset | undefined;
  if (!mount) return;
  data.handles = calib.defaultHandles(mount, tableById(data.tableId), vp());
  status(`handles seeded for ${mount} mount — now drag them onto the pockets`);
  target.blur();
});

const on = (id: string, fn: () => void) =>
  document.getElementById(id)!.addEventListener('click', (e) => {
    fn();
    (e.currentTarget as HTMLElement).blur();
  });

on('fullscreen', toggleFullscreen);
on('rotate', rotateMapping);
on('save', doSave);
on('zoomIn', () => zoomBy(1.25));
on('zoomOut', () => zoomBy(1 / 1.25));
on('zoomReset', zoomReset);
on('zoomFit', zoomFit);

on('revert', () => {
  const saved = calib.load();
  if (!saved) return status('nothing saved yet');
  data = saved;
  el.table.value = data.tableId;
  status('reverted to saved calibration');
});

on('reset', () => {
  data = calib.createCalibration(data.tableId, 'centered', vp());
  status('reset (saved calibration untouched — press Save to overwrite)');
});

on('export', () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `svidpool-calibration-${data.tableId}.json`;
  a.click();
  URL.revokeObjectURL(url);
  status('exported');
});

on('import', () => el.importFile.click());
el.importFile.addEventListener('change', async () => {
  const file = el.importFile.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as calib.CalibrationData;
    if (!Array.isArray(parsed.handles) || parsed.handles.length !== 4) throw new Error('bad shape');
    data = { tableId: parsed.tableId ?? '8ft', handles: parsed.handles, rotation: parsed.rotation ?? 0 };
    el.table.value = data.tableId;
    status('imported — press Save to keep it');
  } catch {
    status('could not read that file');
  }
  el.importFile.value = '';
});

// Hide the pointer when it stops moving so it does not sit on the cloth.
let cursorTimer = 0;
window.addEventListener('pointermove', () => {
  document.body.classList.remove('cursor-hidden');
  clearTimeout(cursorTimer);
  cursorTimer = window.setTimeout(() => document.body.classList.add('cursor-hidden'), 2500);
});

setPattern(0);
render();
