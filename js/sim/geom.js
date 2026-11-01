// World-space geometry for targeting shapes. Uses the same tile layout as the renderer
// (render/stage.js tileXZ) so what the telegraph shows is exactly what gets hit.
import * as hex from './hex.js';

export const HEX_R = 0.5;
export const HEX_W = Math.sqrt(3) * HEX_R;
export const ROW_H = 1.5 * HEX_R;

/** Tile center on the ground plane: [x, z]. */
export function tileXZ([col, row]) { return [(col + 0.5 * (row & 1) - 3.25) * HEX_W, (3.5 - row) * ROW_H]; }

/** Tile under a ground point, or null if off the board. */
export function tileAt([x, z]) {
  let best = null, bd = Infinity;
  for (const p of hex.ALL) {
    const [tx, tz] = tileXZ(p);
    const d = (tx - x) * (tx - x) + (tz - z) * (tz - z);
    if (d < bd) { bd = d; best = p; }
  }
  return bd <= HEX_R * 1.05 * (HEX_R * 1.05) ? best : null;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
// sqrt (not hypot/acos/pow): IEEE-exact in every browser, so versus matches stay in lockstep
const len = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1]);

/** Radius in world units for an area of `r` hex rings (covers the outer ring's centers). */
export const ringRadius = (r) => r * HEX_W + HEX_R * 0.8;

export function tilesInCircle(center, r) { return hex.within(center, r); }

// cos(angle/2 + 0.12 rad) for the cone angles in use, written out so no trig runs inside the sim
const COS_HALF = { 70: 0.7445971224029637 };

/** Cone from `origin` (tile) toward ground point `toward`: tiles whose centers fall inside. */
export function tilesInCone(origin, toward, range, angleDeg) {
  const o = tileXZ(origin), dir = sub(toward, o);
  const dl = len(dir) || 1;
  const reach = range * HEX_W + HEX_R * 0.6, coneCos = COS_HALF[angleDeg] ?? Math.cos((angleDeg / 2) * (Math.PI / 180) + 0.12);
  return hex.ALL.filter((p) => {
    if (hex.same(p, origin)) return false;
    const v = sub(tileXZ(p), o), d = len(v);
    if (d > reach) return false;
    const cos = (v[0] * dir[0] + v[1] * dir[1]) / (d * dl);
    return cos >= coneCos;
  });
}

/** Straight line from `origin` toward `toward`: tiles whose centers are within width/2 of the segment. */
export function tilesInLine(origin, toward, length, width = 0.7) {
  const o = tileXZ(origin), dir = sub(toward, o);
  const dl = len(dir) || 1, u = [dir[0] / dl, dir[1] / dl];
  const reach = length * HEX_W + HEX_R * 0.5;
  return hex.ALL.filter((p) => {
    if (hex.same(p, origin)) return false;
    const v = sub(tileXZ(p), o);
    const along = v[0] * u[0] + v[1] * u[1];
    const across = Math.abs(v[0] * u[1] - v[1] * u[0]);
    return along > 0.1 && along <= reach && across <= width / 2 + 0.05;
  }).sort((a, b) => hex.dist(origin, a) - hex.dist(origin, b));
}

/** Ground point clamped to `range` hexes from origin (for leaps and cast ranges). */
export function clampPoint(origin, point, range) {
  const o = tileXZ(origin), v = sub(point, o), d = len(v), max = range * HEX_W + 0.2;
  return d <= max ? point : [o[0] + (v[0] / d) * max, o[1] + (v[1] / d) * max];
}
export const tileDistWorld = (a, b) => len(sub(tileXZ(a), tileXZ(b)));
