// A live battle: runs the engine in real time, turns its events into animation and VFX, and drives the HUD.
// Combat 2.0: drag-and-drop deployment, aimed Specials in slow motion, combos, duos, boons, stats.
import * as THREE from 'three';
import { Battle, DT, TRAINER_CAP, COMBOS } from '../sim/engine.js';
import { TRAINER, AIM, aimTiles } from '../sim/abilities.js';
import { AutoSpecials } from '../sim/policies.js';
import { DUOS, BOONS } from '../sim/synergies.js';
import * as hex from '../sim/hex.js';
import { UnitView } from '../render/units.js';
import { FX, ELEMENT_COLOR } from '../render/fx.js';
import { ABILITY_NAMES, ABILITY_DESC, ELEMENTS } from '../data/creatures.js';

const KEYS = ['q', 'w', 'e'];
const AIM_SLOWMO = 0.2;
const TERRAIN_TIP = {
  plain: 'Grass', high: 'High ground: +1 range, −15% damage taken from below', river: 'River: Soaks whoever stands in it; Water creatures +15% damage',
  brush: 'Brush: hidden from ranged attacks until you attack', lava: 'Lava: Burns whoever stands in it', icewall: 'Ice wall: blocks movement',
  charged: 'Charged: Shocks whoever stands in it', frozen: 'Frozen river: walkable', steam: 'Steam: creatures inside deal −40% damage', mud: 'Mud: slows movement',
};

export class BattleScene {
  constructor(app, { playerDefs, enemyDefs, map, kit, enemyPolicy, enemyKit, title, subtitle = '', boonsA = [], boonsB = [], posA = null, onEnd }) {
    this.app = app;
    this.stage = app.stage;
    this.onEnd = onEnd;
    this.title = title;
    this.subtitle = subtitle;
    this.kit = kit;
    this.map = map;
    this.boonsA = boonsA;
    this.overlay = app.overlay;
    this.stage.setMap(map);
    this.stage.setBattleCamera();
    this.fx = new FX(this.stage, this.overlay);
    this.speed = app.save.settings.speed || 1;
    this.battle = new Battle({ teamA: playerDefs, teamB: enemyDefs, map, policyA: null, policyB: enemyPolicy,
      kitA: kit, kitB: enemyKit, hpScale: 6, seed: (Math.random() * 1e9) | 0, posA, boonsA, boonsB });
    if (app.save.settings.autoSpecials) this.battle.policies[0] = new AutoSpecials();
    this.ctx = { stage: this.stage, fx: this.fx, assets: app.assets, overlay: this.overlay, views: new Map() };
    for (const u of this.battle.units) this.ctx.views.set(u.uid, new UnitView(this.ctx, u));
    this.phase = 'deploy';
    this.acc = 0;
    this.paused = false;
    this.targeting = null;   // trainer ability waiting for a target
    this.aiming = null;      // Special being aimed
    this.drag = null;
    this.hoverTile = null;
    this._buildHud();
    this._handlers = {
      keydown: (e) => this._key(e),
      pointerdown: (e) => this._down(e), pointermove: (e) => this._move(e), pointerup: (e) => this._up(e),
      contextmenu: (e) => { e.preventDefault(); this._cancel(); },
    };
    window.addEventListener('keydown', this._handlers.keydown);
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'contextmenu']) this.stage.canvas.addEventListener(ev, this._handlers[ev]);
    this.stage.onFrame = (dt) => this._frame(dt);
    this._refreshMarks();
  }

  view(u) { return this.ctx.views.get(u.uid); }
  head(u) { const v = this.view(u); return v.root.position.clone().add(new THREE.Vector3(0, v.height * 0.6, 0)); }

  // ---------------- HUD ----------------
  _buildHud() {
    const b = this.battle;
    const el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="hud-top">
        <div class="hud-title">${this.title}<span class="hud-map">${this.map.name}${this.subtitle ? ` · ${this.subtitle}` : ''}</span></div>
        <div class="hud-clock">0:00</div>
        <div class="hud-event"></div>
        <div class="hud-controls">
          <button data-speed="1">1×</button><button data-speed="2">2×</button><button data-speed="3">3×</button>
          <button class="pause" title="Space">❚❚</button>
          <label class="auto"><input type="checkbox" ${this.app.save.settings.autoSpecials ? 'checked' : ''}> Auto Specials</label>
        </div>
      </div>
      <div class="hud-left">
        <div class="syn"><h4>Synergies</h4><div class="syn-list"></div></div>
        <div class="combo-feed"></div>
      </div>
      <div class="hud-enemies"></div>
      <div class="deploy-banner"><b>Deploy</b><span><b>Drag</b> your creatures onto any blue-edged tile (drop on another creature to swap). Hover a tile to see what it does.</span><button class="fight">Fight! <small>(Space)</small></button></div>
      <div class="tile-tip"></div>
      <div class="hud-bottom">
        <div class="portraits"></div>
        <div class="trainer">
          <div class="tr-label">Trainer energy <b class="tr-num">0</b>/${TRAINER_CAP}</div>
          <div class="tr-bar">${'<i></i>'.repeat(TRAINER_CAP)}</div>
          <div class="tr-buttons"></div>
        </div>
      </div>
      <div class="hint"></div>
      <div class="banner"></div>
      <div class="aim-vignette"></div>`;
    this.overlay.appendChild(el);
    this.hud = el;
    this.clock = el.querySelector('.hud-clock');
    this.eventEl = el.querySelector('.hud-event');
    this.hintEl = el.querySelector('.hint');
    this.bannerEl = el.querySelector('.banner');
    this.tipEl = el.querySelector('.tile-tip');
    this.feedEl = el.querySelector('.combo-feed');
    el.querySelectorAll('[data-speed]').forEach((btn) => btn.addEventListener('click', () => this._setSpeed(+btn.dataset.speed)));
    el.querySelector('.pause').addEventListener('click', () => this._togglePause());
    el.querySelector('.auto input').addEventListener('change', (e) => {
      this.app.save.settings.autoSpecials = e.target.checked; this.app.persist();
      b.policies[0] = e.target.checked ? new AutoSpecials() : null;
    });
    el.querySelector('.fight').addEventListener('click', () => this._start());
    this._setSpeed(this.speed);
    // synergy panel
    const syn = [];
    for (const d of DUOS) if (b.hasDuo(0, d.id)) syn.push(`<div class="syn-duo" title="${d.desc}"><b>${d.name}</b><small>${d.pair.join(' + ')}</small><p>${d.desc}</p></div>`);
    for (const [e, n] of Object.entries(b.elemCount[0])) {
      const tier = n >= 3 ? 'Statuses last longer · combos +25%' : n >= 2 ? 'Statuses last 50% longer' : `${2 - n} more for a bonus`;
      syn.push(`<div class="syn-el ${n >= 2 ? 'on' : ''}" style="--el:${ELEMENTS[e].color}"><b>${ELEMENTS[e].name} ×${n}</b><small>${tier}</small></div>`);
    }
    for (const id of this.boonsA) { const bn = BOONS.find((x) => x.id === id); if (bn) syn.push(`<div class="syn-boon"><b>✦ ${bn.name}</b><small>${bn.desc}</small></div>`); }
    if (!b.duos[0].size) syn.unshift('<div class="syn-hint">No duos active. Pairs like Brinehorn + Zippit unlock Duo synergies.</div>');
    el.querySelector('.syn-list').innerHTML = syn.join('');
    // portraits
    const pr = el.querySelector('.portraits');
    this.portraits = b.units.filter((u) => u.team === 0).map((u, i) => {
      const p = document.createElement('div');
      p.className = 'portrait';
      p.style.setProperty('--el', ELEMENTS[u.elements[0]].color);
      const img = this.app.portraits ? this.app.portraits.portrait(u.name, u.line) : '';
      const aim = u.special && AIM[u.special] ? AIM[u.special].shape : '';
      p.innerHTML = `<img class="pimg" src="${img}" alt=""><div class="pk">${i + 1}</div><div class="pn">${u.name}</div><div class="pl">Lv ${u.def.level} · ${u.role}</div>
        <div class="pbar hp"><i></i></div><div class="pbar sp"><i></i></div>
        <div class="pspecial" title="${u.special ? ABILITY_DESC[u.special] || '' : ''}">${u.special ? `${ABILITY_NAMES[u.special]} <small>${aim}</small>` : 'Special at Lv 13'}</div>`;
      p.addEventListener('click', () => this._portraitClick(u));
      pr.appendChild(p);
      return { u, el: p, hp: p.querySelector('.hp i'), sp: p.querySelector('.sp i') };
    });
    const en = el.querySelector('.hud-enemies');
    this.enemyBars = b.units.filter((u) => u.team === 1).map((u) => {
      const d = document.createElement('div');
      d.className = 'enemy';
      d.style.setProperty('--el', ELEMENTS[u.elements[0]].color);
      d.innerHTML = `<span>${u.name}</span><div class="pbar hp"><i></i></div>`;
      en.appendChild(d);
      return { u, el: d, hp: d.querySelector('i') };
    });
    const tb = el.querySelector('.tr-buttons');
    this.trButtons = this.kit.map((ab, i) => {
      const d = TRAINER[ab];
      const btn = document.createElement('button');
      btn.className = 'trbtn';
      btn.title = d.desc;
      btn.innerHTML = `<span class="k">${KEYS[i].toUpperCase()}</span>${d.name}<span class="c">${d.cost}</span>`;
      btn.addEventListener('click', () => this._trainer(ab));
      tb.appendChild(btn);
      return { ab, b: btn };
    });
    this.trSegs = [...el.querySelectorAll('.tr-bar i')];
    this.trNum = el.querySelector('.tr-num');
  }

  _setSpeed(s) {
    this.speed = s;
    this.app.save.settings.speed = s;
    this.hud.querySelectorAll('[data-speed]').forEach((btn) => btn.classList.toggle('on', +btn.dataset.speed === s));
  }
  _togglePause() { this.paused = !this.paused; this.hud.querySelector('.pause').textContent = this.paused ? '▶' : '❚❚'; this._hint(this.paused ? 'Paused (Space to resume)' : ''); }
  _hint(t) { this.hintEl.textContent = t; this.hintEl.classList.toggle('on', !!t); }
  _flashHint(t) { this._hint(t); clearTimeout(this._ht); this._ht = setTimeout(() => this._hint(this.aiming ? this._aimText() : ''), 1100); }
  _banner(t, cls = '') {
    this.bannerEl.textContent = t;
    this.bannerEl.className = `banner on ${cls}`;
    clearTimeout(this._bt);
    this._bt = setTimeout(() => this.bannerEl.classList.remove('on'), 1400);
  }

  // ---------------- input ----------------
  _key(e) {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); if (this.phase === 'fight') this._togglePause(); else if (this.phase === 'deploy') this._start(); return; }
    if (k === 'escape') { this._cancel(); return; }
    const n = parseInt(k, 10);
    if (n >= 1 && n <= 6 && this.portraits[n - 1]) this._portraitClick(this.portraits[n - 1].u);
    const ti = KEYS.indexOf(k);
    if (ti >= 0 && this.kit[ti]) this._trainer(this.kit[ti]);
  }
  _cancel() {
    this.targeting = null;
    this.aiming = null;
    this.hud.classList.remove('aiming');
    this._hint('');
    this._refreshMarks();
  }
  _aimText() {
    const a = AIM[this.aiming.special];
    return `Aim ${ABILITY_NAMES[this.aiming.special]} (${a.shape}) · click to fire · right-click or Esc to cancel`;
  }
  _portraitClick(u) {
    if (this.phase === 'deploy') return;
    if (this.phase !== 'fight') return;
    if (this.targeting) {
      this.battle.request(0, { kind: 'trainer', ability: this.targeting, target: u });
      this._cancel();
      return;
    }
    if (!(u.special && u.smeter >= 100 && u.active)) {
      this._flashHint(u.special ? `${ABILITY_NAMES[u.special]} is charging (${Math.floor(u.smeter)}%)` : `${u.name} learns its Special at Lv 13`);
      return;
    }
    const a = AIM[u.special];
    if (!a || a.shape === 'self') { this.battle.request(0, { kind: 'special', unit: u }); return; }
    this.aiming = u;
    this.targeting = null;
    this.hud.classList.add('aiming');
    this._hint(this._aimText());
  }
  _trainer(ab) {
    if (this.phase !== 'fight') return;
    const d = TRAINER[ab];
    if (this.battle.tenergy[0] < d.cost) { this._flashHint(`${d.name} needs ${d.cost} trainer energy`); return; }
    if (!d.targeted) { this.battle.request(0, { kind: 'trainer', ability: ab }); return; }
    if (ab === 'revive' && !d.valid(this.battle, 0).length) { this._flashHint(this.battle.t < 45 ? 'Revive unlocks at 0:45' : 'Nobody to revive'); return; }
    this.aiming = null;
    this.hud.classList.remove('aiming');
    this.targeting = ab;
    this._hint(`${d.name}: click one of your creatures (portrait or on the board). Esc to cancel.`);
  }

  _tileAt(e) { return this.stage.pickTile(e.clientX, e.clientY); }
  _down(e) {
    if (e.button !== 0) return;
    const p = this._tileAt(e);
    if (!p) return;
    if (this.phase === 'deploy') {
      const u = this.battle.occ.get(hex.key(p));
      if (u && u.team === 0) {
        this.drag = { unit: u, from: p, over: p };
        this.stage.canvas.setPointerCapture(e.pointerId);
        this.view(u).body.scale.setScalar(1.15);
      }
    }
  }
  _move(e) {
    const p = this._tileAt(e);
    this.hoverTile = p;
    if (this.phase === 'deploy') {
      if (this.drag && p && p[1] <= 3) {
        this.drag.over = p;
        const v = this.view(this.drag.unit);
        v.root.position.copy(this.stage.tiles.get(hex.key(p)).base).setY(this.stage.tileHeight(p) + 0.25);
      }
      this._tileTip(e, p);
    } else this.tipEl.classList.remove('on');
    if (this.aiming || this.targeting || this.drag) this._refreshMarks();
  }
  _up(e) {
    if (e.button !== 0) return;
    if (this.drag) {
      const { unit, from, over } = this.drag;
      this.drag = null;
      this.view(unit).body.scale.setScalar(1);
      if (over && over[1] <= 3 && !hex.same(over, from) && this.battle.tile(over) !== 'icewall') {
        const other = this.battle.occ.get(hex.key(over));
        this.battle.occ.delete(hex.key(from));
        if (other) { other.pos = from; other.startPos = from; this.battle.occ.set(hex.key(from), other); this.view(other).place(from); }
        unit.pos = over; unit.startPos = over;
        this.battle.occ.set(hex.key(over), unit);
      }
      this.view(unit).place(unit.pos);
      this._refreshMarks();
      return;
    }
    const p = this._tileAt(e);
    if (!p || this.phase !== 'fight') return;
    if (this.aiming) {
      const u = this.aiming;
      this.battle.request(0, { kind: 'special', unit: u, aim: p });
      this._cancel();
      return;
    }
    const u = this.battle.occ.get(hex.key(p)) || (this.targeting === 'revive' ? this.battle.teamDead(0).find((d) => hex.same(d.pos, p)) : null);
    if (u && u.team === 0) this._portraitClick(u);
  }
  _tileTip(e, p) {
    if (!p || this.drag) { this.tipEl.classList.remove('on'); return; }
    const typ = this.battle.tile(p);
    this.tipEl.textContent = TERRAIN_TIP[typ] || typ;
    this.tipEl.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 12}px)`;
    this.tipEl.classList.add('on');
  }
  _refreshMarks() {
    const marks = new Map();
    if (this.phase === 'deploy') {
      for (const p of hex.ALL) if (p[1] <= 3) marks.set(hex.key(p), 0x4ab0ff);
      if (this.drag && this.drag.over) marks.set(hex.key(this.drag.over), 0xffffff);
    } else if (this.aiming && this.hoverTile) {
      const a = AIM[this.aiming.special];
      const col = a.ally ? 0x7dff8a : 0xffc94a;
      for (const t of aimTiles(this.battle, this.aiming, this.hoverTile)) marks.set(hex.key(t), col);
    } else if (this.targeting) {
      for (const u of this.battle.teamAlive(0)) marks.set(hex.key(u.pos), 0x7fd0ff);
    }
    this.stage.setMarks(marks);
  }
  _start() {
    if (this.phase !== 'deploy') return;
    this.phase = 'fight';
    this.drag = null;
    this.tipEl.classList.remove('on');
    this.hud.querySelector('.deploy-banner').remove();
    this.app.rememberPositions?.(this.battle.units.filter((u) => u.team === 0).map((u) => u.pos));
    this._refreshMarks();
    this._banner('FIGHT!', 'big');
  }

  // ---------------- events -> visuals ----------------
  _events() {
    const fx = this.fx;
    for (const e of this.battle.drainEvents()) {
      const u = e.unit, v = u && this.view(u);
      switch (e.type) {
        case 'move': {
          const dur = e.kind === 'walk' ? (u.moveDur || 1) * 0.9 : e.kind === 'leap' ? 0.35 : 0.15;
          v.moveTo(e.from, e.to, e.kind, dur / this.speed);
          break;
        }
        case 'attack': {
          const tv = this.view(e.target);
          v.attackAnim(tv, e.ranged);
          if (e.ranged) fx.projectile(this.head(u), this.head(e.target), ELEMENT_COLOR[e.element], { size: 0.12, dur: 0.18 / this.speed });
          else fx.spark(this.head(e.target), { color: ELEMENT_COLOR[e.element], count: 5, speed: 1.2, size: 0.12, life: 0.25 });
          break;
        }
        case 'cast':
          v.castAnim(e.special, e.ability);
          fx.text(this.head(u).add(new THREE.Vector3(0, 0.3, 0)), ABILITY_NAMES[e.ability] || e.ability, e.special ? `special team${u.team}` : `cast team${u.team}`);
          if (e.special) {
            fx.spark(this.head(u), { color: ELEMENT_COLOR[u.elements[0]], count: 28, speed: 2.4, size: 0.22, life: 0.6 });
            if (u.team === 0) this.stage.shake = 0.12;
          }
          break;
        case 'projectile': fx.projectile(this.head(u), this.head(e.target), ELEMENT_COLOR[e.element], { size: e.big ? 0.28 : 0.2, dur: 0.3 / this.speed }); break;
        case 'cone': fx.cone(this.view(u).root.position, this._tilePos(e.at), ELEMENT_COLOR[e.element]); break;
        case 'wave':
          e.tiles.forEach((t, i) => setTimeout(() => {
            const pos = this._tilePos(t);
            fx.spark(pos.clone().setY(pos.y + 0.2), { color: 0x3ab8ff, count: 22, speed: 2.2, size: 0.24, life: 0.6, up: 2 });
            fx.ring(pos, 0x7fd8ff, 0.5);
          }, (i * 90) / this.speed));
          break;
        case 'lance': fx.bolt(this.head(u), this._tilePos(e.to).setY(0.4), 0xfff27a, 0.3); fx.bolt(this.head(u), this._tilePos(e.to).setY(0.4), 0xffffff, 0.15); break;
        case 'impact': {
          const pos = this._tilePos(e.pos);
          fx.ring(pos, ELEMENT_COLOR[e.element], e.radius * 0.87);
          fx.spark(pos.clone().setY(pos.y + 0.2), { color: ELEMENT_COLOR[e.element], count: 18 + e.radius * 10, speed: 2 + e.radius, size: 0.2, life: 0.6 });
          break;
        }
        case 'bolt': fx.bolt(this.head(u), this.head(e.target)); break;
        case 'chain': fx.bolt(this.head(e.from), this.head(e.target)); break;
        case 'lightning': fx.lightning(this._tilePos(e.pos)); break;
        case 'damage':
          if (e.amount >= 1) fx.text(this.head(u), String(Math.round(e.amount)), `dmg team${u.team} ${e.element}${e.dot ? ' dot' : ''}${e.cat === 'combo' ? ' combo' : ''}`);
          if (!e.dot) v.hitAnim();
          break;
        case 'heal': fx.text(this.head(u), `+${Math.round(e.amount)}`, 'heal'); fx.spark(this.head(u), { color: ELEMENT_COLOR.heal, count: 8, speed: 0.8, size: 0.14, life: 0.6, gravity: 1 }); break;
        case 'shield': fx.spark(this.head(u), { color: ELEMENT_COLOR.shield, count: 10, speed: 1, size: 0.14, life: 0.5 }); break;
        case 'reaction': this._combo(e); break;
        case 'death': v.deathAnim(); break;
        case 'revive': v.reviveAnim(); break;
        case 'tile': this.stage.setTile(e.pos, this.battle.tile(e.pos)); break;
        case 'invalidAim': this._flashHint('Nothing to hit there: aim again'); break;
        case 'trainer': {
          const d = TRAINER[e.ability];
          this._banner(`${e.team === 0 ? 'You' : 'Opponent'}: ${d.name}!`, `team${e.team}`);
          const targets = u ? [u] : this.battle.teamAlive(e.team);
          for (const t of targets) fx.spark(this.head(t), { color: e.team === 0 ? 0x7fd0ff : 0xff8070, count: 12, speed: 1.3, size: 0.16, life: 0.6, gravity: 1 });
          break;
        }
        case 'mapEvent': this._banner(e.name, 'event'); break;
        case 'end': this._end(e.winner); break;
        default: break;
      }
    }
  }
  _combo(e) {
    const u = e.unit;
    const chain = e.chain > 1 ? ` ×${e.chain}` : '';
    this.fx.text(this.head(u).add(new THREE.Vector3(0, 0.3, 0)), `${e.name.toUpperCase()}!${chain}`, `reaction${e.chain > 1 ? ' chain' : ''}`);
    const c = COMBOS[e.name];
    const col = c ? ELEMENT_COLOR[c.elements[0]] : 0xff7aff;
    this.fx.spark(this.head(u), { color: col, count: 16 + e.chain * 6, speed: 2.2, size: 0.2, life: 0.55 });
    if (c) this.fx.spark(this.head(u), { color: ELEMENT_COLOR[c.elements[1]], count: 12, speed: 1.8, size: 0.18, life: 0.5 });
    if (e.chain >= 3) this.stage.shake = 0.18;
    const mine = u.team === 1;
    const row = document.createElement('div');
    row.className = `feed-row ${mine ? 'mine' : 'theirs'}`;
    row.innerHTML = `<b>${e.name}</b>${chain} <small>${c ? c.desc : ''}</small>`;
    this.feedEl.prepend(row);
    while (this.feedEl.children.length > 5) this.feedEl.lastChild.remove();
    setTimeout(() => row.classList.add('old'), 4000);
  }
  _tilePos(p) { const v = new THREE.Vector3(); v.copy(this.stage.tiles.get(hex.key(p)).base); v.y = this.stage.tileHeight(p); return v; }

  // ---------------- loop ----------------
  _frame(dt) {
    const b = this.battle;
    const scale = this.aiming || this.targeting ? AIM_SLOWMO : 1;
    if (this.phase === 'fight' && !this.paused) {
      this.acc += dt * this.speed * scale;
      let steps = 0;
      while (this.acc >= DT && !b.over && steps < 10) { b.step(); this.acc -= DT; steps++; this._events(); }
      if (steps) { this.stage.syncTiles(b); if (this.aiming || this.targeting) this._refreshMarks(); }
      if (this.aiming && !(this.aiming.active && this.aiming.smeter >= 100)) this._cancel();
    }
    const vdt = this.paused ? 0 : dt * (this.phase === 'fight' ? this.speed * scale : 1);
    for (const v of this.ctx.views.values()) v.update(vdt, b);
    this.fx.update(vdt);
    this._updateHud();
  }
  _updateHud() {
    const b = this.battle;
    const s = Math.floor(b.t);
    this.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.eventEl.textContent = !b.eventDone && this.phase === 'fight' ? `${this.map.eventName.replace('!', '')} in ${Math.ceil(this.map.eventTime - b.t)}s` : '';
    for (const p of this.portraits) {
      const u = p.u;
      p.hp.style.width = `${Math.max(0, u.hpf) * 100}%`;
      p.sp.style.width = `${u.special ? u.smeter : 0}%`;
      p.el.classList.toggle('ready', !!u.special && u.smeter >= 100 && u.active && this.phase === 'fight');
      p.el.classList.toggle('dead', !u.alive);
      p.el.classList.toggle('targeting', !!this.targeting);
      p.el.classList.toggle('aiming', this.aiming === u);
    }
    for (const e of this.enemyBars) { e.hp.style.width = `${Math.max(0, e.u.hpf) * 100}%`; e.el.classList.toggle('dead', !e.u.alive); }
    const en = b.tenergy[0];
    this.trNum.textContent = Math.floor(en);
    this.trSegs.forEach((seg, i) => { seg.style.setProperty('--fill', String(Math.max(0, Math.min(1, en - i)))); });
    for (const t of this.trButtons) {
      const d = TRAINER[t.ab];
      t.b.classList.toggle('ok', en >= d.cost && d.valid(b, 0).length > 0 && this.phase === 'fight');
      t.b.classList.toggle('armed', this.targeting === t.ab);
    }
  }

  // ---------------- end ----------------
  _statsTable(team) {
    const rows = this.battle.units.filter((u) => u.team === team).sort((a, c) => c.dmgDealt - a.dmgDealt);
    const r = (x) => Math.round(x).toLocaleString();
    const max = Math.max(...rows.map((u) => u.dmgDealt), 1);
    return `<table class="stats"><thead><tr><th>Creature</th><th>Attacks</th><th>Abilities</th><th>Specials</th><th>Combos</th><th>Burn</th>
      <th>Total</th><th>Taken</th><th>Healed</th><th>Shields</th><th>Kills</th><th>Combos set off</th></tr></thead><tbody>
      ${rows.map((u) => `<tr class="${u.alive ? '' : 'fallen'}"><td style="--el:${ELEMENTS[u.elements[0]].color}"><b>${u.name}</b></td>
        <td>${r(u.stats.attack)}</td><td>${r(u.stats.ability)}</td><td>${r(u.stats.special)}</td><td>${r(u.stats.combo)}</td><td>${r(u.stats.dot)}</td>
        <td class="tot"><div class="bar" style="width:${(u.dmgDealt / max) * 100}%"></div><span>${r(u.dmgDealt)}</span></td>
        <td>${r(u.stats.taken)}</td><td>${r(u.stats.healDone)}</td><td>${r(u.stats.shieldDone)}</td><td>${u.kills}</td><td>${u.stats.combos}</td></tr>`).join('')}
      </tbody></table>`;
  }
  _end(winner) {
    this.phase = 'end';
    this._cancel();
    for (const u of this.battle.units) if (u.team === winner && u.alive) this.view(u).victory();
    const won = winner === 0;
    const card = document.createElement('div');
    card.className = `endcard ${won ? 'win' : 'lose'}`;
    const combos = Object.entries(this.battle.reactions).sort((a, c) => c[1] - a[1]).map(([n, k]) => `${n} ×${k}`).join(' · ') || 'none';
    card.innerHTML = `<h1>${won ? 'Victory!' : 'Defeat'}</h1>
      <p>${this.battle.timeout ? 'Time ran out: the team with more health left wins.' : won ? 'The opposing team has fallen.' : 'Your team was defeated.'}
        Fight time ${this.clock.textContent}. Combos: ${combos}</p>
      <div class="tabs"><button class="tab on" data-t="0">Your team</button><button class="tab" data-t="1">Opponent</button></div>
      <div class="table-wrap">${this._statsTable(0)}</div>
      <button class="primary cont">Continue</button>`;
    card.querySelectorAll('.tab').forEach((tb) => tb.addEventListener('click', () => {
      card.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === tb));
      card.querySelector('.table-wrap').innerHTML = this._statsTable(+tb.dataset.t);
    }));
    card.querySelector('.cont').addEventListener('click', () => this.onEnd({ won, battle: this.battle }));
    setTimeout(() => this.hud.appendChild(card), 900);
  }

  dispose() {
    window.removeEventListener('keydown', this._handlers.keydown);
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'contextmenu']) this.stage.canvas.removeEventListener(ev, this._handlers[ev]);
    this.stage.onFrame = null;
    this.stage.setMarks(new Map());
    for (const v of this.ctx.views.values()) v.dispose();
    this.fx.clear();
    this.hud.remove();
  }
}
