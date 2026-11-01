// Combat 3.0 ability cards. Each creature brings a skill card and an ultimate card into the team's
// shared deck; the trainer adds two. Cards cost shared energy and are aimed on the board.
//
// shape:  circle (area dropped on a tile) | cone | line | single (one creature) | leap (caster jumps
//         to an area) | wall | self (area around the caster) | none (no aiming)
// origin: 'caster' (range measured from the creature) | 'map' (anywhere on the board)
// target: who a single-target card can pick: 'enemy' | 'ally'
// aim:    {tile:[c,r]} for areas, {point:[x,z]} for cones/lines, {uid} for single, {} for none/self
import * as hex from './hex.js';
import * as G from './geom.js';

const D = hex.dist;

// ---------- helpers ----------
function bestCluster(b, u, pool, radius, rangeFrom = null, range = 99) {
  let best = [0, null];
  for (const t of pool) {
    if (rangeFrom && D(rangeFrom, t.pos) > range) continue;
    const n = pool.filter((o) => D(t.pos, o.pos) <= radius).length;
    if (n > best[0]) best = [n, t.pos];
  }
  return best;
}
function freeNear(b, tile, from) {
  if (b.free(tile)) return tile;
  const cells = hex.neighbors(tile).filter((p) => b.free(p));
  return cells.length ? cells.reduce((m, p) => (D(p, from) < D(m, from) ? p : m)) : null;
}
const enemiesIn = (b, u, tiles) => b.enemies(u).filter((e) => tiles.some((t) => hex.same(t, e.pos)));
const alliesIn = (b, u, tiles) => b.allies(u).filter((e) => tiles.some((t) => hex.same(t, e.pos)));
const unitByUid = (b, uid) => b.units.find((x) => x.uid === uid);
function bestDirection(b, u, tilesFor) {
  let best = [0, null];
  for (const e of b.enemies(u)) {
    const point = G.tileXZ(e.pos), hits = enemiesIn(b, u, tilesFor(point)).length;
    if (hits > best[0]) best = [hits, { point }];
  }
  return best;
}
function leapTo(b, u, tile, kind = 'leap') {
  const dest = freeNear(b, tile, u.pos);
  if (dest && !hex.same(dest, u.pos)) b.moveTo(u, dest, kind);
}

function card(def) { return { castTime: 0.35, origin: 'caster', range: 4, radius: 1, ...def }; }

export const CARDS = {
  // ================= Fire =================
  ember_burst: card({ name: 'Ember Burst', glyph: 'flame', element: 'fire', cost: 3, kind: 'skill', shape: 'circle', range: 5, radius: 1,
    desc: 'Drops a fire explosion on an area: 90% damage and Burn to every enemy inside.',
    ai: (b, u) => { const [n, t] = bestCluster(b, u, b.enemies(u), 1, u.pos, 5); return [n, t && { tile: t }]; },
    resolve: (b, u, aim, tiles) => {
      b.emit({ type: 'impact', pos: aim.tile, element: 'fire', radius: 1 });
      for (const e of enemiesIn(b, u, tiles)) { b.deal(u, e, 0.9 * u.atk, 'fire'); b.apply(u, e, 'burn'); }
    } }),
  inferno_breath: card({ name: 'Inferno Breath', glyph: 'cone', element: 'fire', cost: 6, kind: 'ult', shape: 'cone', range: 3, angle: 70, castTime: 0.7,
    desc: 'Breathes a cone of fire from its mouth: 220% damage, Burn, and the ground turns to lava.',
    ai: (b, u) => bestDirection(b, u, (pt) => G.tilesInCone(u.pos, pt, 3, 70)),
    resolve: (b, u, aim, tiles) => {
      b.emit({ type: 'cone', unit: u, point: aim.point, element: 'fire' });
      const steam = b.hasDuo(u.team, 'frostfire');
      for (const e of enemiesIn(b, u, tiles)) { b.deal(u, e, 2.2 * u.atk, 'fire'); b.apply(u, e, 'burn'); }
      for (const t of tiles) { b.elementOnTile(t, 'fire'); if (b.tile(t) === 'plain') b.setOverlay(t, steam ? 'steam' : 'lava', 4); }
    } }),
  meteor_dive: card({ name: 'Meteor Dive', glyph: 'meteor', element: 'fire', cost: 6, kind: 'ult', shape: 'leap', range: 4, radius: 1, castTime: 0.5,
    desc: 'Leaps into the air and slams down on an area: 220% damage and Burn around the landing, lava at the center.',
    ai: (b, u) => { const [n, t] = bestCluster(b, u, b.enemies(u), 1, u.pos, 4); return [n, t && { tile: t }]; },
    resolve: (b, u, aim, tiles) => {
      leapTo(b, u, aim.tile);
      b.emit({ type: 'impact', pos: aim.tile, element: 'fire', radius: 1 });
      for (const e of enemiesIn(b, u, tiles)) { b.deal(u, e, 2.2 * u.atk, 'fire'); b.apply(u, e, 'burn'); }
      if (b.tile(aim.tile) === 'plain') b.setOverlay(aim.tile, 'lava', 4);
    } }),
  kindle: card({ name: 'Kindle', glyph: 'haste', element: 'fire', cost: 3, kind: 'skill', shape: 'none',
    desc: 'All your creatures attack 25% faster for 5s.',
    ai: (b, u) => [b.allies(u).filter((a) => a.target && hex.dist(a.pos, a.target.pos) <= b.rangeOf(a)).length / 2, {}],
    resolve: (b, u) => { for (const a of b.allies(u)) b.buff(a, 'aspd', 0.25, 5); b.emit({ type: 'impact', pos: u.pos, element: 'fire', radius: 0 }); } }),
  sunflare: card({ name: 'Sunflare', glyph: 'sun', element: 'fire', cost: 5, kind: 'ult', shape: 'self', radius: 2, castTime: 0.6,
    desc: 'Bursts with light: allies deal +30% damage for 5s; enemies within 2 tiles take 100% damage and Burn.',
    ai: (b, u) => [b.enemies(u).filter((e) => D(u.pos, e.pos) <= 2).length + b.allies(u).length * 0.3, {}],
    resolve: (b, u, aim, tiles) => {
      b.emit({ type: 'impact', pos: u.pos, element: 'fire', radius: 2 });
      for (const a of b.allies(u)) b.buff(a, 'dmg', 0.3, 5);
      for (const e of enemiesIn(b, u, tiles)) { b.deal(u, e, 1.0 * u.atk, 'fire'); b.apply(u, e, 'burn'); }
    } }),
  // ================= Water =================
  tidal_charge: card({ name: 'Tidal Charge', glyph: 'charge', element: 'water', cost: 3, kind: 'skill', shape: 'single', target: 'enemy', range: 3,
    desc: 'Charges an enemy within 3 tiles: 100% damage, stun 1s, Soak.',
    ai: (b, u) => { const t = b.enemies(u).filter((e) => D(u.pos, e.pos) <= 3).sort((a, c) => c.atk - a.atk)[0]; return [t ? 1.2 : 0, t && { uid: t.uid }]; },
    resolve: (b, u, aim) => {
      const t = unitByUid(b, aim.uid); if (!t || !t.active) return;
      if (D(u.pos, t.pos) > 1) { const p = freeNear(b, hex.neighbors(t.pos).sort((a, c) => D(a, u.pos) - D(c, u.pos))[0] || t.pos, u.pos); if (p) b.moveTo(u, p, 'dash'); }
      b.deal(u, t, 1.0 * u.atk, 'water'); b.apply(u, t, 'stun', 1); b.apply(u, t, 'soak');
    } }),
  tidal_wave: card({ name: 'Tidal Wave', glyph: 'wave', element: 'water', cost: 5, kind: 'ult', shape: 'circle', origin: 'map', radius: 1, castTime: 0.6,
    desc: 'Summons a wave anywhere on the board: 120% damage, Soak, and pushes every enemy one tile back.',
    ai: (b, u) => { const [n, t] = bestCluster(b, u, b.enemies(u), 1); return [n, t && { tile: t }]; },
    resolve: (b, u, aim, tiles) => {
      b.emit({ type: 'wave', unit: u, tiles, element: 'water' });
      for (const t of tiles) if (b.tile(t) === 'plain') b.setOverlay(t, 'river', 4);
      const back = u.team === 0 ? 1 : -1;
      for (const e of enemiesIn(b, u, tiles)) {
        b.deal(u, e, 1.2 * u.atk, 'water'); b.apply(u, e, 'soak');
        if (b.hasDuo(u.team, 'storm_surge')) b.apply(u, e, 'shock');
        else if (b.hasDuo(u.team, 'glacial_tide')) b.apply(u, e, 'chill');
        if (e.active) b.pushRows(e, back);
      }
    } }),
  bubble: card({ name: 'Bubble', glyph: 'shield', element: 'water', cost: 3, kind: 'skill', shape: 'single', target: 'ally', origin: 'map',
    desc: 'Wraps one of your creatures in a bubble that absorbs 18% of its max HP for 5s.',
    ai: (b, u) => { const t = b.allies(u).filter((a) => a.hpf < 0.7 && b.attackers(a)).sort((a, c) => a.hpf - c.hpf)[0]; return [t ? 1.5 - t.hpf : 0, t && { uid: t.uid }]; },
    resolve: (b, u, aim) => { const t = unitByUid(b, aim.uid); if (t && t.active) b.addShield(t, 0.18 * t.baseHp * b.hpScale, 5, u); } }),
  wellspring: card({ name: 'Wellspring', glyph: 'spring', element: 'water', cost: 5, kind: 'ult', shape: 'circle', origin: 'map', radius: 2, castTime: 0.6,
    desc: 'Floods an area: tiles become river for 6s, allies inside get a shield and regenerate.',
    ai: (b, u) => { const [n, t] = bestCluster(b, u, b.allies(u), 2); return [n * 0.7 + (b.allies(u).some((a) => a.hpf < 0.5) ? 1 : 0), t && { tile: t }]; },
    resolve: (b, u, aim, tiles) => {
      for (const t of tiles) if (b.tile(t) !== 'icewall' && b.tile(t) !== 'high') b.setOverlay(t, 'river', 6);
      for (const a of alliesIn(b, u, tiles)) { b.addShield(a, 0.1 * a.baseHp * b.hpScale, 5, u); b.apply(u, a, 'regen', 6); }
      b.emit({ type: 'impact', pos: aim.tile, element: 'water', radius: 2 });
    } }),
  // ================= Ice =================
  frost_shard: card({ name: 'Frost Shard', glyph: 'shard', element: 'ice', cost: 2, kind: 'skill', shape: 'single', target: 'enemy', range: 4,
    desc: 'Fires an ice shard at an enemy within 4 tiles: 120% damage and 2 stacks of Chill.',
    ai: (b, u) => { const t = b.enemies(u).filter((e) => D(u.pos, e.pos) <= 4).sort((a, c) => a.hp - c.hp)[0]; return [t ? 1.1 : 0, t && { uid: t.uid }]; },
    resolve: (b, u, aim) => {
      const t = unitByUid(b, aim.uid); if (!t || !t.active) return;
      b.emit({ type: 'projectile', unit: u, target: t, element: 'ice', big: true });
      b.deal(u, t, 1.2 * u.atk, 'ice'); b.apply(u, t, 'chill'); if (t.active) b.apply(u, t, 'chill');
    } }),
  avalanche_pounce: card({ name: 'Avalanche Pounce', glyph: 'claw', element: 'ice', cost: 5, kind: 'ult', shape: 'single', target: 'enemy', range: 5, castTime: 0.5,
    desc: 'Execute: leaps onto an enemy for 250% damage, doubled if it is below 35% HP. A kill refunds 3 energy.',
    ai: (b, u) => {
      const c = b.enemies(u).filter((e) => D(u.pos, e.pos) <= 5);
      if (!c.length) return [0, null];
      const t = c.reduce((m, e) => (e.hpf < m.hpf ? e : m));
      return [t.hpf < 0.35 ? 3 : 1 + (1 - t.hpf), { uid: t.uid }];
    },
    resolve: (b, u, aim) => {
      const t = unitByUid(b, aim.uid); if (!t || !t.active) return;
      const p = freeNear(b, hex.neighbors(t.pos).sort((a, c) => D(a, u.pos) - D(c, u.pos))[0] || t.pos, u.pos);
      if (p && D(u.pos, t.pos) > 1) b.moveTo(u, p, 'leap');
      b.emit({ type: 'impact', pos: t.pos, element: 'ice', radius: 0 });
      const mult = t.hpf < 0.35 ? 5 : 2.5;
      if (b.deal(u, t, mult * u.atk, 'ice')) { b.energy[u.team] = Math.min(b.energyCap, b.energy[u.team] + 3); b.emit({ type: 'execute', unit: t }); }
    } }),
  ice_wall: card({ name: 'Ice Wall', glyph: 'wall', element: 'ice', cost: 2, kind: 'skill', shape: 'wall', origin: 'map',
    desc: 'Raises a wall of ice (3 tiles) anywhere for 5s. Blocks movement; enemies next to it are Chilled.',
    ai: (b, u) => {
      for (const e of b.enemies(u)) if (e.baseRange === 1 && e.target && e.target.baseRange > 1 && D(e.pos, e.target.pos) >= 2) {
        const mid = hex.line(e.pos, e.target.pos)[1];
        if (mid && b.free(mid)) return [1.2, { tile: mid }];
      }
      return [0, null];
    },
    resolve: (b, u, aim, tiles) => {
      for (const t of tiles) if (b.free(t)) b.setOverlay(t, 'icewall', 5);
      for (const e of b.enemies(u)) if (tiles.some((t) => D(t, e.pos) === 1)) b.apply(u, e, 'chill');
    } }),
  whiteout: card({ name: 'Whiteout', glyph: 'snow', element: 'ice', cost: 6, kind: 'ult', shape: 'circle', range: 5, radius: 2, castTime: 0.7,
    desc: 'A blizzard on an area within 5 tiles: Freezes every enemy inside for 1.5s (2.5s if already Chilled).',
    ai: (b, u) => { const [n, t] = bestCluster(b, u, b.enemies(u), 2, u.pos, 5); return [n, t && { tile: t }]; },
    resolve: (b, u, aim, tiles) => {
      b.emit({ type: 'impact', pos: aim.tile, element: 'ice', radius: 2 });
      for (const e of enemiesIn(b, u, tiles)) b.apply(u, e, 'freeze', b.has(e, 'chill') ? 2.5 : 1.5);
      for (const t of tiles) b.elementOnTile(t, 'ice');
    } }),
  // ================= Electric =================
  static_charge: card({ name: 'Static Charge', glyph: 'chain', element: 'electric', cost: 3, kind: 'skill', shape: 'none',
    desc: "For 6s, this creature's attacks are 30% faster, Shock, and zap the 2 enemies closest to its target.",
    ai: (b, u) => [u.target && u.target.active && D(u.pos, u.target.pos) <= b.rangeOf(u) ? 1.2 : 0, {}],
    resolve: (b, u) => { b.buff(u, 'aspd', 0.3, 6); u.chainUntil = b.t + 6; u.chainCount = 2; u.chainShock = true; b.emit({ type: 'impact', pos: u.pos, element: 'electric', radius: 0 }); } }),
  lightning_lance: card({ name: 'Lightning Lance', glyph: 'bolt', element: 'electric', cost: 5, kind: 'ult', shape: 'line', length: 6, castTime: 0.6,
    desc: 'A bolt in a straight line: 180% damage and Shock to every enemy it pierces; the tiles stay charged.',
    ai: (b, u) => bestDirection(b, u, (pt) => G.tilesInLine(u.pos, pt, 6)),
    resolve: (b, u, aim, tiles) => {
      b.emit({ type: 'lance', unit: u, to: tiles.length ? tiles[tiles.length - 1] : u.pos });
      for (const e of enemiesIn(b, u, tiles)) { b.deal(u, e, 1.8 * u.atk, 'electric'); b.apply(u, e, 'shock'); }
      for (const t of tiles) if (b.tile(t) === 'plain') b.setOverlay(t, 'charged', 3);
    } }),
  lightning_dash: card({ name: 'Lightning Dash', glyph: 'dash', element: 'electric', cost: 3, kind: 'skill', shape: 'single', target: 'enemy', range: 4,
    desc: 'Dashes to an enemy within 4 tiles: 120% damage, Shock and stun 0.6s.',
    ai: (b, u) => { const t = b.enemies(u).filter((e) => D(u.pos, e.pos) <= 4 && e.baseRange > 1)[0] || b.enemies(u).filter((e) => D(u.pos, e.pos) <= 4)[0]; return [t ? 1.1 : 0, t && { uid: t.uid }]; },
    resolve: (b, u, aim) => {
      const t = unitByUid(b, aim.uid); if (!t || !t.active) return;
      const p = freeNear(b, hex.neighbors(t.pos).sort((a, c) => D(a, u.pos) - D(c, u.pos))[0] || t.pos, u.pos);
      if (p && D(u.pos, t.pos) > 1) b.moveTo(u, p, 'dash');
      u.target = t; b.deal(u, t, 1.2 * u.atk, 'electric'); b.apply(u, t, 'shock'); b.apply(u, t, 'stun', 0.6);
    } }),
  storm_leap: card({ name: 'Storm Leap', glyph: 'storm', element: 'electric', cost: 6, kind: 'ult', shape: 'leap', range: 4, radius: 1, castTime: 0.5,
    desc: 'Leaps to an area and becomes a living storm for 4s, shocking every enemy around it twice a second.',
    ai: (b, u) => { const [n, t] = bestCluster(b, u, b.enemies(u), 1, u.pos, 4); return [n, t && { tile: t }]; },
    resolve: (b, u, aim) => { leapTo(b, u, aim.tile); b.apply(u, u, 'storm', 4); b.emit({ type: 'impact', pos: u.pos, element: 'electric', radius: 1 }); } }),
  storm_avatar: card({ name: 'Storm Avatar', glyph: 'storm', element: 'electric', cost: 6, kind: 'ult', shape: 'leap', range: 4, radius: 1, castTime: 0.5,
    desc: 'Leaps to an area and becomes a storm for 5s: shocks everything around it and attacks 50% faster.',
    ai: (b, u) => { const [n, t] = bestCluster(b, u, b.enemies(u), 1, u.pos, 4); return [n, t && { tile: t }]; },
    resolve: (b, u, aim) => { leapTo(b, u, aim.tile); b.apply(u, u, 'storm', 5); b.buff(u, 'aspd', 0.5, 5); b.emit({ type: 'impact', pos: u.pos, element: 'electric', radius: 1 }); } }),
  // ================= Earth =================
  stone_skin: card({ name: 'Stone Skin', glyph: 'rock', element: 'earth', cost: 2, kind: 'skill', shape: 'none',
    desc: 'Covers itself in stone: a shield worth 20% of its max HP for 5s, and taunts adjacent enemies.',
    ai: (b, u) => [u.hpf < 0.75 && b.attackers(u) ? 1.3 : 0, {}],
    resolve: (b, u) => { b.addShield(u, 0.2 * u.baseHp * b.hpScale, 5, u); for (const e of b.enemies(u)) if (D(u.pos, e.pos) === 1) b.apply(u, e, 'taunt', 1.5); } }),
  tectonic_rise: card({ name: 'Tectonic Rise', glyph: 'quake', element: 'earth', cost: 5, kind: 'ult', shape: 'self', radius: 2, castTime: 0.6,
    desc: 'Raises the ground around itself: high ground for 5s, and every enemy within 2 tiles is Cracked and taunted.',
    ai: (b, u) => [b.enemies(u).filter((e) => D(u.pos, e.pos) <= 2).length, {}],
    resolve: (b, u, aim, tiles) => {
      b.emit({ type: 'impact', pos: u.pos, element: 'earth', radius: 2 });
      for (const p of hex.within(u.pos, 1)) if (b.tile(p) !== 'icewall') b.setOverlay(p, 'high', 5);
      for (const e of enemiesIn(b, u, tiles)) { b.apply(u, e, 'crack'); if (e.active) b.apply(u, e, 'taunt', 2.5); }
    } }),
  bloom: card({ name: 'Bloom', glyph: 'leaf', element: 'earth', cost: 3, kind: 'skill', shape: 'single', target: 'ally', origin: 'map',
    desc: 'Heals one of your creatures for 18% of its max HP and makes it regenerate.',
    ai: (b, u) => { const t = b.allies(u).sort((a, c) => a.hpf - c.hpf)[0]; return [t && t.hpf < 0.55 ? (1 - t.hpf) * 2 : 0, t && { uid: t.uid }]; },
    resolve: (b, u, aim) => { const t = unitByUid(b, aim.uid); if (t && t.active) { b.heal(u, t, 0.18 * b.hpScale); b.apply(u, t, 'regen', 5); } } }),
  sanctuary_grove: card({ name: 'Sanctuary Grove', glyph: 'tree', element: 'earth', cost: 5, kind: 'ult', shape: 'circle', origin: 'map', radius: 2, castTime: 0.6,
    desc: 'Grows a sacred grove on an area: brush that hides your creatures, and they heal over time inside.',
    ai: (b, u) => { const [n, t] = bestCluster(b, u, b.allies(u), 2); return [n * 0.6 + b.allies(u).filter((a) => a.hpf < 0.6).length * 0.5, t && { tile: t }]; },
    resolve: (b, u, aim, tiles) => {
      for (const t of tiles) if (b.tile(t) === 'plain') b.setOverlay(t, 'brush', 8);
      for (const a of alliesIn(b, u, tiles)) b.apply(u, a, 'regen', 8);
      b.emit({ type: 'impact', pos: aim.tile, element: 'earth', radius: 2 });
    } }),
  // ================= Trainer =================
  mend: card({ name: 'Mend', glyph: 'heart', element: 'trainer', cost: 4, kind: 'trainer', shape: 'single', target: 'ally', origin: 'map',
    desc: 'Trainer: heals one of your creatures for 30% of its max HP.',
    ai: (b, team) => { const t = b.teamAlive(team).sort((a, c) => a.hpf - c.hpf)[0]; return [t && t.hpf < 0.45 ? 2 : 0, t && { uid: t.uid }]; },
    resolve: (b, team, aim) => { const t = unitByUid(b, aim.uid); if (t && t.active) b.heal(null, t, 0.3 * b.hpScale); } }),
  rally: card({ name: 'Rally', glyph: 'banner', element: 'trainer', cost: 3, kind: 'trainer', shape: 'none',
    desc: 'Trainer: your whole team deals +25% damage for 5s.',
    ai: (b, team) => [b.teamAlive(team).filter((a) => a.target && a.target.active).length >= 3 ? 1.2 : 0, {}],
    resolve: (b, team) => { for (const a of b.teamAlive(team)) b.buff(a, 'dmg', 0.25, 5); } }),
  guard: card({ name: 'Guard', glyph: 'shield', element: 'trainer', cost: 3, kind: 'trainer', shape: 'single', target: 'ally', origin: 'map',
    desc: 'Trainer: shields one of your creatures for 25% of its max HP for 6s.',
    ai: (b, team) => { const t = b.teamAlive(team).filter((a) => b.attackers(a) >= 2).sort((a, c) => a.hpf - c.hpf)[0]; return [t && t.hpf < 0.6 ? 1.6 : 0, t && { uid: t.uid }]; },
    resolve: (b, team, aim) => { const t = unitByUid(b, aim.uid); if (t && t.active) b.addShield(t, 0.25 * t.baseHp * b.hpScale, 6); } }),
  revive: card({ name: 'Revive', glyph: 'phoenix', element: 'trainer', cost: 7, kind: 'trainer', shape: 'none', once: true,
    desc: 'Trainer: brings back your strongest fallen creature at 30% HP. Once per fight.',
    ai: (b, team) => [b.teamDead(team).length && b.teamAlive(1 - team).length >= 2 ? 2 : 0, {}],
    resolve: (b, team) => { const d = b.teamDead(team).sort((a, c) => c.atk * c.aspd - a.atk * a.aspd)[0]; if (d) b.revive(d, 0.3); } }),
  capture: card({ name: 'Capture', glyph: 'orb', element: 'trainer', cost: 3, kind: 'trainer', shape: 'single', target: 'enemy', origin: 'map',
    desc: 'Trainer: throws a capture orb at a wild creature. Works if it is below 30% HP; captured creatures join your team after the fight.',
    ai: () => [0, null],
    resolve: (b, team, aim) => {
      const t = unitByUid(b, aim.uid); if (!t || !t.active) return;
      if (t.hpf <= 0.3) b.capture(t); else b.emit({ type: 'captureFail', unit: t });
    } }),
};

export const TRAINER_CARDS = ['mend', 'rally', 'guard', 'revive'];

/** Tiles a card affects for a given aim (the telegraph preview uses exactly this). */
export function cardTiles(b, caster, cardId, aim, team) {
  const c = CARDS[cardId];
  if (!aim) return [];
  switch (c.shape) {
    case 'circle': case 'leap': return aim.tile ? G.tilesInCircle(aim.tile, c.radius) : [];
    case 'self': return caster ? G.tilesInCircle(caster.pos, c.radius) : [];
    case 'cone': return caster && aim.point ? G.tilesInCone(caster.pos, aim.point, c.range, c.angle) : [];
    case 'line': return caster && aim.point ? G.tilesInLine(caster.pos, aim.point, c.length) : [];
    case 'wall': {
      if (!aim.tile) return [];
      const [col, row] = aim.tile;
      return [[col - 1, row], aim.tile, [col + 1, row]].filter(hex.inBounds);
    }
    case 'single': { const t = aim.uid && b.units.find((x) => x.uid === aim.uid); return t ? [t.pos] : []; }
    default: return caster ? [caster.pos] : [];
  }
}

/** Is this aim legal right now (range, target team, wall tiles)? Returns a reason string or null. */
export function aimProblem(b, caster, cardId, aim, team) {
  const c = CARDS[cardId];
  if (c.shape === 'none' || c.shape === 'self') return null;
  if (!aim) return 'Aim on the board';
  if (c.shape === 'single') {
    const t = aim.uid && b.units.find((x) => x.uid === aim.uid);
    if (!t || !t.active) return c.target === 'ally' ? 'Pick one of your creatures' : 'Pick an enemy';
    if ((c.target === 'ally') !== (t.team === team)) return c.target === 'ally' ? 'Pick one of your creatures' : 'Pick an enemy';
    if (c.origin === 'caster' && caster && hex.dist(caster.pos, t.pos) > c.range) return `Out of range (${c.range} tiles)`;
    if (cardId === 'capture' && !b.wild) return 'Only wild creatures can be captured';
    return null;
  }
  if ((c.shape === 'circle' || c.shape === 'leap' || c.shape === 'wall') && !aim.tile) return 'Aim on the board';
  if ((c.shape === 'circle' || c.shape === 'leap') && c.origin === 'caster' && caster && hex.dist(caster.pos, aim.tile) > c.range) return `Out of range (${c.range} tiles)`;
  return null;
}
