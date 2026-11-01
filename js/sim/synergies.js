// Duo synergies (pairs of creatures on the same team) and run boons (picked between gym fights).
// See game_design/06_combat_v2.md.

export const DUOS = [
  { id: 'storm_surge', name: 'Storm Surge', pair: ['Brinehorn', 'Zippit'], desc: 'Tidal Wave also Shocks: every enemy it hits is stunned by Conduct.' },
  { id: 'glacial_tide', name: 'Glacial Tide', pair: ['Brinehorn', 'Flurrette'], desc: 'Tidal Wave also Chills: every enemy it hits is Flash Frozen.' },
  { id: 'frostfire', name: 'Frostfire', pair: ['Cindrake', 'Flurrette'], desc: 'Inferno Breath leaves steam instead of lava. Thermal Shock +50%.' },
  { id: 'living_volcano', name: 'Living Volcano', pair: ['Cindrake', 'Terragon'], desc: 'Quake Stomp also Burns, setting off Magma.' },
  { id: 'thunderhunt', name: 'Thunderhunt', pair: ['Hrimfang', 'Raijura'], desc: 'Both deal +30% damage to Shocked or Chilled enemies.' },
  { id: 'tidal_bloom', name: 'Tidal Bloom', pair: ['Lotl', 'Mossfawn'], desc: 'All healing on your team +30%.' },
  { id: 'phoenix_spark', name: 'Phoenix Spark', pair: ['Ashlet', 'Zippit'], desc: 'When Ashlet rekindles, it explodes in a Plasma Burst.' },
  { id: 'stonewall', name: 'Stonewall', pair: ['Brinehorn', 'Terragon'], desc: 'Brace and Stone Skin also taunt adjacent enemies.' },
];

export function activeDuos(lines) {
  const have = new Set(lines);
  return DUOS.filter((d) => d.pair.every((l) => have.has(l)));
}

// Boons: modifiers for one gym run. `mods` keys are read by the engine.
export const BOONS = [
  { id: 'fire_might', name: 'Blaze Sigil', element: 'fire', desc: 'Fire damage +20%.', mods: { dmgElement: { fire: 0.2 } } },
  { id: 'water_might', name: 'Tide Sigil', element: 'water', desc: 'Water damage +20%.', mods: { dmgElement: { water: 0.2 } } },
  { id: 'ice_might', name: 'Frost Sigil', element: 'ice', desc: 'Ice damage +20%.', mods: { dmgElement: { ice: 0.2 } } },
  { id: 'electric_might', name: 'Storm Sigil', element: 'electric', desc: 'Electric damage +20%.', mods: { dmgElement: { electric: 0.2 } } },
  { id: 'earth_might', name: 'Stone Sigil', element: 'earth', desc: 'Earth damage +20%.', mods: { dmgElement: { earth: 0.2 } } },
  { id: 'combo_master', name: 'Chain Reaction', desc: 'Combo damage +35%.', mods: { comboDmg: 0.35 } },
  { id: 'quick_specials', name: 'Battle Focus', desc: 'Your shared energy refills 20% faster.', mods: { energyRate: 0.2 } },
  { id: 'trainer_flow', name: "Trainer's Resolve", desc: 'Start every fight with +2 energy.', mods: { startEnergy: 2 } },
  { id: 'tough_hide', name: 'Iron Hide', desc: 'All your creatures +15 armor.', mods: { armor: 15 } },
  { id: 'vigor', name: 'Vigor', desc: 'All your creatures +15% max HP.', mods: { hp: 0.15 } },
  { id: 'opening_haste', name: 'Opening Rush', desc: '+40% attack speed for the first 10 seconds.', mods: { openingHaste: 0.4 } },
  { id: 'lifesteal', name: 'Leech Fang', desc: 'Basic attacks heal for 10% of the damage dealt.', mods: { lifesteal: 0.1 } },
  { id: 'long_status', name: 'Lingering Marks', desc: 'Your statuses last 40% longer (more time to combo).', mods: { statusDur: 0.4 } },
  { id: 'quick_abilities', name: 'Second Wind', desc: 'Abilities 1 and 2 recharge 30% faster.', mods: { abilityCd: -0.3 } },
];

/** 3 boon offers, weighted toward the elements on the team. */
export function offerBoons(lines, elementsOf, owned, rng = Math.random) {
  const teamEls = new Set(lines.flatMap(elementsOf));
  const pool = BOONS.filter((b) => !owned.includes(b.id) && (!b.element || teamEls.has(b.element)));
  const out = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

export function combineMods(boonIds) {
  const m = { dmgElement: {} };
  for (const id of boonIds) {
    const b = BOONS.find((x) => x.id === id);
    if (!b) continue;
    for (const [k, v] of Object.entries(b.mods)) {
      if (k === 'dmgElement') for (const [e, x] of Object.entries(v)) m.dmgElement[e] = (m.dmgElement[e] || 0) + x;
      else m[k] = (m[k] || 0) + v;
    }
  }
  return m;
}
