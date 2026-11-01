// Battle maps. Every layout is point-symmetric so neither side has an advantage.
import { mirror, key } from './hex.js';

function sym(tiles) {
  const out = new Map();
  for (const [p, typ] of tiles) { out.set(key(p), typ); out.set(key(mirror(p)), typ); }
  return out;
}

export const MAPS = {
  riverlands: {
    name: 'Riverlands', theme: 'water', sky: 0x9fd3ff, ground: 0x5f8f4e,
    base: sym([[[3, 3], 'river'], [[4, 3], 'river'], [[1, 3], 'brush'], [[5, 1], 'high']]),
    eventTime: 50, eventName: 'Flood!',
    event: (b) => { for (const p of [[2, 3], [4, 4]]) b.setBase(p, 'river'); },
  },
  caldera: {
    name: 'Caldera', theme: 'fire', sky: 0xffb38a, ground: 0x6b4a3a,
    base: sym([[[3, 3], 'high'], [[4, 3], 'high'], [[0, 3], 'brush'], [[1, 1], 'brush']]),
    eventTime: 45, eventName: 'Eruption!',
    event: (b) => { for (const p of [[1, 2], [4, 2], [0, 5]]) for (const q of [p, mirror(p)]) b.setOverlay(q, 'lava', 10); },
  },
  stormpeaks: {
    name: 'Storm Peaks', theme: 'electric', sky: 0xb8c4e6, ground: 0x6f7a8c,
    base: sym([[[1, 2], 'high'], [[5, 2], 'high'], [[3, 3], 'high'], [[2, 3], 'brush']]),
    eventTime: 40, eventName: 'Lightning storm!',
    event: (b) => { for (const p of [[2, 2], [4, 1], [3, 0]]) for (const q of [p, mirror(p)]) b.setOverlay(q, 'charged', 8); },
  },
  grove: {
    name: 'Ancient Grove', theme: 'earth', sky: 0xcfe8b0, ground: 0x4d7a3a,
    base: sym([[[0, 3], 'brush'], [[2, 3], 'brush'], [[4, 3], 'brush'], [[6, 2], 'high'], [[3, 2], 'river']]),
    eventTime: 45, eventName: 'Overgrowth!',
    event: (b) => { for (const p of [[1, 2], [5, 3]]) for (const q of [p, mirror(p)]) b.setOverlay(q, 'brush', 20); },
  },
};

const ROLE_ROW = { Tank: 3, Bruiser: 3, Duelist: 3, Assassin: 3, Controller: 2, Support: 1, Mage: 1, Marksman: 0, Healer: 0 };
const CENTER_OUT = [3, 2, 4, 1, 5, 0, 6];
const FLANKS = [0, 6, 1, 5, 2, 4, 3];

// Default positions for team 0 (rows 0-3, row 3 is the front). Team 1 uses the mirror.
export function placement(roles) {
  const taken = new Set(), out = [];
  for (const role of roles) {
    const row = ROLE_ROW[role] ?? 2;
    const cols = role === 'Assassin' ? FLANKS : CENTER_OUT;
    const rows = [row, ...[2, 1, 3, 0].filter((r) => r !== row)];
    let pos = null;
    for (const r of rows) { for (const c of cols) if (!taken.has(key([c, r]))) { pos = [c, r]; break; } if (pos) break; }
    taken.add(key(pos)); out.push(pos);
  }
  return out;
}
