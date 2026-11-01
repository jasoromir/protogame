// Simulated players (ported from sim/policies.py). The opponent uses one of these; the human
// player can also hand their Specials to "eager" via the auto-special toggle.
import { ABILITIES } from './abilities.js';

const ROLE_BONUS = { Tank: 300, Bruiser: 400, Duelist: 450, Assassin: 450, Mage: 450, Marksman: 450, Controller: 400, Support: 300, Healer: 400 };
export const unitValue = (u) => u.atk * u.aspd * 10 + (ROLE_BONUS[u.role] || 300);
const best = (arr, f) => arr.reduce((m, x) => (f(x) > f(m) ? x : m));

export class EagerPolicy {
  decide(b, team) {
    for (const u of b.readySpecials(team)) {
      const [score, info] = b.specialValue(u);
      if (score >= ABILITIES[u.special].auto) return ['special', u, info];
    }
    const opts = b.trainerOptions(team);
    for (const ab of b.kits[team]) {
      const targets = opts[ab];
      if (!targets) continue;
      if (ab === 'rally' || ab === 'revive') return ['trainer', ab, targets[0]];
      if (ab === 'mend' || ab === 'shield') { const a = best(targets, (x) => -x.hpf); if (a.hpf < 0.9) return ['trainer', ab, a]; }
      if (ab === 'overcharge') return ['trainer', ab, best(targets, (x) => -x.smeter)];
    }
    return null;
  }
}

export class SmartPolicy {
  constructor({ specials = true, trainer = true } = {}) { this.specials = specials; this.trainer = trainer; }
  decide(b, team) {
    return (this.trainer && this.emergency(b, team)) || (this.specials && this.special(b, team)) || (this.trainer && this.tactical(b, team)) || null;
  }
  saving(b, team) { return b.kits[team].includes('revive') && !b.reviveUsed[team] && b.teamDead(team).length && b.tenergy[team] >= 4; }
  emergency(b, team) {
    const opts = b.trainerOptions(team);
    if (opts.revive && b.teamAlive(1 - team).length >= 2) return ['trainer', 'revive', best(opts.revive, unitValue)];
    const saving = this.saving(b, team);
    const crit = b.teamAlive(team).filter((a) => a.hpf < 0.3 && b.attackers(a));
    if (crit.length && !saving) {
      const a = best(crit, unitValue);
      for (const ab of ['shield', 'mend']) if (opts[ab] && opts[ab].includes(a)) return ['trainer', ab, a];
    }
    return null;
  }
  special(b, team) {
    let pick = null;
    for (const u of b.readySpecials(team)) {
      const ab = ABILITIES[u.special];
      const [score, info] = b.specialValue(u);
      if (score < ab.auto) continue;
      const held = b.t - (u.specialReadySince ?? b.t);
      if (score >= ab.smart || held > 8 || u.hpf < 0.25) {
        const rank = score / ab.smart;
        if (!pick || rank > pick[0]) pick = [rank, u, info];
      }
    }
    return pick ? ['special', pick[1], pick[2]] : null;
  }
  tactical(b, team) {
    const opts = b.trainerOptions(team);
    if (!Object.keys(opts).length) return null;
    const saving = this.saving(b, team), allies = b.teamAlive(team);
    if (opts.overcharge && !saving) {
      for (const a of [...opts.overcharge].sort((x, y) => unitValue(y) - unitValue(x))) {
        if (a.smeter < 60 && b.specialValue(a)[0] >= ABILITIES[a.special].smart) return ['trainer', 'overcharge', a];
      }
    }
    if (opts.rally && !saving) {
      const engaged = allies.filter((a) => a.target && a.target.active).length;
      if (engaged >= 4 && (b.tenergy[team] >= 7 || b.readySpecials(team).length)) return ['trainer', 'rally', null];
    }
    if (b.tenergy[team] >= 9.5 && !(b.kits[team].includes('revive') && !b.reviveUsed[team])) {
      for (const ab of ['mend', 'shield']) if (opts[ab]) { const a = best(opts[ab], (x) => -x.hpf); if (a.hpf < 0.8) return ['trainer', ab, a]; }
      if (opts.rally) return ['trainer', 'rally', null];
    }
    return null;
  }
}

/** For the human player: only auto-fires Specials (optional toggle); trainer abilities stay manual. */
export class AutoSpecials { decide(b, team) { return new SmartPolicy({ trainer: false }).decide(b, team); } }
