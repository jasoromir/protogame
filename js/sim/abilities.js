// Creature and trainer abilities, ported from sim/abilities.py.
// value(b, u) -> [score, info] (0 = invalid); cast(b, u, info). Abilities 1/2 auto-cast at `auto`;
// a thoughtful player waits for `smart` before firing a Special.
import * as hex from './hex.js';

const D = hex.dist;

// ---------- helpers ----------
function inRangeTarget(b, u) {
  const t = b.currentTarget(u);
  return t && D(u.pos, t.pos) <= b.rangeOf(u) ? t : null;
}
const adjacentEnemies = (b, u) => b.enemies(u).filter((e) => D(u.pos, e.pos) === 1);
function enemyCluster(b, u, castRange, radius) {
  let bestN = 0, best = null;
  const enemies = b.enemies(u);
  for (const e of enemies) if (D(u.pos, e.pos) <= castRange && b.targetable(u, e)) {
    const n = enemies.filter((o) => D(e.pos, o.pos) <= radius).length;
    if (n > bestN) { bestN = n; best = e; }
  }
  return [bestN, best];
}
function allyCluster(b, u, castRange, radius) {
  let bestN = 0, best = null;
  const allies = b.allies(u);
  for (const a of allies) if (D(u.pos, a.pos) <= castRange) {
    const n = allies.filter((o) => D(a.pos, o.pos) <= radius).length;
    if (n > bestN) { bestN = n; best = a; }
  }
  return [bestN, best];
}
function mostWounded(b, u, castRange) {
  const allies = b.allies(u).filter((a) => D(u.pos, a.pos) <= castRange);
  return allies.length ? allies.reduce((m, a) => (a.hpf < m.hpf ? a : m)) : null;
}
function freeNeighborToward(b, target, origin) {
  const cells = hex.neighbors(target.pos).filter((p) => b.free(p));
  if (!cells.length) return null;
  return cells.reduce((m, p) => (D(p, origin) < D(m, origin) ? p : m));
}
const isBackline = (u) => ['Mage', 'Marksman', 'Healer', 'Support', 'Controller'].includes(u.role);

function ab(value, cast, auto = 1, smart = null) { return { value, cast, auto, smart: smart ?? auto }; }
function stonewall(b, u) {
  if (!b.hasDuo(u.team, 'stonewall')) return;
  for (const e of b.enemies(u)) if (D(u.pos, e.pos) === 1) b.apply(u, e, 'taunt', 1.5);
}
/** Best straight line from the caster: [enemies hit, {tiles, hits}]. */
function bestLine(b, u, length) {
  let best = [0, null];
  for (const e of b.enemies(u)) {
    const tiles = hex.ray(u.pos, e.pos, length);
    const hits = b.enemies(u).filter((x) => tiles.some((t) => hex.same(t, x.pos)));
    if (hits.length > best[0]) best = [hits.length, { tiles, hits, at: e.pos }];
  }
  return best;
}
function lineInfo(b, u, pos, length) {
  const tiles = hex.ray(u.pos, pos, length);
  if (!tiles.length) return null;
  return { tiles, hits: b.enemies(u).filter((x) => tiles.some((t) => hex.same(t, x.pos))), at: pos };
}

export const ABILITIES = {
  // ---------- Fire ----------
  flame_spit: ab((b, u) => { const t = inRangeTarget(b, u); return t ? [1, t] : [0, null]; },
    (b, u, t) => { b.emit({ type: 'projectile', unit: u, target: t, element: 'fire', big: true }); b.deal(u, t, 1.5 * u.atk, 'fire'); b.apply(u, t, 'burn'); }),
  wing_gust: ab((b, u) => { const a = adjacentEnemies(b, u); return a.length ? [1, a[0]] : [0, null]; },
    (b, u, e) => { b.deal(u, e, 0.5 * u.atk, 'fire'); b.knockback(e, u.pos); }),
  inferno_breath: ab((b, u) => {
    const t = b.currentTarget(u);
    if (!t || D(u.pos, t.pos) > 3) return [0, null];
    const hits = b.enemies(u).filter((e) => D(u.pos, e.pos) <= 3 && D(t.pos, e.pos) <= 1);
    return [hits.length, { at: t.pos, hits }];
  }, (b, u, info) => {
    b.emit({ type: 'cone', unit: u, at: info.at, element: 'fire' });
    const steam = b.hasDuo(u.team, 'frostfire');
    for (const e of info.hits) if (e.alive) {
      b.deal(u, e, 3.0 * u.atk, 'fire'); b.apply(u, e, 'burn'); b.elementOnTile(e.pos, 'fire'); b.setOverlay(e.pos, steam ? 'steam' : 'lava', 4);
    }
  }, 1, 3),
  meteor_dive: ab((b, u) => {
    const [n, center] = enemyCluster(b, u, 4, 1);
    if (!center) return [0, null];
    if (D(u.pos, center.pos) > 1 && !freeNeighborToward(b, center, u.pos)) return [0, null];
    return [n + (center.hpf < 0.4 ? 1 : 0), center];
  }, (b, u, c) => {
    if (D(u.pos, c.pos) > 1) { const p = freeNeighborToward(b, c, u.pos); if (p) b.moveTo(u, p, 'leap'); }
    b.apply(u, u, 'invis', 1.0);
    b.emit({ type: 'impact', pos: c.pos, element: 'fire', radius: 1 });
    for (const e of b.enemies(u)) if (D(c.pos, e.pos) <= 1) { b.deal(u, e, 2.8 * u.atk, 'fire'); b.apply(u, e, 'burn'); }
    b.setOverlay(c.pos, 'lava', 4);
  }, 1, 2),
  warm_embers: ab((b, u) => {
    const engaged = b.allies(u).filter((a) => a !== u && inRangeTarget(b, a));
    if (!engaged.length) return [0, null];
    return [1, engaged.reduce((m, a) => (a.atk * a.aspd > m.atk * m.aspd ? a : m))];
  }, (b, u, a) => b.buff(a, 'aspd', 0.2, 4)),
  cauterize: ab((b, u) => {
    const a = mostWounded(b, u, 4);
    if (!a) return [0, null];
    return [(1 - a.hpf) + (b.has(a, 'chill') || b.has(a, 'soak') ? 0.3 : 0), a];
  }, (b, u, a) => { b.heal(u, a, 0.15); b.clear(a, 'chill', 'soak'); }, 0.25),
  sunflare: ab((b, u) => {
    const engaged = b.allies(u).filter((a) => inRangeTarget(b, a)).length;
    const near = b.enemies(u).filter((e) => D(u.pos, e.pos) <= 2).length;
    return [engaged + 0.5 * near, null];
  }, (b, u) => {
    b.emit({ type: 'impact', pos: u.pos, element: 'fire', radius: 2 });
    for (const a of b.allies(u)) b.buff(a, 'dmg', 0.3, 5);
    for (const e of b.enemies(u)) if (D(u.pos, e.pos) <= 2) b.apply(u, e, 'burn');
  }, 1, 4),
  // ---------- Water ----------
  tidal_charge: ab((b, u) => { const t = b.currentTarget(u); return t && D(u.pos, t.pos) <= 3 ? [1, t] : [0, null]; },
    (b, u, t) => {
      if (D(u.pos, t.pos) > 1) { const p = freeNeighborToward(b, t, u.pos); if (p) b.moveTo(u, p, 'dash'); }
      b.deal(u, t, 1.0 * u.atk, 'water'); b.apply(u, t, 'stun', 1.0); b.apply(u, t, 'soak');
    }),
  brace: ab((b, u) => (u.hpf < 0.8 ? [b.attackers(u), null] : [0, null]), (b, u) => { b.buff(u, 'taken', -0.4, 3); stonewall(b, u); }, 2),
  riptide: ab((b, u) => { const h = b.enemies(u).filter((e) => D(u.pos, e.pos) <= 2); return [h.length, h]; },
    (b, u, hits) => {
      b.emit({ type: 'impact', pos: u.pos, element: 'water', radius: 2 });
      for (const e of hits) if (e.alive) { b.pull(e, u.pos); b.deal(u, e, 0.8 * u.atk, 'water'); b.apply(u, e, 'soak'); }
    }, 1, 3),
  bubble: ab((b, u) => {
    const c = b.allies(u).filter((a) => a.hpf < 0.85 && b.attackers(a) && D(u.pos, a.pos) <= 4);
    if (!c.length) return [0, null];
    const a = c.reduce((m, x) => (x.hpf < m.hpf ? x : m));
    return [1 + (1 - a.hpf), a];
  }, (b, u, a) => b.addShield(a, 200, 4, u)),
  splash: ab((b, u) => enemyCluster(b, u, b.rangeOf(u), 1),
    (b, u, c) => {
      b.emit({ type: 'projectile', unit: u, target: c, element: 'water' });
      for (const e of b.enemies(u)) if (D(c.pos, e.pos) <= 1) { b.deal(u, e, 0.6 * u.atk, 'water'); b.apply(u, e, 'soak'); }
    }),
  wellspring: ab((b, u) => {
    const [n, c] = allyCluster(b, u, 3, 2);
    if (!c) return [0, null];
    return [n + 0.5 * b.enemies(u).filter((e) => D(c.pos, e.pos) <= 2).length, c];
  }, (b, u, c) => {
    const at = c.pos;
    for (const p of hex.within(at, 2)) if (b.tile(p) !== 'icewall') b.setOverlay(p, 'river', 6);
    for (const a of b.allies(u)) if (D(at, a.pos) <= 2) b.addShield(a, 150, 4, u);
  }, 1, 3.5),
  // ---------- Ice ----------
  frostbite: ab((b, u) => { const t = inRangeTarget(b, u); return t ? [1, t] : [0, null]; },
    (b, u, t) => { b.deal(u, t, 1.4 * u.atk, 'ice'); b.apply(u, t, 'chill'); }),
  blizzard_veil: ab((b, u) => {
    const t = b.currentTarget(u);
    const back = b.enemies(u).filter((e) => isBackline(e) && b.targetable(u, e));
    if (!back.length || back.includes(t)) return [0, null];
    const e = back.reduce((m, x) => (x.hpf < m.hpf ? x : m));
    return freeNeighborToward(b, e, u.pos) ? [1, e] : [0, null];
  }, (b, u, e) => { const p = freeNeighborToward(b, e, u.pos); if (p) b.moveTo(u, p, 'blink'); b.apply(u, u, 'invis', 2); u.target = e; }),
  avalanche_pounce: ab((b, u) => {
    const c = b.enemies(u).filter((e) => b.targetable(u, e) && D(u.pos, e.pos) <= 4);
    if (!c.length) return [0, null];
    const e = c.reduce((m, x) => (x.hp + x.shield < m.hp + m.shield ? x : m));
    if (D(u.pos, e.pos) > 1 && !freeNeighborToward(b, e, u.pos)) return [0, null];
    return e.hp + e.shield <= b.estimate(u, e, 3.5 * u.atk) ? [3, e] : [1 + (1 - e.hpf), e];
  }, (b, u, e) => {
    if (D(u.pos, e.pos) > 1) { const p = freeNeighborToward(b, e, u.pos); if (p) b.moveTo(u, p, 'leap'); }
    b.emit({ type: 'impact', pos: e.pos, element: 'ice', radius: 0 });
    if (b.deal(u, e, 3.5 * u.atk, 'ice')) u.smeter = Math.min(100, u.smeter + 50);
  }, 1, 3),
  snowdrift: ab((b, u) => enemyCluster(b, u, b.rangeOf(u), 1),
    (b, u, c) => {
      b.emit({ type: 'impact', pos: c.pos, element: 'ice', radius: 1 });
      for (const e of b.enemies(u)) if (D(c.pos, e.pos) <= 1) { b.deal(u, e, 0.5 * u.atk, 'ice'); b.apply(u, e, 'chill'); }
    }),
  ice_wall: ab((b, u) => {
    for (const e of b.enemies(u)) {
      if (e.baseRange === 1 && e.target && isBackline(e.target) && D(e.pos, e.target.pos) >= 2 && D(e.pos, e.target.pos) <= 3) {
        const cells = hex.neighbors(e.pos).filter((p) => b.free(p));
        if (cells.length) return [1, cells.reduce((m, p) => (D(p, e.target.pos) < D(m, e.target.pos) ? p : m))];
      }
    }
    return [0, null];
  }, (b, u, p) => { if (b.free(p)) b.setOverlay(p, 'icewall', 4); }),
  whiteout: ab((b, u) => {
    const [n, c] = enemyCluster(b, u, b.rangeOf(u), 2);
    if (!c) return [0, null];
    return [n + 0.5 * b.enemies(u).filter((e) => D(c.pos, e.pos) <= 2 && b.has(e, 'chill')).length, c];
  }, (b, u, c) => {
    b.emit({ type: 'impact', pos: c.pos, element: 'ice', radius: 2 });
    for (const e of b.enemies(u)) if (D(c.pos, e.pos) <= 2) b.apply(u, e, 'freeze', b.has(e, 'chill') ? 2.5 : 1.5);
    for (const p of hex.within(c.pos, 2)) b.elementOnTile(p, 'ice');
  }, 1, 3),
  // ---------- Electric ----------
  spark_shot: ab((b, u) => { const t = inRangeTarget(b, u); return t ? [1, t] : [0, null]; },
    (b, u, t) => {
      b.emit({ type: 'bolt', unit: u, target: t });
      b.deal(u, t, 1.0 * u.atk, 'electric'); b.apply(u, t, 'shock');
      const others = b.enemies(u).filter((e) => e !== t && D(t.pos, e.pos) <= 2).sort((x, y) => D(t.pos, x.pos) - D(t.pos, y.pos)).slice(0, 1);
      for (const e of others) { b.emit({ type: 'chain', unit: u, from: t, target: e }); b.deal(u, e, 0.6 * u.atk, 'electric'); b.apply(u, e, 'shock'); }
    }),
  zip: ab((b, u) => (adjacentEnemies(b, u).length ? [1, null] : [0, null]),
    (b, u) => {
      const enemies = b.enemies(u), cells = hex.within(u.pos, 2).filter((p) => b.free(p));
      if (cells.length && enemies.length) {
        const score = (p) => Math.min(...enemies.map((e) => D(p, e.pos)));
        b.moveTo(u, cells.reduce((m, p) => (score(p) > score(m) ? p : m)), 'dash');
      }
    }),
  thunderstorm: ab((b, u) => {
    const hits = b.enemies(u).filter((e) => b.targetable(u, e)).sort((x, y) => y.hp - x.hp).slice(0, 3);
    return [hits.length + hits.filter((e) => b.has(e, 'soak')).length, hits];
  }, (b, u, hits) => {
    for (const e of hits) if (e.alive) {
      b.emit({ type: 'lightning', pos: e.pos }); b.deal(u, e, 1.6 * u.atk, 'electric'); b.apply(u, e, 'shock'); b.setOverlay(e.pos, 'charged', 4);
    }
  }, 1, 4),
  thunder_claw: ab((b, u) => { const t = inRangeTarget(b, u); return t ? [1, t] : [0, null]; },
    (b, u, t) => { b.deal(u, t, 1.8 * u.atk, 'electric'); b.apply(u, t, 'shock'); }),
  lightning_dash: ab((b, u) => {
    if (inRangeTarget(b, u)) return [0, null];
    const c = b.enemies(u).filter((e) => D(u.pos, e.pos) > 1 && D(u.pos, e.pos) <= 3 && b.targetable(u, e) && freeNeighborToward(b, e, u.pos));
    if (!c.length) return [0, null];
    return [1, c.reduce((m, e) => (D(u.pos, e.pos) < D(u.pos, m.pos) ? e : m))];
  }, (b, u, e) => {
    const p = freeNeighborToward(b, e, u.pos); if (p) b.moveTo(u, p, 'dash');
    u.target = e; b.deal(u, e, 0.5 * u.atk, 'electric'); b.apply(u, e, 'stun', 0.5);
  }),
  stormcall: ab((b, u) => (adjacentEnemies(b, u).length ? [1 + (u.hpf > 0.4 ? 1 : 0), null] : [0, null]),
    (b, u) => { b.buff(u, 'aspd', 0.5, 6); u.chainUntil = b.t + 6; u.chainCount = 1; }, 1, 2),
  storm_avatar: ab((b, u) => (adjacentEnemies(b, u).length ? [1 + (u.hpf > 0.4 ? 1 : 0), null] : [0, null]),
    (b, u) => { b.buff(u, 'aspd', 0.5, 6); u.chainUntil = b.t + 6; u.chainCount = 2; }, 1, 2),
  // ---------- Earth ----------
  quake_stomp: ab((b, u) => { const a = adjacentEnemies(b, u); return [a.length, a]; },
    (b, u, adj) => {
      b.emit({ type: 'impact', pos: u.pos, element: 'earth', radius: 1 });
      const volcano = b.hasDuo(u.team, 'living_volcano');
      for (const e of adj) if (e.alive) { b.deal(u, e, 0.6 * u.atk, 'earth'); b.apply(u, e, 'crack'); if (volcano) b.apply(u, e, 'burn'); }
    }),
  stone_skin: ab((b, u) => (u.hpf < 0.75 && b.attackers(u) ? [1, null] : [0, null]), (b, u) => { b.addShield(u, 0.25 * u.baseHp, 5, u); stonewall(b, u); }),
  tectonic_rise: ab((b, u) => { const h = b.enemies(u).filter((e) => D(u.pos, e.pos) <= 2); return [h.length, h]; },
    (b, u, hits) => {
      b.emit({ type: 'impact', pos: u.pos, element: 'earth', radius: 2 });
      for (const p of hex.within(u.pos, 1)) if (b.tile(p) !== 'icewall') b.setOverlay(p, 'high', 5);
      for (const e of hits) if (e.alive) b.apply(u, e, 'taunt', 2);
    }, 1, 3),
  bloom: ab((b, u) => { const a = mostWounded(b, u, 4); return a ? [1 - a.hpf, a] : [0, null]; }, (b, u, a) => b.heal(u, a, 0.2), 0.3),
  thornroot: ab((b, u) => {
    for (const e of b.enemies(u)) if (e.target && e.target.team === u.team && isBackline(e.target)
      && D(u.pos, e.pos) <= b.rangeOf(u) && b.targetable(u, e) && !b.has(e, 'root')) return [1, e];
    return [0, null];
  }, (b, u, e) => b.apply(u, e, 'root', 1.5)),
  // ---------- new aimed Specials ----------
  tidal_wave: ab((b, u) => bestLine(b, u, 3), (b, u, info) => {
    b.emit({ type: 'wave', unit: u, tiles: info.tiles, element: 'water' });
    for (const t of info.tiles) if (b.tile(t) !== 'icewall' && b.tile(t) !== 'high') b.setOverlay(t, 'river', 4);
    for (const e of info.hits) if (e.alive) {
      b.deal(u, e, 1.1 * u.atk, 'water'); b.apply(u, e, 'soak');
      if (b.hasDuo(u.team, 'storm_surge')) b.apply(u, e, 'shock');
      else if (b.hasDuo(u.team, 'glacial_tide')) b.apply(u, e, 'chill');
      if (e.alive) b.knockback(e, u.pos);
    }
  }, 1, 2),
  lightning_lance: ab((b, u) => bestLine(b, u, 4), (b, u, info) => {
    const end = info.tiles[info.tiles.length - 1];
    b.emit({ type: 'lance', unit: u, to: end });
    for (const e of info.hits) if (e.alive) { b.deal(u, e, 1.8 * u.atk, 'electric'); b.apply(u, e, 'shock'); }
    for (const t of info.tiles) b.setOverlay(t, 'charged', 3);
  }, 1, 2),
  // ---------- element moves (a third active ability each creature can learn) ----------
  ember_burst: ab((b, u) => enemyCluster(b, u, Math.max(b.rangeOf(u), 2), 1), (b, u, c) => {
    b.emit({ type: 'impact', pos: c.pos, element: 'fire', radius: 1 });
    for (const e of b.enemies(u)) if (D(c.pos, e.pos) <= 1) { b.deal(u, e, 0.8 * u.atk, 'fire'); b.apply(u, e, 'burn'); }
  }),
  aqua_jet: ab((b, u) => { const t = b.currentTarget(u); return t && D(u.pos, t.pos) <= Math.max(b.rangeOf(u), 3) ? [1, t] : [0, null]; },
    (b, u, t) => { b.emit({ type: 'projectile', unit: u, target: t, element: 'water' }); b.deal(u, t, 1.2 * u.atk, 'water'); b.apply(u, t, 'soak'); }),
  frost_shard: ab((b, u) => { const t = b.currentTarget(u); return t && D(u.pos, t.pos) <= Math.max(b.rangeOf(u), 3) ? [1, t] : [0, null]; },
    (b, u, t) => { b.emit({ type: 'projectile', unit: u, target: t, element: 'ice' }); b.deal(u, t, 1.2 * u.atk, 'ice'); b.apply(u, t, 'chill'); }),
  static_field: ab((b, u) => { const n = b.enemies(u).filter((e) => D(u.pos, e.pos) <= 1).length; return [n, null]; },
    (b, u) => {
      b.emit({ type: 'impact', pos: u.pos, element: 'electric', radius: 1 });
      for (const e of b.enemies(u)) if (D(u.pos, e.pos) <= 1) { b.deal(u, e, 0.7 * u.atk, 'electric'); b.apply(u, e, 'shock'); }
    }),
  rock_throw: ab((b, u) => { const t = b.currentTarget(u); return t && D(u.pos, t.pos) <= Math.max(b.rangeOf(u), 3) ? [1, t] : [0, null]; },
    (b, u, t) => { b.emit({ type: 'projectile', unit: u, target: t, element: 'earth', big: true }); b.deal(u, t, 1.3 * u.atk, 'earth'); b.apply(u, t, 'crack'); }),
  sanctuary_grove: ab((b, u) => {
    const [n, c] = allyCluster(b, u, 3, 2);
    if (!c) return [0, null];
    return [n + 0.5 * b.allies(u).filter((a) => D(c.pos, a.pos) <= 2 && a.hpf < 0.8).length, c];
  }, (b, u, c) => {
    for (const p of hex.within(c.pos, 2)) if (b.tile(p) === 'plain') b.setOverlay(p, 'brush', 8);
    for (const a of b.allies(u)) if (D(c.pos, a.pos) <= 2) b.apply(u, a, 'regen', 6);
  }, 1, 4),
};

// ---------- aiming ----------
// How the player aims each Special. shape: line | cone | circle | single | self.
export const AIM = {
  inferno_breath: { shape: 'cone', range: 3 },
  meteor_dive: { shape: 'circle', range: 4, radius: 1 },
  sunflare: { shape: 'self', radius: 2 },
  tidal_wave: { shape: 'line', length: 3 },
  wellspring: { shape: 'circle', range: 3, radius: 2, ally: true },
  avalanche_pounce: { shape: 'single', range: 4 },
  whiteout: { shape: 'circle', range: 3, radius: 2 },
  lightning_lance: { shape: 'line', length: 4 },
  stormcall: { shape: 'self', radius: 0 },
  storm_avatar: { shape: 'self', radius: 0 },
  tectonic_rise: { shape: 'self', radius: 2 },
  sanctuary_grove: { shape: 'circle', range: 3, radius: 2, ally: true },
};

/** Tiles a Special would affect if aimed at `pos` (for the on-board preview). */
export function aimTiles(b, u, pos) {
  const a = AIM[u.special];
  if (!a) return [];
  if (a.shape === 'self') return hex.within(u.pos, a.radius);
  if (a.shape === 'line') return hex.ray(u.pos, pos, a.length);
  if (a.shape === 'cone') {
    const d = hex.ray(u.pos, pos, 2).pop();
    return d ? hex.within(u.pos, a.range).filter((t) => D(d, t) <= 1 && !hex.same(t, u.pos)) : [];
  }
  const c = clampTo(u.pos, pos, a.range);
  return a.shape === 'single' ? [c] : hex.within(c, a.radius);
}
function clampTo(from, pos, range) {
  if (D(from, pos) <= range) return pos;
  const r = hex.ray(from, pos, range);
  return r.length ? r[r.length - 1] : from;
}

/** Turn a player's aim into the info object the Special's cast() expects (null = invalid aim). */
export function aimInfo(b, u, pos) {
  const a = AIM[u.special];
  if (!a || a.shape === 'self') return ABILITIES[u.special].value(b, u)[1] ?? {};
  if (a.shape === 'line') return lineInfo(b, u, pos, a.length);
  if (a.shape === 'cone') {
    const tiles = aimTiles(b, u, pos);
    return { at: pos, hits: b.enemies(u).filter((e) => tiles.some((t) => hex.same(t, e.pos))) };
  }
  const c = clampTo(u.pos, pos, a.range);
  if (a.shape === 'single') {
    const e = b.enemies(u).filter((x) => D(x.pos, c) <= 1).sort((x, y) => D(x.pos, c) - D(y.pos, c))[0];
    if (!e || (D(u.pos, e.pos) > 1 && !freeNeighborToward(b, e, u.pos))) return null;
    return e;
  }
  if (u.special === 'meteor_dive' && D(u.pos, c) > 1 && !hex.neighbors(c).some((p) => b.free(p))) return null;
  return { pos: c };
}

// ---------- trainer abilities ----------
export const REVIVE_UNLOCK = 45;
const alive = (b, team) => b.teamAlive(team);
export const TRAINER = {
  rally: { name: 'Rally', cost: 3, targeted: false, desc: '+25% damage to your whole team for 5s',
    valid: (b, team) => (alive(b, team).length ? [null] : []),
    use: (b, team) => { for (const a of alive(b, team)) b.buff(a, 'dmg', 0.25, 5); } },
  mend: { name: 'Mend', cost: 4, targeted: true, desc: 'Heal one creature 40%',
    valid: (b, team) => alive(b, team).filter((a) => a.hpf < 1), use: (b, team, a) => b.heal(null, a, 0.4) },
  shield: { name: 'Shield', cost: 4, targeted: true, desc: 'Shield one creature (30% HP) for 6s',
    valid: (b, team) => alive(b, team), use: (b, team, a) => b.addShield(a, 0.3 * a.baseHp, 6) },
  overcharge: { name: 'Overcharge', cost: 5, targeted: true, desc: "Fill one creature's Special instantly",
    valid: (b, team) => alive(b, team).filter((a) => a.special && a.smeter < 100), use: (b, team, a) => { a.smeter = 100; } },
  revive: { name: 'Revive', cost: 10, targeted: true, desc: `Bring back a fallen creature at 20% HP (once, after ${REVIVE_UNLOCK}s)`,
    valid: (b, team) => (b.reviveUsed[team] || b.t < REVIVE_UNLOCK ? [] : b.teamDead(team)), use: (b, team, a) => b.revive(a, 0.2) },
};
export const DEFAULT_KIT = ['rally', 'mend', 'revive'];
