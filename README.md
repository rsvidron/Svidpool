# SvidPool

Projected practice drills for a pool table. A 1080p projector paints targets on
the cloth; you shoot them.

Current state: **calibration harness only.** Nothing else works until the
projection lines up with the slate, so that came first.

## Run it

```bash
npm run dev
```

Open the URL on the machine driving the projector, drag the window onto the
projector display, press `F` for fullscreen.

## Calibrating

Everything the app will ever draw is authored in **table inches**. A single
3x3 homography turns those into screen pixels. Calibration is nothing more
than telling the app where the four corners of the playing surface fall on
screen.

This is one model, not two — a ceiling-centered projector produces a near
rectangle and an off-angle one produces a trapezoid, and the same eight numbers
describe both. The mount presets only seed the handle positions so you drag a
few inches instead of across the screen.

**Turn the projector's own keystone correction OFF.** Correcting in the app and
in the projector stacks two resampling passes and throws away pixels twice.

Procedure:

1. Pick your table size (default is 8 ft, 88 x 44 playing surface).
2. Click the mount preset closest to your setup.
3. Pattern **7 — Crosshair**. Get the diagonals crossing over the center spot.
   Coarse pass, big movements.
4. Pattern **1 — Table outline**. Drag each handle until the white boundary sits
   exactly on the cushion nose. Use `Tab` to pick a corner and the arrow keys to
   nudge while you look at the cloth rather than the screen — the active handle
   has marching ants around it.
5. Pattern **2 — Diamond sights**. Sight from each real rail diamond to its
   projected tick. Drift here means a corner is still off, and it shows up at the
   rails long before it shows up at the corners.
6. Pattern **4 — Ball rings**. Put a real ball inside a ring at several places on
   the table. It should touch all the way around, everywhere. This is the only
   test that catches a scale error.
7. Pattern **5 — Circles**. They must read as circles, not eggs.
8. Press `S` to save. Calibration lives in localStorage; Export writes a JSON
   file worth keeping.

Watch the readout under the handles. `px/in` spread over about 60% means the far
end of the table is giving up a lot of resolution and the projector wants
re-aiming. Below 8 px/in anywhere, ball-sized targets stop being crisp.

## Low ceilings

Throw distance = throw ratio x image width, and a 16:9 image over a 2:1 table is
width-bound, so the image has to be at least as wide as the table is long.
Measured from the lens down to the cloth, for an 88 inch table:

| Throw ratio | Height above the bed | Rough ceiling needed |
|---|---|---|
| 1.5 (long) | 132 in / 11.0 ft | ~13.5 ft |
| 1.2 (typical) | 106 in / 8.8 ft | ~11.3 ft |
| 0.8 (short) | 70 in / 5.9 ft | ~8.4 ft |
| 0.5 (short throw) | 44 in / 3.7 ft | ~6.2 ft |
| 0.25 (ultra short) | 22 in / 1.8 ft | ~4.3 ft |

Add the table height, about 30 inches, to get from "above the bed" to "above the
floor". Most rooms want 0.5 or shorter to cover the whole slate.

**If the image lands smaller than the table, the app still works.** The table's
corners simply map to screen coordinates outside the projected rectangle. That is
valid — the projector paints no light there, but the homography through those
points is still correct for the part it does light. Two things make that usable:

- **Zoom out** (`wheel`, `−`, or `Z` to fit) so the off-frame handles come into
  reach. The dashed amber rectangle is the projector frame; outside it there is
  no light. Everything beyond is dimmed.
- **The coverage readout** tells you exactly what you are losing: what percentage
  of the cloth is lit, and which pockets get nothing. That is the number that
  decides whether a drill is projectable.

Calibrating when the corners are dark is iterative rather than direct: place the
handles roughly, switch to pattern **2 — Diamond sights**, and align the ticks
you *can* see against the real rail diamonds. Get the visible diamonds right and
the off-frame corners follow, because four points fix the whole plane.

**Zoom is an editing aid, not part of the calibration.** It is never saved, and
the panel turns the zoom percentage magenta whenever you are off 1:1. Press `0`
before you actually shoot.

## Keys

| | |
|---|---|
| drag a handle | move it |
| drag the background | pan |
| wheel | zoom about the cursor |
| `0` | back to 1:1 |
| `Z` | fit frame + handles in view |
| `−` / `=` | zoom out / in |
| `Tab` / `Shift+Tab` | next / previous corner |
| arrows | nudge 1 px |
| `Shift`+arrows | nudge 10 px |
| `Alt`+arrows | nudge 0.25 px |
| `Space`, `1`–`7` | test pattern |
| `F` | fullscreen |
| `H` | cycle panel → handles only → clean |
| `R` | rotate corner mapping 90° |
| `S` | save |

`R` is for a projector mounted sideways relative to the table. It relabels which
handle means which corner instead of making you re-drag all four.

The control bar sits along the bottom rather than down one side, because the
table fills the width of the projection and a sidebar covers cloth you need. It
still overlaps the bottom rail by roughly 60 px at 1080p — press `H` once for
handles-only while doing fine work down there.

## Design notes

**Colors.** Green cloth swallows green and dark blue. The palette is white,
cyan, magenta and amber, and it should stay that way.

**Rings, not discs.** A ball sitting on a filled target hides it and casts a
shadow. Every ball position is drawn as a ring slightly larger than the ball, so
it survives having a ball in it.

**Direct point transform, not CSS `matrix3d`.** Both are correct. Transforming
points in the draw loop avoids a second resample of an already-warped canvas,
which matters when there are only 1080 lines to spend on an 88-inch table.
`toCssMatrix3d()` is kept in `geom/homography.ts` because it is the easy path
for overlaying real HTML on the cloth later.

**Normalized handles.** Handle positions are stored as fractions of the viewport,
not pixels, so entering fullscreen does not destroy the calibration.

## Deploying

The app is entirely client-side — there is no backend and no database. Deploying
just means serving a folder of static files.

```bash
npm run serve      # build, then serve dist/ exactly as production does
```

`server.mjs` is a dependency-free static server: SPA fallback for navigation
paths, real 404s for missing assets (so a broken deploy shows up as a 404 rather
than a confusing MIME error), immutable caching on Vite's content-hashed assets,
`no-cache` on `index.html`, ETag revalidation, and path-traversal rejection.

**Railway.** `railway.json` points at the `Dockerfile`, which builds in one stage
and ships only `dist/` plus the server in the next. A Dockerfile rather than
Nixpacks autodetection because `vite` and `typescript` are devDependencies, and
an autodetected build that installs production dependencies only would fail to
build at all. Railway injects `PORT`; nothing else needs configuring.

Two things get *better* when deployed rather than run off `http://192.168.x.x`:
the Screen Wake Lock API needs a secure context, and so does reliable
fullscreen. Railway terminates TLS, so both work.

Calibration lives in `localStorage`, which is per-browser and per-origin. Moving
between the local dev server and the deployed URL will not carry it across —
that is what Export/Import is for. Export once you have a good calibration.

## Layout

```
src/
  geom/homography.ts   4-point solve, apply, invert, local scale
  geom/table.ts        table specs, corners, pockets, diamonds, spots (inches)
  calib/state.ts       handles, rotation, persistence, homography assembly
  render/draw.ts       table-space -> screen-space canvas primitives
  render/patterns.ts   the seven calibration patterns
  main.ts              render loop, input, panel wiring
```

## Roadmap

- **Next:** drill data model and the operator view — an undistorted top-down
  table on the laptop monitor, synced to the projected view over
  `BroadcastChannel`, so drills can be authored by clicking a normal table.
- Geometry solver: ghost ball, cut angle, tangent line.
- Challenge runner driven by a USB presenter clicker: made / missed / next.
- Difficulty as one variable — the radius of the cue ball landing zone.
- Later: a spin model for computed cue ball position, then procedural generation
  of verified-solvable challenges.
