// Hex board helpers (odd-r offset layout), ported from sim/hexgrid.py.
// Team 0 (the player) owns rows 0-3, team 1 rows 4-7.

export const W = 7, H = 8;
export const ALL = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ALL.push([x, y]);

export const key = (p) => p[0] + p[1] * W;
export const fromKey = (k) => [k % W, Math.floor(k / W)];
export const inBounds = (p) => p[0] >= 0 && p[0] < W && p[1] >= 0 && p[1] < H;

function cube([x, y]) { return [x - ((y - (y & 1)) >> 1), y]; }

const DIST = new Int8Array(ALL.length * ALL.length);
for (const a of ALL) for (const b of ALL) {
  const [aq, ar] = cube(a), [bq, br] = cube(b);
  const dq = aq - bq, dr = ar - br;
  DIST[key(a) * ALL.length + key(b)] = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
export const dist = (a, b) => DIST[key(a) * ALL.length + key(b)];

const EVEN = [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
const ODD = [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]];
const NEIGH = ALL.map((p) => ((p[1] & 1) ? ODD : EVEN)
  .map(([dx, dy]) => [p[0] + dx, p[1] + dy]).filter(inBounds));
export const neighbors = (p) => NEIGH[key(p)];
export const within = (p, r) => ALL.filter((q) => dist(p, q) <= r);
// point symmetry: maps team 0's half onto team 1's
export const mirror = (p) => [W - 1 - p[0], H - 1 - p[1]];
export const same = (a, b) => a[0] === b[0] && a[1] === b[1];

// ---------- lines (for aimed Specials) ----------
function toCube([x, y]) { const q = x - ((y - (y & 1)) >> 1); return [q, y, -q - y]; }
function fromCube([q, r]) { return [q + ((r - (r & 1)) >> 1), r]; }
function cubeRound([q, r, s]) {
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs; else rs = -rq - rr;
  return [rq, rr, rs];
}
/** Tiles on the straight line from a to b (inclusive). */
export function line(a, b) {
  const n = dist(a, b), A = toCube(a), B = toCube(b), out = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const c = cubeRound([A[0] + (B[0] - A[0]) * t + 1e-6, A[1] + (B[1] - A[1]) * t + 1e-6, A[2] + (B[2] - A[2]) * t - 2e-6]);
    out.push(fromCube(c));
  }
  return out;
}
/** `length` tiles going from `from` in the direction of `toward` (extended past it if needed). */
export function ray(from, toward, length) {
  if (same(from, toward)) return [];
  const A = toCube(from), B = toCube(toward), d = dist(from, toward), out = [];
  for (let i = 1; i <= length; i++) {
    const t = i / d;
    const p = fromCube(cubeRound([A[0] + (B[0] - A[0]) * t + 1e-6, A[1] + (B[1] - A[1]) * t + 1e-6, A[2] + (B[2] - A[2]) * t - 2e-6]));
    if (!inBounds(p)) break;
    if (!out.length || !same(out[out.length - 1], p)) out.push(p);
  }
  return out;
}
