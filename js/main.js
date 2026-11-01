// App shell: owns the 3D stage, the save, and switches between screens, gym runs and battles.
import { Stage } from './render/stage.js';
import { loadAssets } from './render/units.js';
import { PortraitStudio } from './render/portraits.js';
import { BattleScene } from './game/battle.js';
import { Diorama, titleScreen, resultsScreen, boonScreen, teamScreen, codexScreen, howToPlay } from './ui/screens.js';
import { WorldScene } from './world/world.js';
import { MAPS } from './sim/maps.js';
import { SmartPolicy, EagerPolicy } from './sim/policies.js';
import { BOONS, offerBoons } from './sim/synergies.js';
import { CARDS } from './sim/cards.js';
import { LINES, PACING, statsFor } from './data/creatures.js';
import * as P from './game/progress.js';

const GYM_ELEMENT_LINES = (el) => Object.keys(LINES).filter((l) => LINES[l].element.includes(el));
const shuffle = (a) => [...a].sort(() => Math.random() - 0.5);

class App {
  async init() {
    this.stage = new Stage(document.getElementById('view'));
    this.overlay = document.getElementById('ui');
    this.save = P.load();
    this.assets = await loadAssets();
    this.portraits = new PortraitStudio(this.assets);
    document.getElementById('loading').remove();
    this.backdrop();
    titleScreen(this);
  }
  get inGame() { return !!this.save; }
  persist() { P.save(this.save); }
  setScreen(el) {
    if (this.screen) this.screen.remove();
    this.screen = el;
    if (el) this.overlay.appendChild(el);
  }
  backdrop() { if (!this.diorama && !this.world) this.diorama = new Diorama(this); }
  dropBackdrop() { if (this.diorama) { this.diorama.dispose(); this.diorama = null; } }
  /** The hub is the open world. */
  showMap() {
    this.run = null;
    this.setScreen(null);
    this.dropBackdrop();
    if (!this.world) this.world = new WorldScene(this);
    else this.world.resume();
    if (this.lastWild !== undefined) { this.world.afterBattle(this.lastWild); this.lastWild = undefined; }
  }
  /** Menus opened from the world: freeze the player while the panel is up. */
  _overWorld() { if (this.world) { this.world.busy = true; this.world.keys.clear(); } }
  openTeam() { this._overWorld(); teamScreen(this, null); }
  openCodex() { this._overWorld(); codexScreen(this); }
  openHowTo() { this._overWorld(); howToPlay(this, () => this.showMap()); }
  prepareBattle(gym) { this._overWorld(); teamScreen(this, gym); }
  toTitle() {
    if (this.world) { this.world.dispose(); this.world = null; }
    this.stage.boardGroup.visible = true;
    this.backdrop();
    titleScreen(this);
  }
  rememberPositions(positions) { P.rememberPositions(this.save, positions); this.persist(); }

  // ---------- entry points ----------
  startBattle(opp) {
    if (opp.training || opp.wild) return this._fight({ opp, training: true });
    this.run = { gym: opp, stage: 0, boons: [], enemyBoons: [shuffle(BOONS.filter((b) => b.element === opp.element))[0]?.id].filter(Boolean) };
    this._fight({ opp });
  }

  _enemyFor(opp, stage, training) {
    const n = this.save.teamSize;   // opponents field as many creatures as you can
    if (opp.wild) {
      return { defs: opp.creatures.map((w) => statsFor({ line: w.line, level: w.level })), map: MAPS[opp.map],
               policy: new EagerPolicy(), title: `Wild ${opp.creatures.map((w) => w.line).join(' & ')}`, subtitle: 'wild encounter', boons: [], trainer: [] };
    }
    if (training) {
      const lv = Math.max(PACING.startLevel - 1, P.averageLevel(this.save) - 1);
      return { defs: shuffle(Object.keys(LINES)).slice(0, n).map((l) => statsFor({ line: l, level: lv, path: Math.random() < 0.5 ? 'A' : 'B' })),
               map: MAPS[shuffle(Object.keys(MAPS))[0]], policy: new EagerPolicy(), title: 'Training Grounds', subtitle: 'practice', boons: [], trainer: ['mend'] };
    }
    if (stage < 2) {   // gym trainers: two of the gym's element + four others, a bit below the leader's level
      const own = GYM_ELEMENT_LINES(opp.element);
      const others = shuffle(Object.keys(LINES).filter((l) => !own.includes(l)));
      const lv = opp.level - 2 + stage;
      return { defs: [...own, ...others].slice(0, n).map((l) => statsFor({ line: l, level: lv, path: Math.random() < 0.5 ? 'A' : 'B' })),
               map: MAPS[opp.map], policy: stage === 0 ? new EagerPolicy() : new SmartPolicy(),
               title: `${opp.name} · Trainer ${stage + 1}`, subtitle: `fight ${stage + 1} of 3`, boons: [], trainer: ['mend'] };
    }
    return { defs: opp.team.slice(0, n).map((l) => statsFor({ line: l, level: opp.level, path: (opp.paths || {})[l] || 'A' })),
             map: MAPS[opp.map], policy: new SmartPolicy(), title: `${opp.name} · Leader ${opp.leader}`, subtitle: 'final fight',
             boons: this.run.enemyBoons, trainer: ['mend', 'rally'] };
  }

  _fight({ opp, training = false }) {
    this.dropBackdrop();
    if (this.world) this.world.suspend();
    this.setScreen(null);
    const s = this.save;
    const team = P.teamCreatures(s).slice(0, s.teamSize);
    const stage = this.run ? this.run.stage : 0;
    const enemy = this._enemyFor(opp, stage, training);
    this.battleScene = new BattleScene(this, {
      playerDefs: team.map((c) => statsFor(c)), enemyDefs: enemy.defs, map: enemy.map, trainerCards: s.kit,
      enemyPolicy: enemy.policy, enemyTrainer: enemy.trainer, title: enemy.title, subtitle: enemy.subtitle, wild: !!opp.wild,
      boonsA: this.run ? this.run.boons : [], boonsB: enemy.boons, posA: P.savedPositions(s),
      onEnd: ({ won, battle, captured }) => this._afterFight(opp, training, won, team, battle, captured),
    });
  }

  _afterFight(opp, training, won, team, battle, captured = []) {
    this.battleScene.dispose();
    this.battleScene = null;
    const s = this.save;
    s.battles++;
    P.markSeen(s, battle.units.filter((u) => u.team === 1).map((u) => u.name));
    const last = training || !won || this.run.stage === 2;
    const xp = won ? (last ? PACING.xpWin : Math.round(PACING.xpWin * 0.6)) : PACING.xpLoss;
    const reports = P.grantXp(s, team.map((c) => c.uid), xp);
    if (!last) {
      // mid-run: pick a boon, then the next fight
      this.persist();
      const offers = offerBoons(team.map((c) => c.line), (l) => LINES[l].element, this.run.boons);
      boonScreen(this, {
        title: `Fight ${this.run.stage + 1} of 3 won!`, offers, reports,
        owned: this.run.boons.map((id) => BOONS.find((b) => b.id === id).name),
        onPick: (id) => { this.run.boons.push(id); this.run.stage++; this._fight({ opp }); },
      });
      return;
    }
    const reward = won && !training ? P.grantGymReward(s, opp) : (captured.length ? {} : null);
    if (reward) reward.captured = captured.map((u) => P.addCaptured(s, u.line, u.def.level));
    this.persist();
    this.run = null;
    if (opp.wild) this.lastWild = won;
    resultsScreen(this, { won, reports, reward, opponent: opp });
  }
}

const app = new App();
window.__app = app;  // handy for debugging in the browser console
window.__cards = CARDS;
app.init().catch((e) => {
  console.error(e);
  document.getElementById('loading').textContent = `Failed to start: ${e.message}`;
});
