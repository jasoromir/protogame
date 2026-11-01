// Versus a friend: lobby UI (host / join by code), match setup, and rematches.
// The host is team 0, the guest team 1. Both browsers build the same battle from the same seed and
// the two teams' {line, level, path} (stats are recomputed locally, never sent), then run it in lockstep.
import { BattleScene } from '../game/battle.js';
import { MAPS } from '../sim/maps.js';
import { TRAINER_CARDS } from '../sim/cards.js';
import { LINES, ELEMENTS, PACING, statsFor, currentForm } from '../data/creatures.js';
import * as P from '../game/progress.js';
import { host, join } from './link.js';
import { Lockstep } from './lockstep.js';

const PROTO = 1;                 // bump when the rules change, so mismatched versions refuse to play
const EQUAL_LEVEL = 20;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };

function myHello(app) {
  const s = app.save;
  return {
    type: 'hello', v: PROTO, name: s.settings.name || 'Trainer',
    team: P.teamCreatures(s).slice(0, s.teamSize).map((c) => ({ line: c.line, level: c.level, path: c.path || null, equipped: (c.equipped || []).slice(0, 1) })),
    kit: s.kit.filter((k) => TRAINER_CARDS.includes(k)).slice(0, 2),
  };
}
/** Never trust the wire: rebuild the friend's hello from known values only. */
function cleanHello(m) {
  if (m.v !== PROTO) return { error: 'Your friend has a different version of the game. Both of you reload the page.' };
  const name = String(m.name || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Friend';
  const team = (Array.isArray(m.team) ? m.team : []).slice(0, 9).filter((c) => c && typeof c.line === 'string' && Object.hasOwn(LINES, c.line)).map((c) => ({
    line: c.line,
    level: Number.isInteger(c.level) ? Math.max(1, Math.min(PACING.maxLevel, c.level)) : PACING.startLevel,
    path: c.path === 'A' || c.path === 'B' ? c.path : null,
    equipped: Array.isArray(c.equipped) && typeof c.equipped[0] === 'string' && /^[a-z_]{1,30}$/.test(c.equipped[0]) ? [c.equipped[0]] : [],
  }));
  if (!team.length) return { error: 'Your friend has no creatures on their team.' };
  const kit = [...new Set((Array.isArray(m.kit) ? m.kit : []).filter((k) => TRAINER_CARDS.includes(k)))].slice(0, 2);
  return { name, team, kit };
}
const defsFor = (team, count, level) => team.slice(0, count).map((c) => statsFor({ ...c, level: level ?? c.level }));

export class Versus {
  constructor(app) {
    this.app = app;
    this.link = null;
    this.foe = null;          // cleaned hello from the friend
    this.opts = { map: 'random', equal: true };
    this.state = 'menu';      // menu | hosting | joining | lobby
    this.status = '';
  }
  get isHost() { return this.link?.role === 'host'; }

  open() { this.app._overWorld(); this.render(); }
  leave() {
    this.hosting?.cancel();
    this.hosting = null;
    if (this.link) { this.link.close(); this.link = null; }
    this.app.versus = null;
    this.app.showMap();
  }

  // ---------- connection ----------
  _host(local) {
    this.state = 'hosting'; this.code = null; this.status = 'Reserving a code…'; this.render();
    this.hosting = host({ local, onCode: (code) => { this.code = code; this.status = 'Waiting for your friend to join…'; this.render(); },
      onStatus: (t) => { this.status = t; this.render(); } });
    this.hosting.ready.then((link) => this._connected(link), (err) => { this.state = 'menu'; this.status = err.message; this.render(); });
  }
  _join(code) {
    this.state = 'joining'; this.status = 'Looking for the match…'; this.render();
    join(code, { onStatus: (t) => { this.status = t; this.render(); } })
      .then((link) => this._connected(link), (err) => { this.state = 'menu'; this.status = err.message; this.render(); });
  }
  _connected(link) {
    this.hosting = null;
    this.link = link;
    this.state = 'lobby';
    this.status = '';
    link.onMessage((m) => this._msg(m));
    link.onClose(() => {
      this.link = null; this.foe = null;
      if (this.scene) return;   // the battle shows its own "connection lost" card
      this.state = 'menu'; this.status = 'Your friend left.'; this.render();
    });
    link.send(myHello(this.app));
    this.render();
  }
  _msg(m) {
    switch (m.type) {
      case 'hello': {
        const f = cleanHello(m);
        if (f.error) { this.status = f.error; this.foe = null; } else { this.foe = f; this.status = ''; }
        if (!this.scene) this.render();
        break;
      }
      case 'opts': if (!this.isHost) { this.opts = { map: Object.hasOwn(MAPS, m.map) ? m.map : 'random', equal: m.equal !== false }; if (!this.scene) this.render(); } break;
      case 'start': if (!this.isHost && !this.scene) this._startFromHost(m); break;
      case 'ready': this.pendingReady = m; break;   // may arrive before our battle screen exists
      default: break;
    }
  }

  // ---------- match ----------
  _start() {
    if (!this.isHost || !this.foe || this.scene) return;
    const ids = Object.keys(MAPS);
    const map = this.opts.map === 'random' ? ids[Math.floor(Math.random() * ids.length)] : this.opts.map;
    const mine = myHello(this.app).team;
    const start = { type: 'start', seed: (Math.random() * 1e9) | 0, map, level: this.opts.equal ? EQUAL_LEVEL : null,
      count: Math.min(mine.length, this.foe.team.length) };
    this.link.send(start);
    this._launch(start);
  }
  _startFromHost(m) {
    if (!this.foe || !Number.isInteger(m.seed) || !Object.hasOwn(MAPS, m.map) || !Number.isInteger(m.count) || m.count < 1 || m.count > 9) return;
    const level = Number.isInteger(m.level) ? Math.max(1, Math.min(PACING.maxLevel, m.level)) : null;
    this._launch({ seed: m.seed, map: m.map, level, count: m.count });
  }
  _launch({ seed, map, level, count }) {
    const app = this.app, me = this.isHost ? 0 : 1;
    const mineHello = myHello(app);
    const teams = me === 0 ? [mineHello.team, this.foe.team] : [this.foe.team, mineHello.team];
    const kits = me === 0 ? [mineHello.kit, this.foe.kit] : [this.foe.kit, mineHello.kit];
    this.lockstep = new Lockstep(this.link, me);
    this.pendingReady = null;
    app.setScreen(null);
    app.dropBackdrop();
    if (app.world) app.world.suspend();
    const scene = new BattleScene(app, {
      map: MAPS[map], title: `Versus ${esc(this.foe.name)}`, subtitle: level ? `everyone Lv ${level}` : 'trained levels',
      posA: me === 0 ? P.savedPositions(app.save) : null,
      pvp: { me, lockstep: this.lockstep, link: this.link, seed, teamA: defsFor(teams[0], count, level), teamB: defsFor(teams[1], count, level),
        trainerA: kits[0], trainerB: kits[1], foeName: esc(this.foe.name) },
      onEnd: () => this._afterMatch(),
    });
    this.scene = scene;
    app.battleScene = scene;
    // the friend may have pressed Ready before our screen existed
    const early = this.pendingReady;
    if (early) scene._foeReady(early);
  }
  _afterMatch() {
    const app = this.app;
    this.scene.dispose();
    this.scene = null;
    app.battleScene = null;
    this.lockstep?.dispose();
    this.lockstep = null;
    app.save.versus = app.save.versus || { played: 0 };
    app.save.versus.played++;
    app.persist();
    if (app.world) app.world.resume(); else app.showMap();
    app._overWorld();
    if (!this.link) { this.state = 'menu'; this.status = 'The connection was closed.'; }
    this.render();
  }

  // ---------- UI ----------
  _teamHtml(team, count) {
    return team.map((c, i) => {
      const f = currentForm(c), dim = count !== null && i >= count;
      return `<div class="vs-mon ${dim ? 'dim' : ''}" style="--el:${ELEMENTS[LINES[c.line].element[0]].color}" title="${dim ? 'Sits out: teams are cut to the same size' : ''}">
        <img src="${this.app.portraits.portrait(f.name, c.line)}" alt=""><b>${esc(f.name)}</b><small>Lv ${c.level}</small></div>`;
    }).join('');
  }
  render() {
    if (this.scene) return;
    const app = this.app, s = app.save;
    let body = '';
    if (this.state === 'menu') {
      body = `<p>Fight a friend in real time. One of you hosts and shares the code, the other joins with it.</p>
        <label class="vs-name">Your name <input maxlength="16" value="${esc(s.settings.name || 'Trainer')}"></label>
        <div class="vs-choice">
          <div class="vs-box"><h3>Host</h3><p>Get a code to send to your friend.</p><button class="primary" data-a="host">Host a match</button></div>
          <div class="vs-box"><h3>Join</h3><p>Type the code your friend sent you.</p>
            <div class="vs-join"><input class="code" maxlength="12" placeholder="CODE" autocomplete="off" spellcheck="false"><button class="primary" data-a="join">Join</button></div></div>
        </div>
        <p class="vs-small">Testing alone? <a href="#" data-a="local">Host in this browser</a>, then join the LOCAL code from a second tab.
          Matches connect your two browsers directly (WebRTC); the free PeerJS server only introduces them.</p>`;
    } else if (this.state === 'hosting') {
      body = `<p>Send this code to your friend:</p>
        <div class="vs-code">${this.code ? esc(this.code) : '…'}</div>
        ${this.code ? '<button data-a="copy">Copy code</button>' : ''}
        <p class="vs-small">Keep this page open. Your friend opens ${esc(location.origin + location.pathname)}, goes to Versus and joins.</p>`;
    } else if (this.state === 'joining') {
      body = '<p>Connecting…</p>';
    } else {
      const mine = myHello(app);
      const count = this.foe ? Math.min(mine.team.length, this.foe.team.length) : null;
      const mapName = this.opts.map === 'random' ? 'Random' : MAPS[this.opts.map].name;
      body = `<div class="vs-teams">
          <div class="vs-side me"><h3>${esc(mine.name)} <small>(you)</small></h3>${this._teamHtml(mine.team, count)}</div>
          <div class="vs-mid">VS</div>
          <div class="vs-side foe"><h3>${this.foe ? esc(this.foe.name) : 'Your friend'}</h3>${this.foe ? this._teamHtml(this.foe.team, count) : '<p>Connecting…</p>'}</div>
        </div>
        ${count !== null ? `<p class="vs-small">${count} vs ${count}. Each side plays its own cards; there's no pause in versus.</p>` : ''}
        <div class="vs-opts">${this.isHost ? `
          <label>Map <select class="map"><option value="random">Random</option>${Object.entries(MAPS).map(([id, m]) => `<option value="${id}" ${this.opts.map === id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
          <label><input type="checkbox" class="equal" ${this.opts.equal ? 'checked' : ''}> Everyone Lv ${EQUAL_LEVEL} (fair fight)</label>
          <button class="primary" data-a="start" ${this.foe ? '' : 'disabled'}>Start battle</button>`
        : `<span>Map: <b>${esc(mapName)}</b> · ${this.opts.equal ? `everyone Lv ${EQUAL_LEVEL}` : 'trained levels'}</span><span class="vs-wait">Waiting for the host to start…</span>`}</div>`;
    }
    const el = h(`<div class="modal versus"><div class="panel">
      <h2>Versus</h2>${body}
      ${this.status ? `<p class="vs-status">${esc(this.status)}</p>` : ''}
      <div class="vs-foot"><button data-a="back">${this.state === 'lobby' || this.state === 'hosting' ? 'Leave' : 'Back'}</button></div></div></div>`);
    const q = (sel) => el.querySelector(sel);
    const saveName = () => { const v = q('.vs-name input'); if (v) { s.settings.name = v.value.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Trainer'; app.persist(); } };
    q('[data-a=back]').onclick = () => this.leave();
    q('[data-a=host]')?.addEventListener('click', () => { saveName(); this._host(false); });
    q('[data-a=local]')?.addEventListener('click', (e) => { e.preventDefault(); saveName(); this._host(true); });
    const doJoin = () => { saveName(); this._join(q('.code').value); };
    q('[data-a=join]')?.addEventListener('click', doJoin);
    q('.code')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
    q('[data-a=copy]')?.addEventListener('click', () => navigator.clipboard?.writeText(this.code).then(() => { this.status = 'Copied!'; this.render(); }));
    q('[data-a=start]')?.addEventListener('click', () => this._start());
    const sendOpts = () => this.link?.send({ type: 'opts', ...this.opts });
    q('select.map')?.addEventListener('change', (e) => { this.opts.map = e.target.value; sendOpts(); });
    q('input.equal')?.addEventListener('change', (e) => { this.opts.equal = e.target.checked; sendOpts(); this.render(); });
    // typing in the lobby must not move the trainer or open menus
    el.addEventListener('keydown', (e) => e.stopPropagation());
    if (this.state === 'lobby' && this.isHost && !this.sentOpts) { this.sentOpts = true; sendOpts(); }
    app.setScreen(el);
  }
}
