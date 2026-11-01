// Player progression: collection, levels, evolutions, keys, gyms. Saved in localStorage.
import { LINES, PACING, currentForm, nextEvolution, statsFor, ABILITY_NAMES } from '../data/creatures.js';
import { TRAINER_CARDS } from '../sim/cards.js';

export const START_TEAM_SIZE = 2, MAX_TEAM_SIZE = 9;
const DEFAULT_KIT = ['mend', 'rally'];

const SAVE_KEY = 'project-ember-save-v1';
let nextUid = 1;

export function newCreature(line, level = PACING.startLevel) {
  return { uid: `c${Date.now().toString(36)}${nextUid++}`, line, level, xp: 0, path: null };
}

export function newGame(partner) {
  const team = [partner, partner === 'Brinehorn' ? 'Mossfawn' : 'Brinehorn'].map((l) => newCreature(l));
  return { version: 3, partner, creatures: team, team: team.map((c) => c.uid), kit: [...DEFAULT_KIT], teamSize: START_TEAM_SIZE,
           world: null,
           keys: [], gymsBeaten: [], battles: 0, seen: [], positions: {}, settings: { autoSpecials: false, speed: 1 } };
}

export const load = () => {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
  if (!s) return null;
  // upgrade older saves to Combat 3.0
  if (!s.teamSize) s.teamSize = Math.max(START_TEAM_SIZE, Math.min(s.team.length, START_TEAM_SIZE + (s.gymsBeaten || []).length));
  s.team = s.team.slice(0, s.teamSize);
  s.kit = (s.kit || []).filter((k) => TRAINER_CARDS.includes(k)).slice(0, 2);
  if (s.kit.length < 2) s.kit = [...new Set([...s.kit, ...DEFAULT_KIT])].slice(0, 2);
  s.version = 3;
  return s;
};
export const save = (s) => localStorage.setItem(SAVE_KEY, JSON.stringify(s));
export const wipe = () => localStorage.removeItem(SAVE_KEY);

export const byUid = (s, uid) => s.creatures.find((c) => c.uid === uid);
export const teamCreatures = (s) => s.team.map((uid) => byUid(s, uid)).filter(Boolean);
export const averageLevel = (s) => {
  const t = teamCreatures(s);
  return Math.round(t.reduce((a, c) => a + c.level, 0) / Math.max(t.length, 1));
};

function unlocksBetween(from, to, c) {
  const u = PACING.unlock, line = LINES[c.line], out = [];
  const form = currentForm({ ...c, level: to });
  if (from < u.a2 && to >= u.a2) out.push(`Ability 2: ${ABILITY_NAMES[line.abilities[1]]}`);
  if (from < u.passive && to >= u.passive) out.push(`Passive: ${ABILITY_NAMES[form.passive || line.passive]}`);
  if (from < u.special && to >= u.special) out.push(`Special: ${ABILITY_NAMES[form.special || line.special]}`);
  return out;
}

/** Give XP after a battle. Returns per-creature reports (level ups, unlocks, evolutions). */
export function grantXp(s, uids, amount) {
  return uids.map((uid) => {
    const c = byUid(s, uid);
    const before = { level: c.level, form: currentForm(c).name };
    c.xp += amount;
    while (c.level < PACING.maxLevel && c.xp >= PACING.xpToNext(c.level)) { c.xp -= PACING.xpToNext(c.level); c.level++; }
    if (c.level >= PACING.maxLevel) c.xp = 0;
    const after = currentForm(c);
    return {
      uid, line: c.line, gained: amount, from: before.level, to: c.level, xp: c.xp, need: PACING.xpToNext(c.level),
      unlocks: unlocksBetween(before.level, c.level, c),
      evolvedFrom: after.name !== before.form ? before.form : null, formName: after.name,
      pendingPaths: after.pendingPaths || null,
    };
  });
}

export function choosePath(s, uid, path) { byUid(s, uid).path = path; }

export function grantGymReward(s, gym) {
  const got = { creature: null, key: null };
  if (!s.gymsBeaten.includes(gym.id)) {
    s.gymsBeaten.push(gym.id);
    const owned = new Set(s.creatures.map((c) => c.line));
    const line = gym.reward.creatures.find((l) => !owned.has(l)) || gym.reward.creatures[0];
    const c = newCreature(line, Math.max(PACING.startLevel, averageLevel(s) - 1));
    s.creatures.push(c); got.creature = c;
    if (!s.keys.includes(gym.reward.key)) { s.keys.push(gym.reward.key); got.key = gym.reward.key; }
    if (s.teamSize < MAX_TEAM_SIZE) { s.teamSize++; got.teamSize = s.teamSize; }
    // fill the new slot right away: the gym's gift creature joins the team
    if (s.team.length < s.teamSize && !s.team.includes(c.uid)) s.team.push(c.uid);
  }
  return got;
}

export const isUnlocked = (s, gymIndex, gyms) => gymIndex === 0 || s.gymsBeaten.includes(gyms[gymIndex - 1].id);
export { currentForm, nextEvolution, statsFor };

// ---------- Codex ----------
/** Form names the player has owned (every form a creature has reached, including the chosen path). */
export function ownedForms(s) {
  const out = new Set();
  for (const c of s.creatures) {
    const line = LINES[c.line];
    out.add(line.forms[0].name);
    for (const f of line.forms) {
      const lv = typeof f.at === 'number' ? f.at : PACING.evo[f.at];
      if (c.level < lv) break;
      if (f.paths) { if (c.path) out.add(f.paths[c.path].name); } else out.add(f.name);
    }
  }
  return out;
}
export function markSeen(s, names) { s.seen = [...new Set([...(s.seen || []), ...names])]; }

// ---------- loadout ----------
export function setEquipped(s, uid, ids) { byUid(s, uid).equipped = ids.slice(0, 2); }

// ---------- deployment memory ----------
export function rememberPositions(s, positions) {
  s.positions = s.positions || {};
  s.team.forEach((uid, i) => { if (positions[i]) s.positions[uid] = positions[i]; });
}
export function savedPositions(s) {
  const pos = s.team.map((uid) => (s.positions || {})[uid]);
  if (pos.some((p) => !p || p[1] > 3)) return null;
  const keys = new Set(pos.map((p) => `${p[0]},${p[1]}`));
  return keys.size === pos.length ? pos : null;
}

// ---------- capture ----------
export function addCaptured(s, line, level) {
  const c = newCreature(line, level);
  s.creatures.push(c);
  if (s.team.length < s.teamSize) s.team.push(c.uid);
  return c;
}
