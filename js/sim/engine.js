// Real-time battle engine, ported from sim/engine.py (same rules and numbers), plus an event
// queue the renderer reads to animate what happened. Team 0 = player, team 1 = opponent.
import * as hex from './hex.js';
import { ABILITIES } from './abilities.js';
import { CARDS, cardTiles, aimProblem } from './cards.js';
import { activeDuos, combineMods } from './synergies.js';
import { placement } from './maps.js';

export const DT = 0.1;
const ENERGY_MAX = 100, ABILITY_COST = 50, ABILITY_CD = 2.5;
const ENERGY_PER_ATTACK = 10, ENERGY_PER_HIT_TAKEN = 3, ENERGY_PER_KILL = 40;
// shared team energy for ability cards (Clash Royale style)
export const ENERGY_CAP = 10, ENERGY_START = 5, ENERGY_REGEN = 0.36, TEAM_KILL_ENERGY = 0.5, HAND_SIZE = 4;
const CARD_POWER = 3;   // card damage scale (creature HP is ×hpScale, so cards need to matter)
export const OVERTIME_AT = 70;   // after this, damage ramps up (+25% every 10s) and healing is halved
const DECISION_EVERY = 0.25, APM_GAP = 0.5;
const STATUS_DUR = { burn: 3, soak: 3, chill: 3, freeze: 1.5, shock: 2, crack: 4 };
const STATUS_ELEMENT = { burn: 'fire', soak: 'water', chill: 'ice', freeze: 'ice', shock: 'electric', crack: 'earth' };
const BURN_DPS = 0.3, SHOCK_DRAIN = 20, CRACK_ARMOR = 20, THERMAL_SHOCK = 2.0, CONDUCT = 0.8;
const SOLO_REACTION = 0.6, FALLBACK_ATK = 60, REVEAL_TIME = 1.5;

// Elemental marks a target can carry (checked in this order when a new element lands).
const MARKS = [['freeze', 'ice'], ['chill', 'ice'], ['soak', 'water'], ['shock', 'electric'], ['burn', 'fire'], ['crack', 'earth']];
// The combo matrix (game_design/06_combat_v2.md §3).
export const COMBOS = {
  'Flash Freeze': { elements: ['ice', 'water'], consumes: ['soak', 'chill'], desc: 'Frozen for 2s' },
  'Conduct': { elements: ['electric', 'water'], consumes: ['shock'], desc: 'Stuns and chains to every Soaked enemy' },
  'Steam Cloud': { elements: ['fire', 'water'], consumes: ['soak', 'burn'], desc: 'Steam: enemies inside deal −40% damage' },
  'Mudslide': { elements: ['earth', 'water'], consumes: ['soak', 'crack'], desc: 'Mud: roots and slows' },
  'Brittle': { elements: ['electric', 'ice'], consumes: ['shock', 'chill'], desc: 'Armor −50% for 4s' },
  'Thermal Shock': { elements: ['fire', 'ice'], consumes: ['burn', 'chill', 'freeze'], desc: 'Burst damage' },
  'Shatter': { elements: ['earth', 'ice'], consumes: ['freeze', 'chill', 'crack'], desc: 'Frozen enemies explode, hitting neighbours' },
  'Plasma Burst': { elements: ['electric', 'fire'], consumes: ['shock', 'burn'], desc: 'Explosion around the target' },
  'Magnetize': { elements: ['earth', 'electric'], consumes: ['shock', 'crack'], desc: 'Pulls nearby enemies together' },
  'Magma': { elements: ['earth', 'fire'], consumes: ['burn', 'crack'], desc: 'The ground turns to lava' },
};
const COMBO_BY_PAIR = Object.fromEntries(Object.entries(COMBOS).map(([n, c]) => [[...c.elements].sort().join('+'), n]));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let NEXT_UID = 1;

export class Unit {
  constructor(def, team, pos, hpScale, hpf = 1) {
    this.uid = NEXT_UID++;
    this.def = def;
    this.name = def.name; this.line = def.line; this.team = team;
    this.elements = def.element; this.role = def.role;
    this.baseHp = def.hp; this.maxHp = def.hp * hpScale; this.hp = this.maxHp * hpf;
    this.atk = def.atk; this.aspd = def.aspd; this.baseRange = def.range; this.baseArmor = def.armor; this.move = def.move;
    this.abilities = [def.auto].filter(Boolean); this.passive = def.passive; this.cards = [...(def.cards || [])];
    this.channelUntil = 0;
    this.pos = pos; this.startPos = pos;
    this.alive = true; this.eggUntil = null; this.rekindleUsed = false;
    this.energy = 0;
    this.nextAttack = 0; this.nextMove = 0;
    this.abReady = Object.fromEntries(this.abilities.map((a) => [a, 0]));
    this.status = {}; this.buffs = [];
    this.shield = 0; this.shieldUntil = 0; this.revealedUntil = 0;
    this.target = null; this.attacks = 0; this.chainUntil = 0; this.terrainTick = 0; this.burnTick = 0;
    this.dmgDealt = 0; this.kills = 0; this.casts = 0; this.specials = 0;
    // end-of-battle breakdown
    this.stats = { attack: 0, ability: 0, special: 0, combo: 0, dot: 0, taken: 0, healDone: 0, shieldDone: 0, combos: 0 };
  }
  get hpf() { return this.hp / this.maxHp; }
  get active() { return this.alive && this.eggUntil === null; }
}

export class Battle {
  constructor({ teamA, teamB, map, policyA, policyB, kitA, kitB, hpScale = 5, seed = 1, maxTime = 240, posA = null,
                boonsA = [], boonsB = [], trainerA = [], trainerB = [], wild = false }) {
    this.rng = mulberry32(seed);
    this.mods = [combineMods(boonsA), combineMods(boonsB)];
    this.t = 0; this.maxTime = maxTime; this.hpScale = hpScale;
    this.map = map;
    this.base = new Map(map.base);
    this.overlay = new Map();     // key -> [type, until]
    this.eventDone = false;
    this.events = [];
    this.units = [];
    this.occ = new Map();
    const spotsA = posA || placement(teamA.map((d) => d.role));
    const spotsB = placement(teamB.map((d) => d.role)).map(hex.mirror);
    teamA.forEach((d, i) => this._addUnit(d, 0, spotsA[i]));
    teamB.forEach((d, i) => this._addUnit(d, 1, spotsB[i]));
    this.policies = [policyA, policyB];
    this.wild = wild;
    this.captured = [];
    this.reviveUsed = [false, false];
    this.energyCap = ENERGY_CAP;
    this.lastAction = [-99, -99];
    this.nextDecision = 0;
    this.actions = [0, 0];
    this.reactions = {};
    this.firstKill = null;
    this.elemCount = [{}, {}];
    for (const u of this.units) for (const e of u.elements) this.elemCount[u.team][e] = (this.elemCount[u.team][e] || 0) + 1;
    this.duos = [0, 1].map((team) => new Set(activeDuos(this.units.filter((u) => u.team === team).map((u) => u.line)).map((d) => d.id)));
    this.cat = 'attack';   // damage category being dealt right now (for the stats screen)
    for (const u of this.units) {
      const m = this.mods[u.team];
      if (m.hp) { u.maxHp *= 1 + m.hp; u.hp = u.maxHp; }
      if (m.openingHaste) u.buffs.push(['aspd', m.openingHaste, 10]);
    }
    this.energy = [0, 1].map((team) => ENERGY_START + (this.mods[team].startEnergy || 0));
    this.casting = [];          // cards being cast: {team, entry, aim, at, tiles}
    this.usedOnce = [new Set(), new Set()];
    const trainer = [trainerA, trainerB];
    this.decks = [0, 1].map((team) => {
      const mine = this.units.filter((u) => u.team === team);
      const entries = [];
      // interleave creatures so the rotation cycles through the whole team
      const maxCards = Math.max(0, ...mine.map((u) => u.cards.length));
      for (let i = 0; i < maxCards; i++) for (const u of mine) if (u.cards[i]) entries.push({ key: `${u.uid}:${u.cards[i]}`, card: u.cards[i], uid: u.uid });
      for (const c of trainer[team]) entries.push({ key: `t${team}:${c}`, card: c, uid: null });
      return entries;
    });
    this.hands = [[], []];
    for (const team of [0, 1]) this._refill(team);
    this.over = false; this.winner = null; this.timeout = false;
    this.paused = false;
    this.pending = [[], []];      // manual actions queued by the human player
  }

  _addUnit(def, team, pos) {
    const u = new Unit(def, team, pos, this.hpScale);
    u.uid = this.units.length + 1;   // per-battle ids: both machines in a versus match get the same card keys
    this.units.push(u); this.occ.set(hex.key(pos), u);
    return u;
  }

  emit(e) { e.t = this.t; this.events.push(e); }
  /** Move a team to new start tiles before the fight (deploy). `spots[i]` belongs to the team's i-th unit. */
  placeTeam(team, spots) {
    const mine = this.units.filter((u) => u.team === team);
    for (const u of mine) this.occ.delete(hex.key(u.pos));
    mine.forEach((u, i) => { u.pos = spots[i]; u.startPos = spots[i]; this.occ.set(hex.key(spots[i]), u); });
  }
  /** Compact fingerprint of the battle state (versus matches compare these to catch desyncs). */
  hash() {
    let h = 2166136261 >>> 0;
    const mix = (n) => { h = Math.imul(h ^ (n | 0), 16777619) >>> 0; };
    mix(Math.round(this.t * 10)); mix(Math.round(this.energy[0] * 1000)); mix(Math.round(this.energy[1] * 1000));
    for (const u of this.units) { mix(Math.round(u.hp * 100)); mix(u.pos[0] * 16 + u.pos[1]); mix(u.alive ? 1 : 0); }
    return h;
  }
  hasDuo(team, id) { return this.duos[team].has(id); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ---------- queries ----------
  teamAlive(team) { return this.units.filter((u) => u.team === team && u.active); }
  teamDead(team) { return this.units.filter((u) => u.team === team && !u.alive); }
  enemies(u) { return this.teamAlive(1 - u.team); }
  allies(u) { return this.teamAlive(u.team); }
  has(u, name) { const s = u.status[name]; return !!s && s.until > this.t; }
  tile(p) {
    const ov = this.overlay.get(hex.key(p));
    if (ov && ov[1] > this.t) return ov[0];
    return this.base.get(hex.key(p)) || 'plain';
  }
  free(p) { return !this.occ.has(hex.key(p)) && this.tile(p) !== 'icewall'; }
  rangeOf(u) { return u.baseRange + (this.tile(u.pos) === 'high' ? 1 : 0); }
  targetable(by, tgt) {
    if (!tgt.active || this.has(tgt, 'invis')) return false;
    if (this.tile(tgt.pos) === 'brush' && this.t > tgt.revealedUntil && hex.dist(by.pos, tgt.pos) > 1) return false;
    return true;
  }
  attackers(u) { return this.enemies(u).filter((e) => e.target === u).length; }
  buffSum(u, stat) { let s = 0; for (const [st, v, until] of u.buffs) if (st === stat && until > this.t) s += v; return s; }
  armor(u) {
    let a = u.baseArmor + (this.mods[u.team].armor || 0);
    if (this.has(u, 'brittle')) a *= 0.5;
    if (u.passive === 'grounded' && this.tile(u.pos) === 'high') a += 20;
    if (this.has(u, 'crack')) a -= CRACK_ARMOR;
    return Math.max(a, 0);
  }
  attackInterval(u) {
    let mult = 1 + this.buffSum(u, 'aspd');
    const s = u.status.chill;
    if (s && s.until > this.t) mult -= 0.1 * s.stacks;
    if (this.enemies(u).some((e) => e.passive === 'frost_aura' && hex.dist(e.pos, u.pos) <= 2)) mult -= 0.15;
    if (u.passive === 'ember_blade' && this.tile(u.pos) === 'lava') mult += 0.15;
    return 1 / (u.aspd * Math.max(mult, 0.3));
  }
  moveInterval(u) {
    let iv = 1 / u.move;
    if (this.tile(u.pos) === 'mud') iv *= 1.8;
    if (this.has(u, 'soak')) {
      iv *= 1.3;
      if (this.enemies(u).some((e) => e.passive === 'undertow' && hex.dist(e.pos, u.pos) === 1)) iv *= 1.3;
    }
    return iv;
  }
  currentTarget(u) {
    const taunt = u.status.taunt;
    if (taunt && taunt.until > this.t && taunt.src.active) { u.target = taunt.src; return u.target; }
    const rng = this.rangeOf(u);
    const cands = this.enemies(u).filter((e) => this.targetable(u, e));
    if (!cands.length) { u.target = null; return null; }
    const t = u.target;
    if (t && cands.includes(t) && (hex.dist(u.pos, t.pos) <= rng || !cands.some((e) => hex.dist(u.pos, e.pos) <= rng))) return t;
    cands.sort((a, b) => hex.dist(u.pos, a.pos) - hex.dist(u.pos, b.pos) || a.hp - b.hp);
    u.target = cands[0];
    return u.target;
  }
  estimate(src, tgt, amount) { return amount * (1 + this.buffSum(src, 'dmg')) * 100 / (100 + this.armor(tgt)); }

  // ---------- terrain ----------
  setOverlay(p, typ, dur) { this.overlay.set(hex.key(p), [typ, this.t + dur]); this.emit({ type: 'tile', pos: p, tile: typ, dur }); }
  setBase(p, typ) { this.base.set(hex.key(p), typ); this.emit({ type: 'tile', pos: p, tile: typ, dur: 0 }); }
  elementOnTile(p, element) {
    const typ = this.tile(p), k = hex.key(p);
    if (element === 'fire') {
      if (typ === 'brush') {
        if ((this.overlay.get(k) || [])[0] === 'brush') { this.overlay.delete(k); this.emit({ type: 'tile', pos: p, tile: this.tile(p), dur: 0 }); }
        else this.setBase(p, 'plain');
      } else if (typ === 'icewall') this.setOverlay(p, 'river', 6);
    } else if (element === 'ice' && typ === 'river') this.setOverlay(p, 'frozen', 5);
  }

  // ---------- effects ----------
  gainEnergy(u, amount) {
    u.energy = Math.min(ENERGY_MAX, u.energy + amount);
  }
  deal(src, tgt, amount, element, { trueDmg = false, hit = true, reaction = null, cat = null } = {}) {
    if (!tgt.active) return false;
    cat = cat || (hit ? this.cat : 'dot');
    if (this.cardCast && cat !== 'combo') amount *= CARD_POWER;
    if (src) {
      amount *= 1 + this.buffSum(src, 'dmg') + (this.mods[src.team].dmgElement[element] || 0);
      if (src.passive === 'kindling' && this.has(tgt, 'burn')) amount *= 1.1;
      if (src.passive === 'shatter' && this.has(tgt, 'freeze')) amount *= 1.5;
      if (src.elements.includes('water') && this.tile(src.pos) === 'river') amount *= 1.15;
      if (this.tile(tgt.pos) === 'high' && this.tile(src.pos) !== 'high') amount *= 0.85;
      if (this.has(src, 'steamed')) amount *= 0.6;
      if ((src.line === 'Hrimfang' || src.line === 'Raijura') && this.hasDuo(src.team, 'thunderhunt')
          && (this.has(tgt, 'shock') || this.has(tgt, 'chill') || this.has(tgt, 'freeze'))) amount *= 1.3;
      src.revealedUntil = this.t + REVEAL_TIME;
    }
    if (!trueDmg) amount *= 100 / (100 + this.armor(tgt));
    amount *= Math.max(1 + this.buffSum(tgt, 'taken'), 0.1);
    if (this.t > OVERTIME_AT) amount *= 1 + 0.025 * (this.t - OVERTIME_AT);
    let absorbed = 0;
    if (tgt.shield > 0 && tgt.shieldUntil > this.t) { absorbed = Math.min(tgt.shield, amount); tgt.shield -= absorbed; amount -= absorbed; }
    const dealt = Math.min(amount, Math.max(tgt.hp, 0));
    tgt.hp -= amount;
    tgt.stats.taken += dealt + absorbed;
    if (src) {
      src.dmgDealt += dealt;
      src.stats[cat] = (src.stats[cat] || 0) + dealt;
      if (cat === 'attack' && this.mods[src.team].lifesteal && src.active) this.heal(src, src, (dealt * this.mods[src.team].lifesteal) / src.baseHp);
    }
    this.emit({ type: 'damage', unit: tgt, src, amount, absorbed, element, reaction, dot: !hit, cat });
    if (hit) this.gainEnergy(tgt, ENERGY_PER_HIT_TAKEN);
    if (tgt.hp <= 0) { this.kill(src, tgt); return true; }
    // a heavy earth hit shatters frozen enemies
    if (element === 'earth' && hit && cat !== 'combo' && this.has(tgt, 'freeze')) this._combo('Shatter', src, tgt, tgt.status.freeze);
    return false;
  }
  kill(src, tgt) {
    if (tgt.passive === 'rekindle' && !tgt.rekindleUsed) {
      tgt.rekindleUsed = true; tgt.hp = 0; tgt.eggUntil = this.t + 3; tgt.status = {};
      this.emit({ type: 'egg', unit: tgt });
      if (this.hasDuo(tgt.team, 'phoenix_spark')) {
        this.emit({ type: 'impact', pos: tgt.pos, element: 'fire', radius: 1 });
        for (const e of this.teamAlive(1 - tgt.team)) if (hex.dist(e.pos, tgt.pos) <= 1) this.deal(tgt, e, 1.5 * tgt.atk, 'fire', { trueDmg: true, cat: 'combo' });
      }
    } else {
      tgt.alive = false; tgt.hp = 0; this.occ.delete(hex.key(tgt.pos));
      this.emit({ type: 'death', unit: tgt });
    }
    if (src && src.team !== tgt.team) {
      src.kills++;
      this.gainEnergy(src, ENERGY_PER_KILL);
      this.addEnergy(src.team, TEAM_KILL_ENERGY);
      if (this.firstKill === null) this.firstKill = src.team;
    }
  }
  heal(src, tgt, frac) {
    if (!tgt.active) return;
    let amt = frac * tgt.baseHp;
    if (src && src.passive === 'overgrowth' && this.tile(tgt.pos) === 'brush') amt *= 1.3;
    if (this.hasDuo(tgt.team, 'tidal_bloom')) amt *= 1.3;
    if (this.t > OVERTIME_AT) amt *= 0.5;
    const before = tgt.hp;
    tgt.hp = Math.min(tgt.maxHp, tgt.hp + amt);
    if (src) src.stats.healDone += tgt.hp - before;
    if (tgt.hp - before > 1) this.emit({ type: 'heal', unit: tgt, amount: tgt.hp - before });
  }
  addShield(tgt, amount, dur, src = null) {
    if (src) src.stats.shieldDone += amount;
    if (tgt.shieldUntil <= this.t) tgt.shield = 0;
    tgt.shield += amount; tgt.shieldUntil = this.t + dur;
    this.emit({ type: 'shield', unit: tgt, dur });
  }
  buff(u, stat, value, dur) { u.buffs.push([stat, value, this.t + dur]); this.emit({ type: 'buff', unit: u, stat, dur }); }
  clear(u, ...names) { for (const n of names) delete u.status[n]; }
  _dur(src, status, dur) {
    if (dur == null) dur = STATUS_DUR[status];
    const el = STATUS_ELEMENT[status];
    if (src && el && (this.elemCount[src.team][el] || 0) >= 2) dur *= 1.5;
    if (src && el) dur *= 1 + (this.mods[src.team].statusDur || 0);
    return dur;
  }
  _reactionMult(src, existing) { return src && existing && existing.src === src ? SOLO_REACTION : 1; }
  _srcAtk(src) { return src ? src.atk : FALLBACK_ATK; }
  _reaction(name, tgt) { this.reactions[name] = (this.reactions[name] || 0) + 1; this.emit({ type: 'reaction', name, unit: tgt }); }

  apply(src, tgt, status, dur = null) {
    if (!tgt.active) return;
    const t = this.t, st = tgt.status;
    const el = STATUS_ELEMENT[status];
    dur = this._dur(src, status, dur);
    const set = (name, extra = {}) => {
      if (name === 'freeze') { if (t < (tgt.freezeImmune || 0)) return; tgt.freezeImmune = t + dur + 2.5; }   // no freeze lock
      st[name] = { until: t + dur, src, ...extra }; this.emit({ type: 'status', unit: tgt, status: name, dur });
    };
    if (!el) { set(status); return; }   // stun, root, taunt, invis, regen, steamed, brittle
    // immunities
    if (status === 'burn' && tgt.elements.includes('fire') && !src) return;
    if (status === 'soak' && tgt.elements.includes('water')) return;
    if (status === 'shock' && (tgt.passive === 'grounded' || tgt.elements.includes('earth'))) return;
    if (status === 'shock' && !src && tgt.elements.includes('electric')) return;
    if (status === 'shock') tgt.energy = Math.max(0, tgt.energy - SHOCK_DRAIN);
    // a different element's mark on the target detonates a combo
    for (const [name, mark] of MARKS) {
      if (mark === el || !this.has(tgt, name)) continue;
      const combo = COMBO_BY_PAIR[[el, mark].sort().join('+')];
      // terrain on its own (no creature behind either mark) doesn't set off combos, or lava would loop forever
      if (combo && (src || st[name].src)) { this._combo(combo, src || st[name].src, tgt, st[name]); return; }
    }
    if (status === 'chill') {
      const stacks = this.has(tgt, 'chill') ? st.chill.stacks + 1 : 1;
      if (stacks >= 3) { delete st.chill; dur = this._dur(src, 'freeze', null); set('freeze'); }
      else set('chill', { stacks });
      return;
    }
    set(status);
  }
  /** Detonate a combo: consume the elemental marks, apply the effect, count the chain. */
  _combo(name, src, tgt, existing) {
    const t = this.t;
    const solo = this._reactionMult(src, existing);
    const chain = tgt.comboChain && tgt.comboChain.until > t ? tgt.comboChain.n + 1 : 1;
    tgt.comboChain = { n: chain, until: t + 4 };
    let power = solo * (1 + 0.25 * (Math.min(chain, 5) - 1));
    if (src) {
      const m = this.mods[src.team];
      power *= 1 + (m.comboDmg || 0);
      const els = COMBOS[name].elements;
      if (els.some((e) => (this.elemCount[src.team][e] || 0) >= 3)) power *= 1.25;
      if (name === 'Thermal Shock' && this.hasDuo(src.team, 'frostfire')) power *= 1.5;
      src.stats.combos++;
      if (chain >= 3) this.addEnergy(src.team, 0.5);
    }
    this.reactions[name] = (this.reactions[name] || 0) + 1;
    this.emit({ type: 'reaction', name, unit: tgt, chain });
    const wasFrozen = this.has(tgt, 'freeze');
    for (const mark of COMBOS[name].consumes) delete tgt.status[mark];
    const atk = this._srcAtk(src) * power;
    const hit = (u, mult, element) => this.deal(src, u, mult * atk, element, { trueDmg: true, hit: false, reaction: name, cat: 'combo' });
    const near = (r) => this.teamAlive(tgt.team).filter((e) => e !== tgt && hex.dist(e.pos, tgt.pos) <= r);
    switch (name) {
      case 'Flash Freeze':
        if (t >= (tgt.freezeImmune || 0)) { tgt.status.freeze = { until: t + 2, src }; tgt.freezeImmune = t + 4.5; this.emit({ type: 'status', unit: tgt, status: 'freeze', dur: 2 }); }
        hit(tgt, 0.4, 'ice');
        break;
      case 'Conduct':
        for (const e of [tgt, ...this.teamAlive(tgt.team).filter((x) => x !== tgt && this.has(x, 'soak'))]) {
          delete e.status.soak;
          e.status.stun = { until: t + 1, src }; this.emit({ type: 'status', unit: e, status: 'stun', dur: 1 });
          if (e !== tgt) this.emit({ type: 'chain', unit: src || tgt, from: tgt, target: e });
          hit(e, CONDUCT, 'electric');
        }
        break;
      case 'Steam Cloud':
        for (const p of hex.within(tgt.pos, 1)) if (this.tile(p) === 'plain' || this.tile(p) === 'river') this.setOverlay(p, 'steam', 5);
        for (const e of [tgt, ...near(1)]) { e.status.steamed = { until: t + 4, src }; }
        hit(tgt, 0.6, 'fire');
        break;
      case 'Mudslide':
        for (const p of hex.within(tgt.pos, 1)) if (this.tile(p) === 'plain') this.setOverlay(p, 'mud', 5);
        for (const e of [tgt, ...near(1)]) { e.status.root = { until: t + 1.5, src }; this.emit({ type: 'status', unit: e, status: 'root', dur: 1.5 }); }
        hit(tgt, 0.5, 'earth');
        break;
      case 'Brittle': tgt.status.brittle = { until: t + 4, src }; this.emit({ type: 'status', unit: tgt, status: 'brittle', dur: 4 }); hit(tgt, 0.5, 'electric'); break;
      case 'Thermal Shock': hit(tgt, THERMAL_SHOCK, 'fire'); break;
      case 'Shatter':
        this.emit({ type: 'impact', pos: tgt.pos, element: 'ice', radius: 1 });
        hit(tgt, wasFrozen ? 2.6 : 1.2, 'ice');
        for (const e of near(1)) hit(e, wasFrozen ? 1.0 : 0.5, 'ice');
        break;
      case 'Plasma Burst':
        this.emit({ type: 'impact', pos: tgt.pos, element: 'electric', radius: 1 });
        hit(tgt, 1.6, 'electric');
        for (const e of near(1)) hit(e, 0.8, 'fire');
        break;
      case 'Magnetize':
        for (const e of near(2)) this.pull(e, tgt.pos);
        hit(tgt, 0.5, 'electric');
        break;
      case 'Magma': this.setOverlay(tgt.pos, 'lava', 4); hit(tgt, 0.8, 'fire'); break;
      default: break;
    }
  }
  moveTo(u, p, kind = 'dash') {
    if (!this.free(p)) return;
    const from = u.pos;
    this.occ.delete(hex.key(u.pos)); u.pos = p; this.occ.set(hex.key(p), u);
    this.emit({ type: 'move', unit: u, from, to: p, kind });
  }
  knockback(u, origin) {
    const cells = hex.neighbors(u.pos).filter((p) => this.free(p) && hex.dist(p, origin) > hex.dist(u.pos, origin));
    if (cells.length) this.moveTo(u, cells[0], 'knock');
  }
  pull(u, origin) {
    const cells = hex.neighbors(u.pos).filter((p) => this.free(p) && hex.dist(p, origin) < hex.dist(u.pos, origin));
    if (cells.length) this.moveTo(u, cells[0], 'pull');
  }
  revive(u, frac) {
    const spots = hex.ALL.filter((p) => this.free(p) && (p[1] <= 3) === (u.team === 0))
      .sort((a, b) => hex.dist(a, u.startPos) - hex.dist(b, u.startPos));
    if (!spots.length) return;
    this.reviveUsed[u.team] = true;
    Object.assign(u, { alive: true, hp: frac * u.maxHp, status: {}, buffs: [], energy: 0, target: null, pos: spots[0] });
    this.occ.set(hex.key(u.pos), u);
    this.emit({ type: 'revive', unit: u });
  }
  addEnergy(team, amount) { this.energy[team] = Math.min(this.energyCap, this.energy[team] + amount); }
  /** Push an enemy one row toward its own back line (Tidal Wave). */
  pushRows(u, dir) {
    const cells = hex.neighbors(u.pos).filter((p) => p[1] === u.pos[1] + dir && this.free(p));
    if (cells.length) this.moveTo(u, cells[0], 'knock');
  }
  capture(u) {
    u.alive = false; u.captured = true; u.hp = Math.max(u.hp, 1);
    this.occ.delete(hex.key(u.pos));
    this.captured.push(u);
    this.emit({ type: 'captured', unit: u });
  }

  // ---------- ability cards ----------
  /** A card can be in the hand if its creature is alive (trainer cards always, once-cards until used). */
  _eligible(team, entry) {
    if (CARDS[entry.card].once && this.usedOnce[team].has(entry.card)) return false;
    if (entry.uid === null) return true;
    const u = this.units.find((x) => x.uid === entry.uid);
    return u && u.active;
  }
  _refill(team) {
    const hand = this.hands[team].filter((e) => this._eligible(team, e));
    const deck = this.decks[team];
    for (const e of [...deck]) {
      if (hand.length >= HAND_SIZE) break;
      if (hand.includes(e) || !this._eligible(team, e)) continue;
      hand.push(e);
    }
    this.hands[team] = hand;
  }
  /** The next card that will enter the hand (Clash Royale "Next:"). */
  nextCard(team) {
    const hand = this.hands[team];
    return this.decks[team].find((e) => !hand.includes(e) && this._eligible(team, e)) || null;
  }
  caster(entry) { return entry.uid === null ? null : this.units.find((x) => x.uid === entry.uid); }
  /** Why a card can't be played right now (null = it can). Energy is checked separately. */
  cardProblem(team, entry, aim) {
    if (!this.hands[team].includes(entry)) return 'Not in hand';
    const u = this.caster(entry);
    if (entry.uid !== null && (!u || !u.active)) return 'Its creature has fallen';
    if (u && (this._disabled(u) || this.t < u.channelUntil)) return `${u.name} is busy`;
    return aimProblem(this, u, entry.card, aim, team);
  }
  playCard(team, key, aim) {
    const entry = this.hands[team].find((e) => e.key === key);
    if (!entry) return false;
    const c = CARDS[entry.card];
    if (this.energy[team] < c.cost || this.cardProblem(team, entry, aim)) return false;
    const u = this.caster(entry);
    this.energy[team] -= c.cost;
    if (c.once) this.usedOnce[team].add(entry.card);
    const tiles = cardTiles(this, u, entry.card, aim, team);
    this.casting.push({ team, entry, aim, at: this.t + c.castTime, tiles });
    if (u) { u.channelUntil = this.t + c.castTime; u.castDur = c.castTime; }
    this.emit({ type: 'castStart', team, card: entry.card, unit: u, aim, tiles, dur: c.castTime, key });
    // rotate: the card goes to the back of the deck, the next one fills the hand
    this.hands[team] = this.hands[team].filter((e) => e !== entry);
    this.decks[team] = [...this.decks[team].filter((e) => e !== entry), entry];
    this._refill(team);
    this.actions[team]++;
    return true;
  }
  _resolveCasts() {
    const due = this.casting.filter((c) => c.at <= this.t);
    if (!due.length) return;
    this.casting = this.casting.filter((c) => c.at > this.t);
    for (const k of due) {
      const c = CARDS[k.entry.card], u = this.caster(k.entry);
      if (k.entry.uid !== null && (!u || !u.active || this._disabled(u))) {   // stunned or frozen mid-cast
        this.emit({ type: 'interrupted', team: k.team, card: k.entry.card, unit: u });
        continue;
      }
      const tiles = c.origin === 'map' || c.shape === 'single' ? k.tiles : cardTiles(this, u, k.entry.card, k.aim, k.team);
      this.cat = c.kind === 'ult' ? 'special' : 'ability';
      if (u) { u.casts++; if (c.kind === 'ult') u.specials++; }
      this.emit({ type: 'cast', unit: u, team: k.team, ability: k.entry.card, special: c.kind === 'ult', card: true });
      this.cardCast = true;
      c.resolve(this, u || k.team, k.aim, tiles);
      this.cardCast = false;
      this.cat = 'attack';
      this.emit({ type: 'castEnd', team: k.team, key: k.entry.key });
    }
  }
  /** Human input: play a card (it fires on the next decision tick). */
  request(team, action) { this.pending[team].push(action); }

  // ---------- simulation ----------
  _disabled(u) { return this.has(u, 'freeze') || this.has(u, 'stun'); }
  _tickStatuses(u) {
    const t = this.t;
    if (t >= u.burnTick) {
      u.burnTick = t + 0.5;
      if (this.has(u, 'storm')) {   // Storm Leap: shocks everything around it
        for (const e of this.enemies(u)) if (hex.dist(u.pos, e.pos) <= 1) {
          this.emit({ type: 'chain', unit: u, from: u, target: e });
          this.deal(u, e, 0.35 * u.atk, 'electric', { cat: 'special' }); this.apply(u, e, 'shock');
        }
      }
      const b = u.status.burn;
      if (b && b.until > t) this.deal(b.src, u, BURN_DPS * 0.5 * this._srcAtk(b.src), 'fire', { trueDmg: true, hit: false });
      const r = u.status.regen;
      if (r && r.until > t && u.active) this.heal(r.src, u, 0.015);
      if (u.active && this.tile(u.pos) === 'river') {
        const h = this.allies(u).find((a) => a.passive === 'hydrate');
        if (h) this.heal(h, u, 0.01);
      }
    }
    if (u.active && t >= u.terrainTick) {
      u.terrainTick = t + 1;
      const typ = this.tile(u.pos);
      if (typ === 'river') this.apply(null, u, 'soak', 2);
      else if (typ === 'lava') this.apply(null, u, 'burn', 2);
      else if (typ === 'charged') this.apply(null, u, 'shock', 1);
      else if (typ === 'steam') u.status.steamed = { until: t + 1.5, src: null };
    }
  }
  _stepToward(u, tgt) {
    const rng = this.rangeOf(u), start = u.pos;
    const prev = new Map([[hex.key(start), null]]);
    let frontier = [start], goal = null;
    while (frontier.length && !goal) {
      const nxt = [];
      for (const p of frontier) {
        for (const q of hex.neighbors(p)) {
          const k = hex.key(q);
          if (prev.has(k) || !this.free(q)) continue;
          prev.set(k, p);
          if (hex.dist(q, tgt.pos) <= rng) { goal = q; break; }
          nxt.push(q);
        }
        if (goal) break;
      }
      frontier = nxt;
    }
    if (!goal) return;
    while (!hex.same(prev.get(hex.key(goal)), start)) goal = prev.get(hex.key(goal));
    this.moveTo(u, goal, 'walk');
  }
  _attack(u, tgt) {
    const overload = u.passive === 'overload' && this.has(tgt, 'shock');
    u.attacks++;
    const element = u.elements[u.elements.length > 1 ? u.attacks % 2 : 0];
    this.emit({ type: 'attack', unit: u, target: tgt, element, ranged: u.baseRange > 1 });
    this.deal(u, tgt, u.atk, element);
    this.gainEnergy(u, ENERGY_PER_ATTACK * (overload ? 2 : 1));
    if (!tgt.active) return;
    const p = u.passive;
    if (p === 'static_build' && u.attacks % 3 === 0) this.apply(u, tgt, 'shock');
    else if (p === 'ember_blade' && u.attacks % 3 === 0) this.apply(u, tgt, 'burn');
    if (u.chainUntil > this.t) {
      const extra = u.chainCount || 1;
      const others = this.enemies(u).filter((e) => e !== tgt && hex.dist(e.pos, tgt.pos) <= 1).slice(0, extra);
      for (const o of others) {
        this.emit({ type: 'chain', unit: u, from: tgt, target: o });
        this.deal(u, o, 0.6 * u.atk, 'electric');
        if (u.chainShock && o.active) this.apply(u, o, 'shock');
      }
    }
  }
  _act(u) {
    const t = this.t;
    if (this._disabled(u) || t < u.channelUntil) return;
    let best = null;
    for (const ab of u.abilities) {
      if (u.abReady[ab] <= t && u.energy >= ABILITY_COST) {
        const a = ABILITIES[ab];
        const [score, info] = a.value(this, u);
        if (score >= a.auto && (!best || score / a.auto > best[0])) best = [score / a.auto, ab, info];
      }
    }
    if (best) {
      const [, ab, info] = best;
      this.emit({ type: 'cast', unit: u, ability: ab, special: false, info });
      this.cat = 'ability';
      ABILITIES[ab].cast(this, u, info);
      this.cat = 'attack';
      u.energy -= ABILITY_COST; u.abReady[ab] = t + ABILITY_CD * (1 + (this.mods[u.team].abilityCd || 0)); u.casts++;
      return;
    }
    const tgt = this.currentTarget(u);
    if (!tgt) return;
    if (hex.dist(u.pos, tgt.pos) <= this.rangeOf(u)) {
      if (t >= u.nextAttack) { this._attack(u, tgt); u.nextAttack = t + this.attackInterval(u); }
    } else if (!this.has(u, 'root') && t >= u.nextMove) {
      const iv = this.moveInterval(u);
      u.moveDur = iv;
      this._stepToward(u, tgt);
      u.nextMove = t + iv;
    }
  }
  _decide(team) {
    const queued = this.pending[team];
    while (queued.length) {
      const a = queued.shift();
      if (a.kind === 'card' && this.playCard(team, a.key, a.aim)) return true;
    }
    const pol = this.policies[team];
    if (!pol) return false;
    const action = pol.decide(this, team);
    return action ? this.playCard(team, action.key, action.aim) : false;
  }
  _teamHp(team) {
    const us = this.units.filter((u) => u.team === team);
    return us.reduce((s, u) => s + (u.alive ? Math.max(u.hp, 0) : 0), 0) / us.reduce((s, u) => s + u.maxHp, 0);
  }
  step() {
    if (this.over) return;
    this.t += DT;
    const t = this.t;
    if (!this.overtime && t >= OVERTIME_AT) { this.overtime = true; this.emit({ type: 'overtime' }); }
    if (!this.eventDone && t >= this.map.eventTime) {
      this.eventDone = true;
      this.emit({ type: 'mapEvent', name: this.map.eventName });
      this.map.event(this);
    }
    for (const team of [0, 1]) this.addEnergy(team, ENERGY_REGEN * DT * (1 + (this.mods[team].energyRate || 0)));
    this._resolveCasts();
    for (const u of this.units) {
      if (u.eggUntil !== null && u.alive && t >= u.eggUntil) { u.eggUntil = null; u.hp = 0.25 * u.maxHp; this.emit({ type: 'revive', unit: u }); }
      if (!u.active) continue;
      this._tickStatuses(u);
    }
    for (const team of [0, 1]) if (this.hands[team].some((e) => !this._eligible(team, e)) || this.hands[team].length < HAND_SIZE) this._refill(team);
    if (t >= this.nextDecision) {
      this.nextDecision = t + DECISION_EVERY;
      for (const team of [0, 1]) if (t - this.lastAction[team] >= APM_GAP && this._decide(team)) {
        this.lastAction[team] = t; this.actions[team]++;
      }
    }
    const order = this.units.filter((u) => u.active);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const u of order) if (u.active) this._act(u);
    const alive = [0, 1].map((team) => this.units.some((u) => u.team === team && u.alive));
    if (!alive[0] || !alive[1] || t >= this.maxTime) {
      this.over = true;
      if (alive[0] && alive[1]) { this.winner = this._teamHp(0) >= this._teamHp(1) ? 0 : 1; this.timeout = true; }
      else this.winner = alive[0] ? 0 : 1;
      this.emit({ type: 'end', winner: this.winner });
    }
  }
  /** Run headless to the end (for tests and balance checks). */
  run() { while (!this.over) { this.step(); this.events.length = 0; } return this; }
}
