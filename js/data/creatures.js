// Creature lines, forms and stats. Mirrors game_design/02_creatures_and_elements.md and sim/creatures.py.
// Stats are max-level values; the game scales them by level (see statsFor).

export const ELEMENTS = {
  fire: { color: '#ff6a2b', name: 'Fire', status: 'Burn' },
  water: { color: '#2fa8d8', name: 'Water', status: 'Soak' },
  ice: { color: '#9fe3ff', name: 'Ice', status: 'Chill' },
  electric: { color: '#ffd23a', name: 'Electric', status: 'Shock' },
  earth: { color: '#b98a4e', name: 'Earth', status: 'Crack' },
};

const S = (hp, atk, aspd, range, armor, move) => ({ hp, atk, aspd, range, armor, move });

// forms[i].at = level the line evolves into this form. A form with `paths` is a branch point.
export const LINES = {
  Cindrake: {
    skill: 'ember_burst', ult: 'inferno_breath',
    element: ['fire'], role: 'Mage', stats: S(750, 70, 0.8, 3, 20, 1.0),
    abilities: ['flame_spit', 'wing_gust'], passive: 'kindling', special: 'inferno_breath',
    forms: [
      { name: 'Cindrake', at: 1 },
      { name: 'Cinderwing', at: 'EVO1' },
      { at: 'EVO2', paths: {
        A: { name: 'Pyrewyrm', key: 'Volcanic Heart', role: 'Mage', blurb: 'Beast dragon. Ranged mage: Inferno Breath scorches a cone.' },
        B: { name: 'Ignarion', key: "Warrior's Crest", role: 'Duelist', blurb: 'Humanoid dragon warrior. Melee duelist: Meteor Dive slams the target.',
             stats: S(1050, 75, 0.95, 1, 35, 1.1), passive: 'ember_blade', ult: 'meteor_dive' },
      } },
    ],
  },
  Ashlet: {
    skill: 'kindle', ult: 'sunflare',
    element: ['fire'], role: 'Support', stats: S(650, 40, 0.9, 2, 15, 1.0),
    abilities: ['warm_embers', 'cauterize'], passive: 'rekindle', special: 'sunflare',
    forms: [{ name: 'Ashlet', at: 1 }, { name: 'Phoenara', at: 'EVO_TWO' }],
  },
  Brinehorn: {
    skill: 'tidal_charge', ult: 'tidal_wave',
    element: ['water'], role: 'Tank', stats: S(1400, 45, 0.7, 1, 45, 0.8),
    abilities: ['tidal_charge', 'brace'], passive: 'undertow', special: 'tidal_wave',
    forms: [{ name: 'Brinehorn', at: 1 }],
  },
  Lotl: {
    skill: 'bubble', ult: 'wellspring',
    element: ['water'], role: 'Support', stats: S(700, 35, 1.0, 3, 20, 1.0),
    abilities: ['bubble', 'splash'], passive: 'hydrate', special: 'wellspring',
    forms: [{ name: 'Lotl', at: 1 }, { name: 'Mirelle', at: 'EVO_TWO' }],
  },
  Hrimfang: {
    skill: 'frost_shard', ult: 'avalanche_pounce',
    element: ['ice'], role: 'Assassin', stats: S(800, 85, 1.1, 1, 20, 1.4),
    abilities: ['frostbite', 'blizzard_veil'], passive: 'shatter', special: 'avalanche_pounce',
    forms: [{ name: 'Hrimfang', at: 1 }, { name: 'Frostfang', at: 'EVO1' }, { name: 'Glacierfang', at: 'EVO2' }],
  },
  Flurrette: {
    skill: 'ice_wall', ult: 'whiteout',
    element: ['ice'], role: 'Controller', stats: S(700, 45, 0.9, 3, 20, 1.0),
    abilities: ['snowdrift', 'ice_wall'], passive: 'frost_aura', special: 'whiteout',
    forms: [{ name: 'Flurrette', at: 1 }],
  },
  Zippit: {
    skill: 'static_charge', ult: 'lightning_lance',
    element: ['electric'], role: 'Marksman', stats: S(600, 55, 1.25, 4, 10, 1.2),
    abilities: ['spark_shot', 'zip'], passive: 'static_build', special: 'lightning_lance',
    forms: [{ name: 'Zippit', at: 1 }, { name: 'Thundraxa', at: 'EVO_TWO' }],
  },
  Raijura: {
    skill: 'lightning_dash', ult: 'storm_leap',
    element: ['electric'], role: 'Bruiser', stats: S(1100, 72, 1.05, 1, 30, 1.25),
    abilities: ['thunder_claw', 'lightning_dash'], passive: 'overload', special: 'stormcall',
    forms: [{ name: 'Raijura', at: 1 }, { name: 'Raijuron', at: 'EVO1' },
            { name: 'Raigar', at: 'EVO2', role: 'Duelist', ult: 'storm_avatar' }],
  },
  Terragon: {
    skill: 'stone_skin', ult: 'tectonic_rise',
    element: ['earth'], role: 'Tank', stats: S(1500, 50, 0.6, 1, 50, 0.7),
    abilities: ['quake_stomp', 'stone_skin'], passive: 'grounded', special: 'tectonic_rise',
    forms: [{ name: 'Terragon', at: 1 }, { name: 'Craghorn', at: 'EVO1' }, { name: 'Terravault', at: 'EVO2' }],
  },
  Mossfawn: {
    skill: 'bloom', ult: 'sanctuary_grove',
    element: ['earth'], role: 'Healer', stats: S(750, 35, 0.9, 3, 25, 1.0),
    abilities: ['bloom', 'thornroot'], passive: 'overgrowth', special: 'sanctuary_grove',
    forms: [{ name: 'Mossfawn', at: 1 }, { name: 'Sylvara', at: 'EVO_TWO' }],
  },
};

// Prototype pacing (fast, so specials and evolutions show up within a few fights)
export const PACING = {
  maxLevel: 30, startLevel: 12,
  unlock: { a2: 5, passive: 9, a3: 11, special: 13 },
  evo: { EVO1: 14, EVO2: 20, EVO_TWO: 17 },
  xpToNext: (lv) => 15 * lv + 40,
  xpWin: 240, xpLoss: 90,
};

// How each form looks. Forms without a model get a placeholder figure in their element color.
export const LOOKS = {
  Cindrake: { model: 'Cindrake', scale: 1.0 },
  Cinderwing: { model: 'Cindrake', scale: 1.3, tint: 0xffd0b0 },
  Pyrewyrm: { model: 'Cindrake', scale: 1.75, tint: 0xb07060 },
  Ignarion: { model: 'Ignarion', scale: 1.0 },
  Brinehorn: { model: 'Brinehorn', scale: 1.0 },
};

export const ABILITY_NAMES = {
  flame_spit: 'Flame Spit', wing_gust: 'Wing Gust', kindling: 'Kindling', inferno_breath: 'Inferno Breath',
  ember_blade: 'Ember Blade', meteor_dive: 'Meteor Dive',
  warm_embers: 'Warm Embers', cauterize: 'Cauterize', rekindle: 'Rekindle', sunflare: 'Sunflare',
  tidal_charge: 'Tidal Charge', brace: 'Brace', undertow: 'Undertow', riptide: 'Riptide',
  bubble: 'Bubble', splash: 'Splash', hydrate: 'Hydrate', wellspring: 'Wellspring',
  frostbite: 'Frostbite', blizzard_veil: 'Blizzard Veil', shatter: 'Shatter', avalanche_pounce: 'Avalanche Pounce',
  snowdrift: 'Snowdrift', ice_wall: 'Ice Wall', frost_aura: 'Frost Aura', whiteout: 'Whiteout',
  spark_shot: 'Spark Shot', zip: 'Zip', static_build: 'Static Build', thunderstorm: 'Thunderstorm',
  thunder_claw: 'Thunder Claw', lightning_dash: 'Lightning Dash', overload: 'Overload', stormcall: 'Stormcall',
  storm_avatar: 'Storm Avatar', tidal_wave: 'Tidal Wave', lightning_lance: 'Lightning Lance',
  ember_burst: 'Ember Burst', aqua_jet: 'Aqua Jet', frost_shard: 'Frost Shard', static_field: 'Static Field', rock_throw: 'Rock Throw',
  quake_stomp: 'Quake Stomp', stone_skin: 'Stone Skin', grounded: 'Grounded', tectonic_rise: 'Tectonic Rise',
  bloom: 'Bloom', thornroot: 'Thornroot', overgrowth: 'Overgrowth', sanctuary_grove: 'Sanctuary Grove',
};

// Third active ability every creature can learn: its element's move.
export const ELEMENT_MOVE = { fire: 'ember_burst', water: 'aqua_jet', ice: 'frost_shard', electric: 'static_field', earth: 'rock_throw' };

export const ABILITY_DESC = {
  flame_spit: 'Fireball: 150% damage + Burn.', wing_gust: 'Knocks an adjacent enemy back.', kindling: '+10% damage to Burning enemies.',
  inferno_breath: 'Aimed cone: 300% damage + Burn, leaves lava.', ember_blade: 'Every 3rd attack Burns; faster on lava.',
  meteor_dive: 'Aimed: leaps and slams an area, 280% damage + Burn.',
  warm_embers: 'An ally attacks 20% faster for 4s.', cauterize: 'Heals an ally 15% and removes Chill/Soak.',
  rekindle: 'The first time it falls, it is reborn after 3s.', sunflare: 'All allies +30% damage for 5s; Burns nearby enemies.',
  tidal_charge: 'Charges, stuns 1s and Soaks.', brace: 'Takes 40% less damage for 3s.', undertow: 'Soaked enemies next to it are slowed.',
  tidal_wave: 'Aimed line: a wave that Soaks, pushes back and floods the tiles.',
  bubble: 'Shields an ally.', splash: 'Soaks a small group.', hydrate: 'Allies in rivers regenerate.', wellspring: 'Aimed area: floods tiles and shields allies inside.',
  frostbite: 'Bite: 140% damage + Chill.', blizzard_veil: 'Turns invisible and slips behind the enemy line.',
  shatter: '+50% damage to Frozen enemies.', avalanche_pounce: 'Aimed: leaps onto one enemy for 350% damage.',
  snowdrift: 'Chills a small group.', ice_wall: 'Raises an ice wall in an attacker\'s path.', frost_aura: 'Nearby enemies attack 15% slower.',
  whiteout: 'Aimed area: Freezes every enemy inside.',
  spark_shot: 'Shot that Shocks and chains to a second enemy.', zip: 'Dashes away from melee attackers.',
  static_build: 'Every 3rd attack Shocks.', lightning_lance: 'Aimed line: pierces every enemy in a row, Shocks them.',
  thunder_claw: 'Claw: 180% damage + Shock.', lightning_dash: 'Dashes to a distant enemy and stuns it.',
  overload: 'Double energy from hitting Shocked enemies.', stormcall: '6s: attack 50% faster, attacks chain.',
  storm_avatar: '6s: attack 50% faster, attacks chain to 2 enemies.',
  quake_stomp: 'Cracks all adjacent enemies.', stone_skin: 'Shields itself for 25% of its HP.', grounded: 'Immune to Shock; tougher on high ground.',
  tectonic_rise: 'Raises high ground around itself and taunts nearby enemies.',
  bloom: 'Heals the most wounded ally 20%.', thornroot: 'Roots an enemy that threatens your back line.', overgrowth: 'Heals more on allies in brush.',
  sanctuary_grove: 'Aimed area: grows brush that heals allies inside.',
  ember_burst: 'Small fire explosion: Burns a group.', aqua_jet: 'Water shot: 120% damage + Soak.', frost_shard: 'Ice shot: 120% damage + Chill.',
  static_field: 'Shocks every adjacent enemy.', rock_throw: 'Boulder: 130% damage + Crack.',
};

/** Active abilities a creature knows at its level (it equips 2). */
export function knownAbilities(c) {
  const line = LINES[c.line], u = PACING.unlock;
  return [[line.abilities[0], 1], [line.abilities[1], u.a2], [ELEMENT_MOVE[line.element[0]], u.a3]]
    .map(([id, at]) => ({ id, at, known: c.level >= at }));
}
/** The automatic ability (fires on its own from the creature's attack energy). */
export function autoAbility(c) {
  const known = knownAbilities(c).filter((a) => a.known).map((a) => a.id);
  const chosen = (c.equipped || [])[0];
  if (known.includes(chosen)) return chosen;
  return known.find((id) => id !== LINES[c.line].skill) || known[0];
}
export const equipped = (c) => [autoAbility(c)];

const evoLevel = (at) => (typeof at === 'number' ? at : PACING.evo[at]);

/** The form a creature instance is in, given its level and chosen path. */
export function currentForm(c) {
  const line = LINES[c.line];
  let form = line.forms[0];
  for (const f of line.forms) {
    if (c.level < evoLevel(f.at)) break;
    if (f.paths) {
      if (!c.path) return { ...form, pendingPaths: f.paths };
      form = { ...f.paths[c.path], path: c.path };
    } else form = f;
  }
  return form;
}

/** Next evolution: {level, name} or {level, paths}, or null. */
export function nextEvolution(c) {
  const line = LINES[c.line];
  for (const f of line.forms) if (c.level < evoLevel(f.at)) return { level: evoLevel(f.at), ...f };
  return null;
}

/** Battle definition for one creature instance: scaled stats, unlocked abilities, form overrides. */
export function statsFor(c) {
  const line = LINES[c.line];
  const form = currentForm(c);
  const base = form.stats || line.stats;
  const k = 0.55 + 0.45 * Math.min(c.level, PACING.maxLevel) / PACING.maxLevel;
  const u = PACING.unlock;
  return {
    line: c.line, name: form.name, element: line.element, role: form.role || line.role,
    hp: base.hp * k, atk: base.atk * k, aspd: base.aspd, range: base.range, armor: base.armor, move: base.move,
    auto: autoAbility(c),
    cards: [form.skill || line.skill, ...(c.level >= u.special ? [form.ult || line.ult] : [])],
    passive: c.level >= u.passive ? (form.passive || line.passive) : null,
    special: form.ult || line.ult,
    level: c.level, look: LOOKS[form.name] || null,
  };
}
