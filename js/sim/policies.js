// Card-playing AI (Combat 3.0). Used by opponents, and by the player's optional auto-cast.
//   SmartPolicy: plays the card with the best value (favoring bigger cards), aims it well, and never
//                sits at full energy. (Holding energy for ultimates tested no better in the simulator.)
//   EagerPolicy: plays any useful card as soon as it can afford it (easy opponents).
import { CARDS } from './cards.js';

const threshold = (c) => (c.kind === 'ult' ? 2 : 1);

function options(b, team) {
  const out = [];
  for (const entry of b.hands[team]) {
    const c = CARDS[entry.card];
    const u = b.caster(entry);
    if (entry.uid !== null && (!u || !u.active)) continue;
    const [score, aim] = c.ai(b, u || team);
    if (!(score > 0) || !aim) continue;
    if (b.cardProblem(team, entry, aim)) continue;
    out.push({ entry, c, score, aim, rank: score / threshold(c) });
  }
  return out;
}

export class SmartPolicy {
  decide(b, team) {
    const opts = options(b, team);
    if (!opts.length) return null;
    const energy = b.energy[team];
    const affordable = opts.filter((o) => o.c.cost <= energy && o.rank >= 1);
    const full = energy >= b.energyCap - 0.5;
    let pick = affordable.sort((x, y) => y.rank * Math.sqrt(y.c.cost) - x.rank * Math.sqrt(x.c.cost))[0];
    if (!pick && full) pick = opts.filter((o) => o.c.cost <= energy).sort((x, y) => y.rank - x.rank)[0];
    return pick ? { key: pick.entry.key, aim: pick.aim } : null;
  }
}

export class EagerPolicy {
  decide(b, team) {
    const o = options(b, team).filter((x) => x.c.cost <= b.energy[team])[0];
    return o ? { key: o.entry.key, aim: o.aim } : null;
  }
}

/** The player's auto-cast toggle: the smart policy playing on their behalf. */
export class AutoSpecials extends SmartPolicy {}
