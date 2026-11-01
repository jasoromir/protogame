// Overworld terrain: biomes, height field, and where things live. Pure functions (no rendering).

export const WORLD_SIZE = 180;   // meters, square, centered on 0

// value noise
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function smooth(t) { return t * t * (3 - 2 * t); }
function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  const u = smooth(xf), v = smooth(zf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z) { return noise(x, z) * 0.6 + noise(x * 2.1, z * 2.1) * 0.28 + noise(x * 4.3, z * 4.3) * 0.12; }

export const BIOMES = {
  meadow: { name: 'Sunlit Meadow', center: [0, 8], radius: 34, color: [0.34, 0.58, 0.22], creatures: ['Zippit', 'Raijura', 'Terragon', 'Mossfawn'], level: [10, 13], map: 'grove' },
  forest: { name: 'Whisperwood', center: [-8, 58], radius: 30, color: [0.24, 0.46, 0.22], creatures: ['Mossfawn', 'Hrimfang', 'Terragon'], level: [12, 15], map: 'grove' },
  lake: { name: 'Mirror Lake', center: [-58, 2], radius: 30, color: [0.48, 0.62, 0.36], creatures: ['Lotl', 'Brinehorn', 'Zippit'], level: [13, 16], map: 'riverlands' },
  volcano: { name: 'Ember Peak', center: [56, -44], radius: 32, color: [0.42, 0.3, 0.24], creatures: ['Cindrake', 'Ashlet', 'Raijura'], level: [14, 18], map: 'caldera' },
  snow: { name: 'Frostveil', center: [-40, -62], radius: 30, color: [0.86, 0.9, 0.95], creatures: ['Hrimfang', 'Flurrette', 'Lotl'], level: [17, 21], map: 'stormpeaks' },
};

export function biomeAt(x, z) {
  let best = 'meadow', bd = Infinity;
  for (const [id, b] of Object.entries(BIOMES)) {
    const d = Math.hypot(x - b.center[0], z - b.center[1]) / b.radius + (fbm(x * 0.05 + 7, z * 0.05) - 0.5) * 0.35;
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

/** Ground height (meters). */
export function heightAt(x, z) {
  let h = (fbm(x * 0.03, z * 0.03) - 0.5) * 6 + (fbm(x * 0.11, z * 0.11) - 0.5) * 1.2;
  const v = BIOMES.volcano.center, dv = Math.hypot(x - v[0], z - v[1]);
  if (dv < 30) h += Math.max(0, 16 * (1 - dv / 30) ** 1.6) - (dv < 6 ? (6 - dv) * 1.6 : 0);   // cone with a crater
  const l = BIOMES.lake.center, dl = Math.hypot(x - l[0], z - l[1]);
  if (dl < 20) h -= 4 * (1 - dl / 20) ** 0.7;                                                     // lake bowl
  const s = BIOMES.snow.center, ds = Math.hypot(x - s[0], z - s[1]);
  if (ds < 34) h += 5 * (1 - ds / 34);                                                            // snowy plateau
  const edge = Math.max(Math.abs(x), Math.abs(z)) - (WORLD_SIZE / 2 - 14);
  if (edge > 0) h += edge * 1.4;                                                                  // mountains at the border
  return h;
}

export const LAKE_LEVEL = -1.4;
const lakeDist = (x, z) => Math.hypot(x - BIOMES.lake.center[0], z - BIOMES.lake.center[1]);
/** Only the lake bowl holds water (low ground elsewhere is just dry hollows). */
export const isWater = (x, z) => lakeDist(x, z) < 24 && heightAt(x, z) < LAKE_LEVEL + 0.15;
export const isShore = (x, z, h = heightAt(x, z)) => lakeDist(x, z) < 26 && h < LAKE_LEVEL + 0.6;

// Gym temples (index matches data/gyms.js order)
export const GYM_SITES = [
  { id: 'ember', pos: [44, -30] },
  { id: 'tide', pos: [-36, 14] },
  { id: 'storm', pos: [34, 20] },
  { id: 'grove', pos: [8, 52] },
];
export const START_POS = [0, 4];
