// The four gyms of the prototype, in unlock order. Each is a single 6v6 fight.
export const GYMS = [
  { id: 'ember', name: 'Ember Gym', leader: 'Kaela', element: 'fire', map: 'caldera', level: 13,
    intro: 'Kaela fights with fire and fury. Watch out for lava when the caldera erupts.',
    team: ['Ashlet', 'Cindrake', 'Terragon', 'Raijura', 'Flurrette', 'Mossfawn'],
    reward: { creatures: ['Hrimfang', 'Ashlet'], key: 'Volcanic Heart' } },
  { id: 'tide', name: 'Tide Gym', leader: 'Maren', element: 'water', map: 'riverlands', level: 16,
    intro: 'Maren soaks your team, then shocks it. Spread out to avoid Conduct chains.',
    team: ['Brinehorn', 'Lotl', 'Zippit', 'Raijura', 'Flurrette', 'Mossfawn'],
    reward: { creatures: ['Raijura', 'Flurrette'], key: 'Tide Badge' } },
  { id: 'storm', name: 'Storm Gym', leader: 'Volt', element: 'electric', map: 'stormpeaks', level: 19,
    intro: 'Volt holds the high ground. Earth creatures are immune to Shock.',
    team: ['Zippit', 'Raijura', 'Brinehorn', 'Lotl', 'Hrimfang', 'Terragon'],
    reward: { creatures: ['Flurrette', 'Ashlet'], key: "Warrior's Crest" } },
  { id: 'grove', name: 'Grove Gym', leader: 'Sylva', element: 'earth', map: 'grove', level: 22,
    intro: 'Sylva heals through everything in her brush. Burn the brush, then burn her team.',
    team: ['Terragon', 'Mossfawn', 'Cindrake', 'Hrimfang', 'Ashlet', 'Lotl'], paths: { Cindrake: 'B' },
    reward: { creatures: ['Ashlet', 'Hrimfang'], key: 'Champion Seal' } },
];

export const TRAINING = { id: 'training', name: 'Training Grounds', leader: 'Wild creatures',
  intro: 'A practice fight against wild creatures around your level. Earns XP.' };
