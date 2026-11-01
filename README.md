# Project Ember — creature tactics prototype

**Play:** https://jasoromir.github.io/protogame/

A browser prototype of a creature-collecting real-time auto-battler: creatures fight on their own,
you aim their Specials, time trainer abilities, and chain elemental combos.

## How to play
- **Deploy:** drag your creatures onto the blue-edged tiles before each fight. Hover a tile to see its terrain effect.
- **Specials:** when a portrait glows gold, click it (or press 1–6). Time slows down: aim on the board and click to fire. Right-click / Esc cancels.
- **Trainer abilities:** Q / W / E. Mend, Shield and Overcharge need a target: press the key, then click one of your creatures.
- **Combos:** every element leaves a mark; a different element on that mark sets off a combo
  (Soak + Shock = Conduct stun chain, Soak + Chill = Flash Freeze, Freeze + Earth = Shatter…). Chain them for a multiplier.
- **Duos:** some pairs of creatures on the same team unlock special synergies (e.g. Brinehorn + Zippit = Storm Surge).
- **Gym runs:** 3 fights in a row; pick a boon after each win.
- Space pauses, 1×/2×/3× speed. Progress is saved in your browser.

## Run locally
```
python3 serve.py      # then open http://127.0.0.1:8790/
```

## Credits
- 3D engine: [three.js](https://threejs.org) (MIT, see `vendor/three/LICENSE`)
- Creature models generated from concept art with Tripo AI, rigged and animated in Blender
- Everything else: work in progress. Creatures without a model yet appear as placeholder figures.
