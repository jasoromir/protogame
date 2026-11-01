// A live battle (Combat 3.0): runs the engine in real time, turns its events into animation and VFX,
// and drives the HUD: a Clash-Royale-style card hand with shared energy, League-style aiming
// indicators, pre-positioned casts, TFT-style traits and rosters, tooltips everywhere.
import * as THREE from 'three';
import { Battle, DT, ENERGY_CAP, OVERTIME_AT, COMBOS } from '../sim/engine.js';
import { CARDS, cardTiles } from '../sim/cards.js';
import { AutoSpecials } from '../sim/policies.js';
import { INPUT_DELAY } from '../net/lockstep.js';
import { DUOS, BOONS } from '../sim/synergies.js';
import * as hex from '../sim/hex.js';
import * as G from '../sim/geom.js';
import { UnitView, STATUS_ICONS } from '../render/units.js';
import { FX, ELEMENT_COLOR } from '../render/fx.js';
import { Telegraph, areaRadius } from '../render/telegraph.js';
import { HEX_W } from '../render/stage.js';
import { ABILITY_NAMES, ABILITY_DESC, ELEMENTS } from '../data/creatures.js';
import { cardIcon, elementIcon, emblem, SHAPE_LABEL } from '../ui/icons.js';

const TERRAIN_TIP = {
  plain: 'Grass', high: 'High ground: +1 range, −15% damage taken from below', river: 'River: Soaks whoever stands in it; Water creatures +15% damage',
  brush: 'Brush: hidden from ranged attacks until you attack', lava: 'Lava: Burns whoever stands in it', icewall: 'Ice wall: blocks movement',
  charged: 'Charged: Shocks whoever stands in it', frozen: 'Frozen river: walkable', steam: 'Steam: creatures inside deal −40% damage', mud: 'Mud: slows movement',
};
const STATUS_TIP = { soak: 'Soaked', chill: 'Chilled', freeze: 'Frozen', shock: 'Shocked', burn: 'Burning', crack: 'Cracked (−armor)',
  stun: 'Stunned', root: 'Rooted', brittle: 'Brittle (−50% armor)', steamed: 'In steam (−40% damage)', storm: 'Storm aura' };
const KEYS = ['1', '2', '3', '4'];

export class BattleScene {
  constructor(app, { playerDefs, enemyDefs, map, trainerCards = [], enemyTrainer = [], enemyPolicy, title, subtitle = '',
    boonsA = [], boonsB = [], posA = null, wild = false, pvp = null, onEnd }) {
    this.app = app;
    this.stage = app.stage;
    this.onEnd = onEnd;
    this.title = title;
    this.subtitle = subtitle;
    this.map = map;
    this.boonsA = boonsA;
    this.overlay = app.overlay;
    // versus: pvp = {me, lockstep, link, seed, teamA, teamB, trainerA, trainerB, foeName}
    this.pvp = pvp;
    this.me = pvp ? pvp.me : 0;
    this.foe = 1 - this.me;
    this.net = pvp ? pvp.lockstep : null;
    this.stage.setMap(map);
    this.stage.setBattleCamera(this.me === 1);
    this.fx = new FX(this.stage, this.overlay);
    this.speed = pvp ? 1 : app.save.settings.speed || 1;
    this.battle = pvp
      ? new Battle({ teamA: pvp.teamA, teamB: pvp.teamB, map, policyA: null, policyB: null, hpScale: 5, seed: pvp.seed,
          posA: this.me === 0 ? posA : null, trainerA: pvp.trainerA, trainerB: pvp.trainerB })
      : new Battle({ teamA: playerDefs, teamB: enemyDefs, map, policyA: null, policyB: enemyPolicy, hpScale: 5,
          seed: (Math.random() * 1e9) | 0, posA, boonsA, boonsB, wild,
          trainerA: [...trainerCards, ...(wild ? ['capture'] : [])], trainerB: enemyTrainer });
    if (!pvp && app.save.settings.autoSpecials) this.battle.policies[0] = new AutoSpecials();
    this.ctx = { stage: this.stage, fx: this.fx, assets: app.assets, overlay: this.overlay, views: new Map(), me: this.me };
    for (const u of this.battle.units) this.ctx.views.set(u.uid, new UnitView(this.ctx, u));
    this.phase = 'deploy';
    this.acc = 0;
    this.paused = false;
    this.sel = null;        // card being aimed: {entry, dragging, mode}
    this.armed = null;      // card placed on the board waiting for energy: {entry, aim}
    this.aimTele = new Telegraph(this.stage.scene);
    this.castTeles = [];    // telegraphs of casts in progress (both teams)
    this.hover = null;
    this._buildHud();
    this._handlers = {
      keydown: (e) => this._key(e), move: (e) => this._move(e), up: (e) => this._up(e),
      down: (e) => this._down(e), ctx: (e) => { e.preventDefault(); this._cancel(); },
    };
    window.addEventListener('keydown', this._handlers.keydown);
    window.addEventListener('pointermove', this._handlers.move);
    window.addEventListener('pointerup', this._handlers.up);
    this.stage.canvas.addEventListener('pointerdown', this._handlers.down);
    this.stage.canvas.addEventListener('contextmenu', this._handlers.ctx);
    this.stage.onFrame = (dt) => this._frame(dt);
    this._refreshMarks();
    if (pvp) {
      this.foeReady = null;
      this._offMsg = pvp.link.onMessage((m) => { if (m.type === 'ready') this._foeReady(m); });
      this._offClose = pvp.link.onClose(() => this._disconnected());
    }
  }
  /** A deploy zone row for the viewer's team. */
  _mine(p) { return this.me === 0 ? p[1] <= 3 : p[1] >= 4; }
  /** Send a card (or auto toggle) to the battle: directly, or through lockstep in a versus match. */
  _play(action) {
    if (this.net) return this.net.schedule(action);
    this.battle.request(this.me, action);
    return null;
  }
  view(u) { return this.ctx.views.get(u.uid); }
  head(u) { const v = this.view(u); return v.root.position.clone().add(new THREE.Vector3(0, v.height * 0.6, 0)); }
  portrait(u) { return this.app.portraits ? this.app.portraits.portrait(u.name, u.line) : ''; }

  // ================= HUD =================
  _buildHud() {
    const b = this.battle;
    const el = document.createElement('div');
    el.className = 'hud v3';
    el.innerHTML = `
      <div class="plate"><div class="pl-phase">Deploy</div><div class="pl-clock">0:00</div>
        <div class="pl-sub">${this.title} · ${this.map.name}${this.subtitle ? ` · ${this.subtitle}` : ''}</div><div class="pl-event"></div></div>
      <div class="traits"></div>
      <div class="rosters"><h5>Opponent</h5><div class="roster enemy"></div><h5>Your team</h5><div class="roster mine"></div></div>
      <div class="deploy-banner"><b>Deploy</b><span><b>Drag</b> your creatures onto the blue tiles (drop on another creature to swap).
        Hover tiles and creatures to learn what they do.</span><button class="fight">${this.pvp ? "Ready!" : "Fight!"} <small>Space</small></button></div>
      <div class="feed"></div>
      <div class="cardbar">
        <div class="next" data-tip="The card that enters your hand next. Cards rotate: a played card goes to the back of the line.">
          <span>Next</span><div class="next-card"></div></div>
        <div class="hand"></div>
        <div class="energy" data-tip="Shared energy: every card costs energy from this bar. It refills over time (and a little on every kill), up to ${ENERGY_CAP}.">
          <div class="gem"><b>0</b></div><div class="ebar">${'<i><u></u></i>'.repeat(ENERGY_CAP)}</div></div>
      </div>
      <div class="controls">
        ${this.pvp ? '' : `<button data-speed="1" data-tip="Normal speed">1×</button><button data-speed="2" data-tip="Double speed">2×</button>
        <button class="pause" data-tip="Pause (Space)">❚❚</button>`}
        <button class="auto" data-tip="Auto-cast: an AI plays your cards for you, aiming them smartly. Good for learning; turn it off to play yourself.">Auto</button>
      </div>
      <div class="tooltip"></div><div class="hint"></div><div class="banner"></div>`;
    this.overlay.appendChild(el);
    this.hud = el;
    const q = (s) => el.querySelector(s);
    this.dom = { phase: q('.pl-phase'), clock: q('.pl-clock'), event: q('.pl-event'), hand: q('.hand'), next: q('.next-card'),
      gem: q('.gem b'), segs: [...el.querySelectorAll('.ebar i')], tip: q('.tooltip'), hint: q('.hint'), banner: q('.banner'), feed: q('.feed') };
    el.querySelectorAll('[data-speed]').forEach((btn) => btn.addEventListener('click', () => this._setSpeed(+btn.dataset.speed)));
    q('.pause')?.addEventListener('click', () => this._togglePause());
    const auto = q('.auto');
    auto.classList.toggle('on', !!this.app.save.settings.autoSpecials);
    auto.addEventListener('click', () => {
      const on = !this.app.save.settings.autoSpecials;
      this.app.save.settings.autoSpecials = on; this.app.persist();
      if (this.net) { if (this.phase === 'fight') this._play({ kind: 'auto', on }); }
      else b.policies[0] = on ? new AutoSpecials() : null;
      auto.classList.toggle('on', on);
    });
    q('.fight').addEventListener('click', () => this._start());
    this._setSpeed(this.speed);
    this._buildTraits();
    this._buildRosters();
    this.handKey = '';
    // generic tooltips for anything with data-tip
    el.addEventListener('pointerover', (e) => {
      const t = e.target.closest('[data-tip]');
      if (t) this._showTip(t.dataset.tip, e);
    });
    el.addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]')) this._hideTip(); });
  }

  _buildTraits() {
    const b = this.battle, rows = [];
    for (const [e, n] of Object.entries(b.elemCount[this.me])) {
      const tier = n >= 3 ? 2 : n >= 2 ? 1 : 0;
      const tip = `${ELEMENTS[e].name} ${n}: (2) its statuses last 50% longer · (3) its combos deal +25%`;
      rows.push(`<div class="trait t${tier}" data-tip="${tip}">${elementIcon(e, { size: 34, dim: tier === 0 })}<div><b>${ELEMENTS[e].name}</b><span>${n} / ${n >= 2 ? 3 : 2}</span></div></div>`);
    }
    for (const d of DUOS) if (b.hasDuo(this.me, d.id)) {
      rows.push(`<div class="trait t2 duo" data-tip="Duo · ${d.pair.join(' + ')}: ${d.desc}">${emblem('duo', 'duo', { size: 34, shape: 'hex' })}<div><b>${d.name}</b><span>Duo</span></div></div>`);
    }
    for (const id of this.boonsA) {
      const bn = BOONS.find((x) => x.id === id);
      if (bn) rows.push(`<div class="trait t1 boon" data-tip="Boon: ${bn.desc}">${emblem('banner', bn.element || 'trainer', { size: 34, shape: 'hex' })}<div><b>${bn.name}</b><span>Boon</span></div></div>`);
    }
    this.hud.querySelector('.traits').innerHTML = rows.join('');
  }

  _buildRosters() {
    this.rosterRows = [];
    for (const [team, sel] of [[this.foe, '.roster.enemy'], [this.me, '.roster.mine']]) {
      const box = this.hud.querySelector(sel);
      for (const u of this.battle.units.filter((x) => x.team === team)) {
        const d = document.createElement('div');
        d.className = `rrow team${team === this.me ? 0 : 1}`;
        d.style.setProperty('--el', ELEMENTS[u.elements[0]].color);
        d.innerHTML = `<img src="${this.portrait(u)}" alt=""><div class="rinfo"><b>${u.name}</b><small>Lv ${u.def.level} · ${u.role}</small>
          <div class="rhp"><i></i></div></div>`;
        d.addEventListener('pointerenter', (e) => { this._hoverUnit(u, true); this._showTip(this._unitTip(u), e); });
        d.addEventListener('pointerleave', () => { this._hoverUnit(u, false); this._hideTip(); });
        box.appendChild(d);
        this.rosterRows.push({ u, el: d, hp: d.querySelector('.rhp i') });
      }
    }
  }

  _cardHtml(entry, small = false) {
    const c = CARDS[entry.card];
    const u = this.battle.caster(entry);
    const who = u ? `<img class="who" src="${this.portrait(u)}" alt="">` : '<div class="who trainer">T</div>';
    return `<div class="card ${small ? 'small' : ''} ${c.kind}" data-key="${entry.key}" style="--el:${c.element === 'trainer' ? '#b48cff' : ELEMENTS[c.element].color}">
      <div class="art">${cardIcon(entry.card, { size: small ? 34 : 56 })}</div>${who}
      <div class="cost">${c.cost}</div>${small ? '' : `<div class="cname">${c.name}</div><div class="cfill"></div><div class="ckey"></div>`}</div>`;
  }
  _cardTip(entry) {
    const c = CARDS[entry.card], u = this.battle.caster(entry);
    const kind = c.kind === 'ult' ? 'Ultimate' : c.kind === 'skill' ? 'Skill' : 'Trainer card';
    return `<b>${c.name}</b> <small>${kind} · ${u ? u.name : 'Trainer'} · ${SHAPE_LABEL[c.shape]}${c.origin === 'caster' && ['circle', 'leap', 'single'].includes(c.shape) ? ` · range ${c.range}` : ''}</small>
      <p>${c.desc}</p><small>Cost ${c.cost} energy · cast time ${c.castTime}s${c.once ? ' · once per fight' : ''}</small>`;
  }
  _unitTip(u) {
    const sts = STATUS_ICONS.filter(([st]) => this.battle.has(u, st)).map(([st, i]) => `${i} ${STATUS_TIP[st] || st}`).join(' · ');
    const cards = u.cards.map((id) => CARDS[id].name).join(', ');
    return `<b>${u.name}</b> <small>Lv ${u.def.level} · ${ELEMENTS[u.elements[0]].name} · ${u.role} · ${u.team === this.me ? 'yours' : 'opponent'}</small>
      <p>HP ${Math.max(0, Math.round(u.hp))} / ${Math.round(u.maxHp)}${u.shield > 1 && u.shieldUntil > this.battle.t ? ` (+${Math.round(u.shield)} shield)` : ''}</p>
      <small>Auto: ${ABILITY_NAMES[u.abilities[0]] || '-'}${u.passive ? ` · Passive: ${ABILITY_NAMES[u.passive]}` : ''}${cards ? ` · Cards: ${cards}` : ''}</small>
      ${sts ? `<p>${sts}</p>` : ''}`;
  }
  _showTip(html, e) {
    const t = this.dom.tip;
    t.innerHTML = html;
    t.classList.add('on');
    this._placeTip(e);
  }
  _placeTip(e) {
    const t = this.dom.tip;
    const x = Math.min(window.innerWidth - t.offsetWidth - 10, e.clientX + 16);
    const y = Math.max(10, Math.min(window.innerHeight - t.offsetHeight - 10, e.clientY - t.offsetHeight - 14));
    t.style.transform = `translate(${x}px, ${y}px)`;
  }
  _hideTip() { this.dom.tip.classList.remove('on'); }
  _hoverUnit(u, on) { const v = this.view(u); if (v) v.hovered = on; this.hover = on ? u : null; }

  _renderHand() {
    const b = this.battle, hand = b.hands[this.me];
    const key = hand.map((e) => e.key).join('|') + '#' + (b.nextCard(this.me)?.key || '');
    if (key === this.handKey) return;
    this.handKey = key;
    this.dom.hand.innerHTML = hand.map((e) => this._cardHtml(e)).join('');
    const nx = b.nextCard(this.me);
    this.dom.next.innerHTML = nx ? this._cardHtml(nx, true) : '';
    this.dom.hand.querySelectorAll('.card').forEach((cardEl, i) => {
      const entry = hand[i];
      cardEl.querySelector('.ckey').textContent = KEYS[i];
      cardEl.addEventListener('pointerdown', (e) => this._cardDown(entry, e));
      cardEl.addEventListener('pointerenter', (e) => { this._showTip(this._cardTip(entry), e); const u = b.caster(entry); if (u) this._hoverUnit(u, true); });
      cardEl.addEventListener('pointerleave', () => { this._hideTip(); const u = b.caster(entry); if (u) this._hoverUnit(u, false); });
    });
  }

  _setSpeed(s) {
    this.speed = s;
    this.app.save.settings.speed = s;
    this.hud.querySelectorAll('[data-speed]').forEach((btn) => btn.classList.toggle('on', +btn.dataset.speed === s));
  }
  _togglePause() { this.paused = !this.paused; this.hud.querySelector('.pause').textContent = this.paused ? '▶' : '❚❚'; this._hint(this.paused ? 'Paused (Space to resume)' : ''); }
  _hint(t) { this.dom.hint.textContent = t; this.dom.hint.classList.toggle('on', !!t); }
  _flashHint(t) { this._hint(t); clearTimeout(this._ht); this._ht = setTimeout(() => this._hint(this.sel ? this._selText() : ''), 1300); }
  _banner(t, cls = '') {
    this.dom.banner.textContent = t;
    this.dom.banner.className = `banner on ${cls}`;
    clearTimeout(this._bt);
    this._bt = setTimeout(() => this.dom.banner.classList.remove('on'), 1400);
  }

  // ================= aiming =================
  _cardDown(entry, e) {
    e.preventDefault();
    if (this.phase === 'end') return;
    this.sel = { entry, dragging: false, x0: e.clientX, y0: e.clientY, mode: 'drag' };
    this._hint(this._selText());
  }
  _selText() {
    const c = CARDS[this.sel.entry.card];
    const how = c.shape === 'single' ? (c.target === 'ally' ? 'on one of your creatures' : 'on an enemy') : 'on the board';
    return `${c.name}: drag ${how} and release · red = not enough energy yet (it fires by itself when ready) · right-click or Esc cancels`;
  }
  _cancel() {
    this.sel = null;
    this.armed = null;
    this.aimTele.hide();
    this._hint('');
    this._refreshMarks();
  }
  /** Aim for the current card from the mouse position (null = nothing under the mouse). */
  _aimFrom(e) {
    const c = CARDS[this.sel.entry.card];
    if (c.shape === 'none' || c.shape === 'self') return {};
    const pt = this.stage.pickPoint(e.clientX, e.clientY);
    if (!pt) return null;
    if (c.shape === 'cone' || c.shape === 'line') return { point: [pt.x, pt.z] };
    const tile = G.tileAt([pt.x, pt.z]);
    if (c.shape === 'single') {
      const team = c.target === 'ally' ? this.me : this.foe;
      const cands = this.battle.teamAlive(team);
      let best = null, bd = 0.8;
      for (const u of cands) { const v = this.view(u).root.position; const d = Math.hypot(v.x - pt.x, v.z - pt.z); if (d < bd) { bd = d; best = u; } }
      return best ? { uid: best.uid } : null;
    }
    return tile ? { tile } : null;
  }
  _teleSpec(entry, aim) {
    const c = CARDS[entry.card], u = this.battle.caster(entry);
    const from = u ? this.view(u).root.position.clone() : null;
    const tilePos = (p) => { const v = new THREE.Vector3(...[G.tileXZ(p)[0], 0, G.tileXZ(p)[1]]); return v; };
    switch (c.shape) {
      case 'circle': case 'leap': return aim.tile && { shape: c.shape, from, at: tilePos(aim.tile), radius: areaRadius(c.radius), y: this.stage.tileHeight(aim.tile) };
      case 'wall': return aim.tile && { shape: 'circle', from, at: tilePos(aim.tile), radius: HEX_W * 1.4 };
      case 'self': return from && { shape: 'self', at: from, radius: areaRadius(c.radius) };
      case 'cone': return from && aim.point && { shape: 'cone', from, at: new THREE.Vector3(aim.point[0], 0, aim.point[1]), range: c.range * HEX_W + 0.35, angle: c.angle };
      case 'line': return from && aim.point && { shape: 'line', from, at: new THREE.Vector3(aim.point[0], 0, aim.point[1]), length: c.length * HEX_W, width: 0.7 };
      case 'single': {
        const t = aim.uid && this.battle.units.find((x) => x.uid === aim.uid);
        return t && { shape: 'single', from: c.origin === 'caster' ? from : null, at: this.view(t).root.position.clone() };
      }
      default: return null;
    }
  }
  _updateAim(e) {
    if (!this.sel) return;
    const aim = this._aimFrom(e);
    this.sel.aim = aim;
    const b = this.battle, c = CARDS[this.sel.entry.card];
    const problem = aim ? b.cardProblem(this.me, this.sel.entry, aim) : 'Aim on the board';
    const spec = aim && this._teleSpec(this.sel.entry, aim);
    if (spec) this.aimTele.show(spec, problem ? 'invalid' : b.energy[this.me] >= c.cost ? 'ready' : 'charging');
    else this.aimTele.hide();
    this.sel.problem = problem;
    this._refreshMarks();
  }
  _commit(entry, aim) {
    const b = this.battle, c = CARDS[entry.card];
    const problem = b.cardProblem(this.me, entry, aim);
    if (problem) { this._flashHint(problem); return false; }
    this.sel = null;
    if (b.energy[this.me] >= c.cost) {
      const at = this._play({ kind: 'card', key: entry.key, aim });
      // versus: keep the telegraph up until the cast actually starts (a few ticks of network delay)
      if (at !== null) this.armed = { entry, aim, sentAt: this.net.tick };
      else { this.aimTele.hide(); this._hint(''); }
    }
    else { this.armed = { entry, aim }; this._hint(`${c.name} placed: it fires as soon as you have ${c.cost} energy (right-click to cancel)`); }
    this._refreshMarks();
    return true;
  }

  // ================= input =================
  _key(e) {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); if (this.phase === 'fight' && !this.pvp) this._togglePause(); else if (this.phase === 'deploy') this._start(); return; }
    if (k === 'escape') { this._cancel(); return; }
    const i = KEYS.indexOf(k);
    const entry = this.battle.hands[this.me][i];
    if (i >= 0 && entry && this.phase === 'fight') {
      const c = CARDS[entry.card];
      if (c.shape === 'none' || c.shape === 'self') this._commit(entry, {});
      else { this.sel = { entry, dragging: true, mode: 'aim' }; this._hint(this._selText()); if (this.lastMouse) this._updateAim(this.lastMouse); }
    }
  }
  _down(e) {
    if (e.button !== 0) return;
    if (this.sel && this.sel.mode === 'aim') {   // click-to-aim mode: this click fires
      this._updateAim(e);
      if (this.sel.aim) this._commit(this.sel.entry, this.sel.aim);
      return;
    }
    const p = this.stage.pickTile(e.clientX, e.clientY);
    if (!p || this.phase !== 'deploy' || this.waiting) return;
    const u = this.battle.occ.get(hex.key(p));
    if (u && u.team === this.me) {
      this.drag = { unit: u, from: p, over: p };
      this.view(u).body.scale.setScalar(1.15);
    }
  }
  _move(e) {
    this.lastMouse = e;
    if (this.sel) {
      if (!this.sel.dragging && Math.hypot(e.clientX - this.sel.x0, e.clientY - this.sel.y0) > 8) this.sel.dragging = true;
      if (this.sel.dragging) this._updateAim(e);
      this._hideTip();
      return;
    }
    const overCanvas = e.target === this.stage.canvas;
    const p = overCanvas ? this.stage.pickTile(e.clientX, e.clientY) : null;
    if (this.phase === 'deploy' && this.drag && p && this._mine(p)) {
      this.drag.over = p;
      this.view(this.drag.unit).root.position.copy(this.stage.tiles.get(hex.key(p)).base).setY(this.stage.tileHeight(p) + 0.25);
      this._refreshMarks();
      return;
    }
    if (!overCanvas) return;
    const u = p && (this.battle.occ.get(hex.key(p)));
    if (this.hover && this.hover !== u) this._hoverUnit(this.hover, false);
    if (u) { this._hoverUnit(u, true); this._showTip(this._unitTip(u), e); }
    else if (p && this.phase === 'deploy') this._showTip(TERRAIN_TIP[this.battle.tile(p)] || 'Grass', e);
    else if (p && this.battle.tile(p) !== 'plain') this._showTip(TERRAIN_TIP[this.battle.tile(p)], e);
    else this._hideTip();
  }
  _up(e) {
    if (e.button !== 0) return;
    if (this.sel && this.sel.mode === 'drag') {
      const c = CARDS[this.sel.entry.card];
      if (!this.sel.dragging) {   // a click on the card
        if (c.shape === 'none' || c.shape === 'self') { this._commit(this.sel.entry, {}); return; }
        this.sel.mode = 'aim'; this.sel.dragging = true; this._hint(this._selText());
        return;
      }
      if (e.target === this.stage.canvas && this.sel.aim) this._commit(this.sel.entry, this.sel.aim);
      else this._cancel();
      return;
    }
    if (this.drag) {
      const { unit, from, over } = this.drag;
      this.drag = null;
      this.view(unit).body.scale.setScalar(1);
      const b = this.battle;
      if (over && this._mine(over) && !hex.same(over, from) && b.tile(over) !== 'icewall') {
        const other = b.occ.get(hex.key(over));
        b.occ.delete(hex.key(from));
        if (other) { other.pos = from; other.startPos = from; b.occ.set(hex.key(from), other); this.view(other).place(from); }
        unit.pos = over; unit.startPos = over;
        b.occ.set(hex.key(over), unit);
      }
      this.view(unit).place(unit.pos);
      this._refreshMarks();
    }
  }
  _refreshMarks() {
    const marks = new Map();
    const b = this.battle;
    if (this.phase === 'deploy') {
      if (!this.waiting) for (const p of hex.ALL) if (this._mine(p)) marks.set(hex.key(p), 0x4ab0ff);
      if (this.drag && this.drag.over) marks.set(hex.key(this.drag.over), 0xffffff);
    } else {
      const showing = this.sel && this.sel.aim ? this.sel : this.armed;
      if (showing && showing.aim) {
        const col = this.sel && this.sel.problem ? 0x9a9aa8 : b.energy[this.me] >= CARDS[showing.entry.card].cost ? 0x46d6ff : 0xff4646;
        for (const t of cardTiles(b, b.caster(showing.entry), showing.entry.card, showing.aim, this.me)) marks.set(hex.key(t), col);
      }
    }
    this.stage.setMarks(marks);
  }
  _start() {
    if (this.phase !== 'deploy' || this.waiting) return;
    if (this.pvp) {   // versus: tell the friend where we stand, fight once both are ready
      this.drag = null;
      this.waiting = true;
      const pos = this.battle.units.filter((u) => u.team === this.me).map((u) => u.pos);
      this.myReady = { pos, auto: !!this.app.save.settings.autoSpecials };
      this.pvp.link.send({ type: 'ready', ...this.myReady });
      const btn = this.hud.querySelector('.fight');
      btn.disabled = true; btn.innerHTML = `Waiting for ${this.pvp.foeName}…`;
      this._refreshMarks();
      this._tryBegin();
      return;
    }
    this._begin();
  }
  _foeReady(m) {
    // positions must be on the friend's own half, one per creature, all different
    const n = this.battle.units.filter((u) => u.team === this.foe).length;
    const half = (p) => (this.foe === 0 ? p[1] <= 3 : p[1] >= 4);
    const pos = Array.isArray(m.pos) && m.pos.length === n && m.pos.every((p) => Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1])
      && p[0] >= 0 && p[0] <= 6 && half(p) && this.battle.tile(p) !== 'icewall') ? m.pos.map((p) => [p[0], p[1]]) : null;
    if (!pos || new Set(pos.map(hex.key)).size !== n || this.foeReady) return;
    this.foeReady = { pos, auto: m.auto === true };
    this._tryBegin();
  }
  _tryBegin() {
    if (!this.myReady || !this.foeReady) {
      if (this.foeReady) this._flashHint(`${this.pvp.foeName} is ready!`);
      return;
    }
    const b = this.battle, ready = { [this.me]: this.myReady, [this.foe]: this.foeReady };
    for (const team of [0, 1]) {
      b.placeTeam(team, ready[team].pos);
      if (ready[team].auto) b.policies[team] = new AutoSpecials();
    }
    for (const u of b.units) this.view(u).place(u.pos);
    this.waiting = false;
    this._begin();
  }
  _begin() {
    this.phase = 'fight';
    this.drag = null;
    this._hideTip();
    this.hud.querySelector('.deploy-banner').remove();
    if (!this.pvp) this.app.rememberPositions?.(this.battle.units.filter((u) => u.team === 0).map((u) => u.pos));
    this._refreshMarks();
    this.hud.classList.add('fighting');
    this._banner('FIGHT!', 'big');
  }

  // ================= events -> visuals =================
  _events() {
    const fx = this.fx;
    for (const e of this.battle.drainEvents()) {
      const u = e.unit, v = u && this.view(u);
      switch (e.type) {
        case 'move': {
          const dur = e.kind === 'walk' ? (u.moveDur || 1) * 0.9 : e.kind === 'leap' ? 0.4 : 0.15;
          v.moveTo(e.from, e.to, e.kind, dur / this.speed);
          break;
        }
        case 'attack': {
          v.attackAnim(this.view(e.target), e.ranged);
          if (e.ranged) fx.projectile(this.head(u), this.head(e.target), ELEMENT_COLOR[e.element], { size: 0.12, dur: 0.18 / this.speed });
          else fx.spark(this.head(e.target), { color: ELEMENT_COLOR[e.element], count: 5, speed: 1.2, size: 0.12, life: 0.25 });
          break;
        }
        case 'castStart': {
          const tele = new Telegraph(this.stage.scene);
          const entry = { card: e.card, uid: u ? u.uid : null };
          const spec = this._teleSpec(entry, e.aim);
          if (spec) this.castTeles.push({ tele, spec, key: e.key, t0: this.battle.t, dur: e.dur, team: e.team });
          else tele.dispose();
          if (u) { v.castAnim(CARDS[e.card].kind === 'ult', true); fx.spark(this.head(u), { color: ELEMENT_COLOR[CARDS[e.card].element] || 0xc6a0ff, count: 10, speed: 1, size: 0.14, life: 0.4, gravity: 1 }); }
          const name = CARDS[e.card].name;
          const side = e.team === this.me ? 0 : 1;
          if (u) fx.text(this.head(u).add(new THREE.Vector3(0, 0.35, 0)), name, `${CARDS[e.card].kind === 'ult' ? 'special' : 'cast'} team${side}`);
          else this._banner(`${side === 0 ? 'You' : this.pvp ? this.pvp.foeName : 'Opponent'}: ${name}`, `team${side}`);
          if (this.armed && this.armed.entry.key === e.key) { this.armed = null; this.aimTele.hide(); this._hint(''); this._refreshMarks(); }
          break;
        }
        case 'castEnd': case 'interrupted': {
          const i = this.castTeles.findIndex((c) => c.key === (e.key || `${e.unit?.uid}:${e.card}`));
          if (i >= 0) { this.castTeles[i].tele.dispose(); this.castTeles.splice(i, 1); }
          if (e.type === 'interrupted' && u) { fx.text(this.head(u).add(new THREE.Vector3(0, 0.3, 0)), 'INTERRUPTED!', 'reaction'); }
          break;
        }
        case 'cast':
          if (u && e.card && CARDS[e.ability].kind === 'ult' && u.team === this.me) this.stage.shake = 0.12;
          if (u && !e.card) v.castAnim(false, false);
          break;
        case 'projectile': fx.projectile(this.head(u), this.head(e.target), ELEMENT_COLOR[e.element], { size: e.big ? 0.28 : 0.2, dur: 0.3 / this.speed }); break;
        case 'cone': fx.cone(this.view(u).root.position, new THREE.Vector3(e.point[0], 0, e.point[1]), ELEMENT_COLOR[e.element]); break;
        case 'wave':
          e.tiles.forEach((t, i) => setTimeout(() => {
            const pos = this._tilePos(t);
            fx.spark(pos.clone().setY(pos.y + 0.2), { color: 0x3ab8ff, count: 22, speed: 2.2, size: 0.24, life: 0.6, up: 2 });
            fx.ring(pos, 0x7fd8ff, 0.5);
          }, (i * 60) / this.speed));
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
          if (e.amount >= 1) fx.text(this.head(u), String(Math.round(e.amount)), `dmg team${u.team === this.me ? 0 : 1} ${e.element}${e.dot ? ' dot' : ''}${e.cat === 'combo' ? ' combo' : ''}`);
          if (!e.dot) v.hitAnim();
          break;
        case 'heal': fx.text(this.head(u), `+${Math.round(e.amount)}`, 'heal'); fx.spark(this.head(u), { color: ELEMENT_COLOR.heal, count: 8, speed: 0.8, size: 0.14, life: 0.6, gravity: 1 }); break;
        case 'shield': fx.spark(this.head(u), { color: ELEMENT_COLOR.shield, count: 10, speed: 1, size: 0.14, life: 0.5 }); break;
        case 'reaction': this._combo(e); break;
        case 'execute': fx.text(this.head(u).add(new THREE.Vector3(0, 0.3, 0)), 'EXECUTED!', 'reaction'); break;
        case 'captured':
          v.deathAnim();
          fx.spark(this.head(u), { color: 0xc6a0ff, count: 40, speed: 2.5, size: 0.24, life: 0.9 });
          fx.text(this.head(u).add(new THREE.Vector3(0, 0.3, 0)), `${u.name.toUpperCase()} CAPTURED!`, 'reaction chain');
          break;
        case 'captureFail': fx.text(this.head(u), 'Too strong! Weaken it below 30%', 'reaction'); break;
        case 'death': v.deathAnim(); break;
        case 'revive': v.reviveAnim(); break;
        case 'tile': this.stage.setTile(e.pos, this.battle.tile(e.pos)); break;
        case 'overtime': this._banner('OVERTIME! Damage rising', 'event'); this.dom.phase.textContent = 'Overtime'; this.dom.phase.classList.add('ot'); break;
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
    this.fx.spark(this.head(u), { color: c ? ELEMENT_COLOR[c.elements[0]] : 0xff7aff, count: 16 + e.chain * 6, speed: 2.2, size: 0.2, life: 0.55 });
    if (c) this.fx.spark(this.head(u), { color: ELEMENT_COLOR[c.elements[1]], count: 12, speed: 1.8, size: 0.18, life: 0.5 });
    if (e.chain >= 3) this.stage.shake = 0.18;
    const row = document.createElement('div');
    row.className = `feed-row ${u.team === this.foe ? 'mine' : 'theirs'}`;
    row.innerHTML = `<b>${e.name}</b>${chain} <small>${c ? c.desc : ''}</small>`;
    this.dom.feed.prepend(row);
    while (this.dom.feed.children.length > 4) this.dom.feed.lastChild.remove();
    setTimeout(() => row.classList.add('old'), 3500);
  }
  _tilePos(p) { const v = new THREE.Vector3(); v.copy(this.stage.tiles.get(hex.key(p)).base); v.y = this.stage.tileHeight(p); return v; }

  // ================= loop =================
  _frame(dt) {
    const b = this.battle;
    if (this.phase === 'fight' && !this.paused) {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= DT && !b.over && steps < 10) {
        if (this.net) { if (!this.net.canStep()) break; this.net.step(b); } else b.step();
        this.acc -= DT; steps++; this._events();
      }
      if (this.net) {
        this.acc = Math.min(this.acc, 1);   // after a stall, catch up at most a second
        const stalled = !b.over && performance.now() - this.net.lastStep > 1200;
        if (stalled !== this.stalled) { this.stalled = stalled; this._hint(stalled ? `Waiting for ${this.pvp.foeName}… (connection is slow)` : ''); }
        if (this.net.desync !== null && !this.desyncShown) { this.desyncShown = true; this._banner('Out of sync with your friend', 'event'); }
      }
      if (steps) this.stage.syncTiles(b);
      // a pre-positioned card fires as soon as there is enough energy
      const me = this.me, a = this.armed;
      const inFlight = a && a.sentAt != null && this.net && this.net.tick - a.sentAt < INPUT_DELAY + 6;
      if (a && !inFlight && b.energy[me] >= CARDS[a.entry.card].cost) {
        if (b.cardProblem(me, a.entry, a.aim)) { if (!b.hands[me].includes(a.entry)) this._cancel(); }
        else { this._play({ kind: 'card', key: a.entry.key, aim: a.aim }); if (this.net) a.sentAt = this.net.tick; }
      }
    }
    const vdt = this.paused ? 0 : dt * (this.phase === 'fight' ? this.speed : 1);
    for (const v of this.ctx.views.values()) v.update(vdt, b);
    this.fx.update(vdt);
    this.aimTele.update(dt);
    if (this.armed && !this.sel) {
      const spec = this._teleSpec(this.armed.entry, this.armed.aim);
      if (spec) this.aimTele.show(spec, b.energy[this.me] >= CARDS[this.armed.entry.card].cost ? 'ready' : 'charging');
      this._refreshMarks();
    } else if (this.sel && this.sel.aim && this.lastMouse) this._updateAim(this.lastMouse);
    for (const c of this.castTeles) {
      c.tele.update(dt);
      c.tele.show(c.spec, c.team === this.me ? 'ready' : 'enemy', Math.min(1, (b.t - c.t0) / c.dur));
    }
    this._updateHud();
  }
  _updateHud() {
    const b = this.battle;
    const s = Math.floor(b.t);
    this.dom.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (this.phase === 'fight' && !b.overtime) this.dom.phase.textContent = 'Combat';
    const evLeft = Math.ceil(this.map.eventTime - b.t), otLeft = Math.ceil(OVERTIME_AT - b.t);
    this.dom.event.textContent = this.phase !== 'fight' ? '' : !b.eventDone ? `${this.map.eventName.replace('!', '')} in ${evLeft}s` : !b.overtime ? `Overtime in ${otLeft}s` : 'Damage rising every second';
    this._renderHand();
    const en = b.energy[this.me];
    this.dom.gem.textContent = Math.floor(en);
    this.dom.segs.forEach((seg, i) => seg.style.setProperty('--f', String(Math.max(0, Math.min(1, en - i)))));
    this.dom.hand.querySelectorAll('.card').forEach((cardEl) => {
      const entry = b.hands[this.me].find((e) => e.key === cardEl.dataset.key);
      if (!entry) return;
      const c = CARDS[entry.card];
      const ok = en >= c.cost;
      cardEl.classList.toggle('ready', ok && this.phase === 'fight');
      cardEl.classList.toggle('selected', !!(this.sel && this.sel.entry === entry) || !!(this.armed && this.armed.entry === entry));
      cardEl.querySelector('.cfill').style.height = `${(1 - Math.min(1, en / c.cost)) * 100}%`;
      const u = b.caster(entry);
      cardEl.classList.toggle('busy', !!u && (b._disabled(u) || b.t < u.channelUntil));
    });
    for (const r of this.rosterRows) {
      r.hp.style.width = `${Math.max(0, r.u.hpf) * 100}%`;
      r.el.classList.toggle('dead', !r.u.alive);
      r.el.classList.toggle('hovered', this.hover === r.u);
    }
  }

  // ================= end =================
  _statsTable(team) {
    const rows = this.battle.units.filter((u) => u.team === team).sort((a, c) => c.dmgDealt - a.dmgDealt);
    const r = (x) => Math.round(x).toLocaleString();
    const max = Math.max(...rows.map((u) => u.dmgDealt), 1);
    return `<table class="stats"><thead><tr><th>Creature</th><th>Attacks</th><th>Abilities</th><th>Ultimates</th><th>Combos</th><th>Burn</th>
      <th>Total</th><th>Taken</th><th>Healed</th><th>Shields</th><th>Kills</th><th>Cards cast</th></tr></thead><tbody>
      ${rows.map((u) => `<tr class="${u.alive ? '' : 'fallen'}"><td style="--el:${ELEMENTS[u.elements[0]].color}"><img src="${this.portrait(u)}" alt=""><b>${u.name}</b>${u.captured ? ' <em>captured</em>' : ''}</td>
        <td>${r(u.stats.attack)}</td><td>${r(u.stats.ability)}</td><td>${r(u.stats.special)}</td><td>${r(u.stats.combo)}</td><td>${r(u.stats.dot)}</td>
        <td class="tot"><div class="bar" style="width:${(u.dmgDealt / max) * 100}%"></div><span>${r(u.dmgDealt)}</span></td>
        <td>${r(u.stats.taken)}</td><td>${r(u.stats.healDone)}</td><td>${r(u.stats.shieldDone)}</td><td>${u.kills}</td><td>${u.casts}</td></tr>`).join('')}
      </tbody></table>`;
  }
  _end(winner) {
    this.phase = 'end';
    this._cancel();
    for (const c of this.castTeles) c.tele.dispose();
    this.castTeles = [];
    for (const u of this.battle.units) if (u.team === winner && u.alive) this.view(u).victory();
    const won = winner === this.me;
    const card = document.createElement('div');
    card.className = `endcard ${won ? 'win' : 'lose'}`;
    const combos = Object.entries(this.battle.reactions).sort((a, c) => c[1] - a[1]).map(([n, k]) => `${n} ×${k}`).join(' · ') || 'none';
    const caught = this.battle.captured.filter((u) => u.team === this.foe);
    card.innerHTML = `<h1>${won ? 'Victory!' : 'Defeat'}</h1>
      <p>${this.battle.timeout ? 'Time ran out: the team with more health left wins.' : won ? 'The opposing team has fallen.' : 'Your team was defeated.'}${this.net && this.net.desync !== null ? ' (The two screens fell out of sync during this match, so the result may differ on your friend\'s screen.)' : ''}
        Fight time ${this.dom.clock.textContent}. Combos: ${combos}</p>
      ${caught.length ? `<p class="caught">${won ? 'Captured' : 'Captured (but lost when your team fell)'}: <b>${caught.map((u) => u.name).join(', ')}</b></p>` : ''}
      <div class="tabs"><button class="tab on" data-t="0">Your team</button><button class="tab" data-t="1">Opponent</button></div>
      <div class="table-wrap">${this._statsTable(this.me)}</div>
      <button class="primary cont">Continue</button>`;
    card.querySelectorAll('.tab').forEach((tb) => tb.addEventListener('click', () => {
      card.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === tb));
      card.querySelector('.table-wrap').innerHTML = this._statsTable(+tb.dataset.t === 0 ? this.me : this.foe);
    }));
    card.querySelector('.cont').addEventListener('click', () => this.onEnd({ won, battle: this.battle, captured: won ? caught : [] }));
    setTimeout(() => this.hud.appendChild(card), 900);
  }

  /** Versus: the friend closed the page or lost the connection. */
  _disconnected() {
    if (this.phase === 'end' || this.disposed) return;
    this.phase = 'end';
    this._cancel();
    const card = document.createElement('div');
    card.className = 'endcard lose';
    card.innerHTML = `<h1>Connection lost</h1><p>${this.pvp.foeName} left the match or their connection dropped.</p><button class="primary cont">Continue</button>`;
    card.querySelector('.cont').addEventListener('click', () => this.onEnd({ won: false, battle: this.battle, captured: [], disconnected: true }));
    this.hud.appendChild(card);
  }

  dispose() {
    this.disposed = true;
    this._offMsg?.(); this._offClose?.();
    window.removeEventListener('keydown', this._handlers.keydown);
    window.removeEventListener('pointermove', this._handlers.move);
    window.removeEventListener('pointerup', this._handlers.up);
    this.stage.canvas.removeEventListener('pointerdown', this._handlers.down);
    this.stage.canvas.removeEventListener('contextmenu', this._handlers.ctx);
    this.stage.onFrame = null;
    this.stage.setMarks(new Map());
    this.aimTele.dispose();
    for (const c of this.castTeles) c.tele.dispose();
    for (const v of this.ctx.views.values()) v.dispose();
    this.fx.clear();
    this.hud.remove();
  }
}
