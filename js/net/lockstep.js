// Deterministic lockstep for versus matches: both browsers run the same battle (same seed, same
// teams) and only exchange inputs. An input made at tick n is scheduled for tick n + INPUT_DELAY + 1
// on both machines; a machine only advances to tick k once the other has promised all its inputs up
// to k. Every HASH_EVERY ticks the two compare a fingerprint of the state to catch desyncs.
import { AutoSpecials } from '../sim/policies.js';

export const INPUT_DELAY = 3;    // ticks (0.3 s): hidden by card cast times
const HASH_EVERY = 20;

export class Lockstep {
  constructor(link, me) {
    this.link = link;
    this.me = me;
    this.foe = 1 - me;
    this.tick = 0;                      // steps done
    this.remoteUpto = INPUT_DELAY;      // the other side has sent every input up to this tick
    this.inputs = new Map();            // tick -> [[team 0 actions], [team 1 actions]]
    this.hashes = new Map();
    this.remoteHashes = new Map();
    this.desync = null;                 // tick of the first mismatch
    this.lastStep = performance.now();
    this.off = link.onMessage((m) => this._msg(m));
  }
  /** Queue a local input; returns the tick it will run on. */
  schedule(raw) {
    const act = cleanAction(raw);   // both machines must see byte-identical inputs
    if (!act) return null;
    const at = this.tick + INPUT_DELAY + 1;
    this._add(at, this.me, act);
    this.link.send({ type: 'in', at, act });
    return at;
  }
  canStep() { return this.tick + 1 <= this.remoteUpto; }
  /** Run one tick: apply both teams' inputs for it (team 0 first), step, then promise our next tick. */
  step(battle) {
    const k = this.tick + 1;
    const slot = this.inputs.get(k);
    if (slot) {
      for (const team of [0, 1]) for (const a of slot[team]) apply(battle, team, a);
      this.inputs.delete(k);
    }
    battle.step();
    this.tick = k;
    this.lastStep = performance.now();
    this.link.send({ type: 'up', k: k + INPUT_DELAY });
    if (k % HASH_EVERY === 0) {
      const h = battle.hash();
      this.hashes.set(k, h);
      this.link.send({ type: 'hash', k, h });
      this._check(k);
    }
  }
  _add(at, team, act) {
    if (!this.inputs.has(at)) this.inputs.set(at, [[], []]);
    this.inputs.get(at)[team].push(act);
  }
  _msg(m) {
    if (m.type === 'up' && Number.isInteger(m.k)) this.remoteUpto = Math.max(this.remoteUpto, m.k);
    else if (m.type === 'in') {
      const act = cleanAction(m.act);
      if (!act || !Number.isInteger(m.at)) return;
      if (m.at <= this.tick) { this.desync ??= this.tick; return; }   // arrived too late: can't happen with an honest peer
      this._add(m.at, this.foe, act);
    } else if (m.type === 'hash' && Number.isInteger(m.k) && Number.isInteger(m.h)) {
      this.remoteHashes.set(m.k, m.h);
      this._check(m.k);
    }
  }
  _check(k) {
    if (!this.hashes.has(k) || !this.remoteHashes.has(k)) return;
    if (this.hashes.get(k) !== this.remoteHashes.get(k) && this.desync === null) {
      this.desync = k;
      console.error(`Versus desync at tick ${k}`);
    }
    this.hashes.delete(k); this.remoteHashes.delete(k);
  }
  dispose() { this.off(); }
}

function apply(battle, team, a) {
  if (a.kind === 'card') battle.request(team, { kind: 'card', key: a.key, aim: a.aim });
  else if (a.kind === 'auto') battle.policies[team] = a.on ? new AutoSpecials() : null;
}

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const num = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 50;
/** Rebuild a remote action from scratch, keeping only well-formed fields (never trust the wire). */
export function cleanAction(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.kind === 'auto') return { kind: 'auto', on: a.on === true };
  if (a.kind !== 'card' || typeof a.key !== 'string' || !/^(\d{1,2}|t[01]):[a-z_]{1,30}$/.test(a.key)) return null;
  const aim = {}, src = a.aim && typeof a.aim === 'object' ? a.aim : {};
  if (Array.isArray(src.tile) && int(src.tile[0], 0, 6) && int(src.tile[1], 0, 7)) aim.tile = [src.tile[0], src.tile[1]];
  if (Array.isArray(src.point) && num(src.point[0]) && num(src.point[1])) aim.point = [src.point[0], src.point[1]];
  if (int(src.uid, 1, 40)) aim.uid = src.uid;
  return { kind: 'card', key: a.key, aim };
}
