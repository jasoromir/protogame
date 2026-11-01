// Menu screens (HTML over the 3D canvas): title, world map, team, results, path choice, how to play.
import { Battle } from '../sim/engine.js';
import { MAPS } from '../sim/maps.js';
import { CARDS, TRAINER_CARDS } from '../sim/cards.js';
import { cardIcon, SHAPE_LABEL } from './icons.js';
import { UnitView } from '../render/units.js';
import { FX } from '../render/fx.js';
import { GYMS, TRAINING } from '../data/gyms.js';
import { LINES, ELEMENTS, ABILITY_NAMES, ABILITY_DESC, PACING, statsFor, currentForm, nextEvolution, knownAbilities, equipped, ELEMENT_MOVE } from '../data/creatures.js';
import { CODEX } from '../data/codex.js';
import { DUOS, activeDuos } from '../sim/synergies.js';
import { mountViewer } from '../render/portraits.js';
import * as P from '../game/progress.js';

const h = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
const elColor = (line) => ELEMENTS[LINES[line].element[0]].color;

// ---------------- 3D backdrop for menus ----------------
export class Diorama {
  constructor(app) {
    this.app = app;
    const stage = app.stage;
    stage.setMap(MAPS.caldera);
    stage.setTitleCamera();
    this.fx = new FX(stage, app.overlay);
    const defs = [statsFor({ line: 'Cindrake', level: 12 }), statsFor({ line: 'Cindrake', level: 22, path: 'B' }), statsFor({ line: 'Brinehorn', level: 12 })];
    this.battle = new Battle({ teamA: defs, teamB: [], map: MAPS.caldera, policyA: null, policyB: null, kitA: [], kitB: [], posA: [[3, 4], [2, 3], [4, 3]] });
    this.ctx = { stage, fx: this.fx, assets: app.assets, overlay: app.overlay, views: new Map() };
    this.views = this.battle.units.map((u) => { const v = new UnitView(this.ctx, u); this.ctx.views.set(u.uid, v); v.bar.el.style.display = 'none'; return v; });
    this.views[0].yaw = 0.4; this.views[1].yaw = 0; this.views[2].yaw = -0.5;
    let t = 0;
    stage.onFrame = (dt) => {
      t += dt;
      for (const v of this.views) { v.update(dt, this.battle); v.bar.el.style.display = 'none'; }
      if (Math.random() < dt * 3) this.fx.spark(this.views[1].root.position.clone().setY(0.5), { color: 0xff7a20, count: 1, speed: 0.4, size: 0.12, life: 0.8, gravity: 0.8 });
      this.fx.update(dt);
    };
  }
  dispose() { for (const v of this.views) v.dispose(); this.fx.clear(); this.app.stage.onFrame = null; }
}

// ---------------- title ----------------
export function titleScreen(app) {
  const hasSave = !!app.save;
  const el = h(`<div class="screen title">
    <div class="logo"><div class="logo-main">PROJECT EMBER</div><div class="logo-sub">creature tactics · prototype</div></div>
    <div class="menu">
      ${hasSave ? '<button class="primary" data-a="continue">Continue</button>' : ''}
      <button class="${hasSave ? '' : 'primary'}" data-a="new">New game</button>
      <button data-a="howto">How to play</button>
    </div>
    <div class="footnote">Working title. Creatures without a 3D model yet appear as placeholder figures.</div>
  </div>`);
  el.querySelector('[data-a="new"]').onclick = () => (hasSave && !confirm('Start over? Your current save will be replaced.') ? null : partnerScreen(app));
  el.querySelector('[data-a="continue"]')?.addEventListener('click', () => app.showMap());
  el.querySelector('[data-a="howto"]').onclick = () => howToPlay(app);
  app.setScreen(el);
}

function partnerScreen(app) {
  const options = [
    ['Cindrake', 'Fire mage. Later chooses between Pyrewyrm (beast dragon) and Ignarion (dragon warrior).'],
    ['Hrimfang', 'Ice assassin. Leaps onto the weakest enemy.'],
    ['Raijura', 'Electric bruiser. Grows into Raigar, a storm-tiger warrior.'],
  ];
  const el = h(`<div class="screen partner"><h2>Choose your partner</h2><p>Your partner joins a starter team of five.</p>
    <div class="partners">${options.map(([l, d]) => `<div class="pcard" style="--el:${elColor(l)}" data-l="${l}">
      <div class="pc-name">${l}</div><div class="pc-el">${ELEMENTS[LINES[l].element[0]].name} · ${LINES[l].role}</div><p>${d}</p></div>`).join('')}</div>
    <button class="back">Back</button></div>`);
  el.querySelectorAll('.pcard').forEach((c) => c.onclick = () => { app.save = P.newGame(c.dataset.l); app.persist(); app.showMap(); });
  el.querySelector('.back').onclick = () => titleScreen(app);
  app.setScreen(el);
}

export function howToPlay(app, back = () => (app.inGame ? app.showMap() : titleScreen(app))) {
  const el = h(`<div class="screen howto"><div class="panel">
    <h2>How to play</h2>
    <ul>
      <li><b>Creatures fight on their own:</b> they move, attack and use their automatic ability.</li>
      <li><b>You play their cards.</b> Each creature brings a <b>skill</b> and (from Lv 13) an <b>ultimate</b> card into your deck; your trainer adds two. You hold 4 cards; a played card goes to the back and the next one comes in (see "Next").</li>
      <li><b>Shared energy:</b> every card costs energy from the purple bar, which refills over time. Max 10.</li>
      <li><b>Aim:</b> drag a card onto the board (or click it, or press 1–4, then click). The indicator shows exactly what it hits: <b>cones</b> from the creature's mouth, <b>areas</b> dropped anywhere, <b>lines</b>, single <b>targets</b>, <b>leaps</b>.</li>
      <li><b>Red vs blue:</b> red means not enough energy yet. Release anyway and the card waits on the board, turning blue and firing by itself the moment you can afford it.</li>
      <li><b>Cast time:</b> cards take a moment to cast and enemies see the indicator. Stun or freeze a creature mid-cast to <b>interrupt</b> it; watch the orange enemy indicators and move or shield.</li>
      <li><b>Combos:</b> each element leaves a mark; a different element on that mark sets off a combo (Soak + Shock = Conduct, Soak + Chill = Flash Freeze, Freeze + Earth = Shatter, Burn + Shock = Plasma Burst…). Chain them for a multiplier.</li>
      <li><b>Deploy:</b> before each fight, drag your creatures onto the blue tiles. Terrain matters: hover any tile.</li>
      <li><b>Overtime:</b> after 70s damage keeps rising and healing is halved, so fights always end.</li>
      <li><b>Wild creatures:</b> weaken one below 30% HP and hit it with the <b>Capture</b> card to add it to your collection.</li>
      <li><b>Auto</b> button: an AI plays your cards for you. Space pauses.</li>
      <li><b>Versus</b> (V in the world): fight a friend online. One of you hosts and sends the code, the other joins. Both press Ready after deploying; there is no pause.</li>
    </ul>
    <button class="primary">Got it</button></div></div>`);
  el.querySelector('button').onclick = back;
  app.setScreen(el);
}

// ---------------- world map ----------------
export function mapScreen(app) {
  const s = app.save;
  const nodes = [
    { ...TRAINING, x: 22, y: 70, element: 'earth', unlocked: true, training: true },
    ...GYMS.map((g, i) => ({ ...g, x: [38, 58, 74, 60][i], y: [48, 66, 38, 18][i], unlocked: P.isUnlocked(s, i, GYMS), beaten: s.gymsBeaten.includes(g.id) })),
  ];
  const el = h(`<div class="screen map">
    <div class="map-art">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="map-paths">
        <path d="M22 70 Q30 58 38 48 T58 66 T74 38 T60 18" />
      </svg>
      ${nodes.map((n) => `<div class="node ${n.unlocked ? '' : 'locked'} ${n.beaten ? 'beaten' : ''} ${n.training ? 'training' : ''}"
        style="left:${n.x}%;top:${n.y}%;--el:${ELEMENTS[n.element].color}" data-id="${n.id}">
        <div class="dot">${n.beaten ? '✓' : n.unlocked ? '' : '🔒'}</div><div class="nlabel">${n.name}<small>${n.training ? 'practice' : `Lv ${n.level}`}</small></div></div>`).join('')}
    </div>
    <div class="side">
      <h3>${s.gymsBeaten.length === GYMS.length ? 'Champion!' : 'Your journey'}</h3>
      <p>Gyms beaten: ${s.gymsBeaten.length}/${GYMS.length}</p>
      <p class="keys">Keys: ${s.keys.length ? s.keys.map((k) => `<span>${k}</span>`).join('') : '<i>none yet</i>'}</p>
      <div class="team-mini">${P.teamCreatures(s).map((c) => `<div style="--el:${elColor(c.line)}"><b>${currentForm(c).name}</b> Lv ${c.level}${currentForm(c).pendingPaths ? ' <em>evolve!</em>' : ''}</div>`).join('')}</div>
      <button data-a="team">Team & collection</button>
      <button data-a="codex">Creature Codex</button>
      <button data-a="howto">How to play</button>
      <button data-a="title">Title screen</button>
    </div>
    <div class="node-info"></div>
  </div>`);
  const info = el.querySelector('.node-info');
  el.querySelectorAll('.node').forEach((nd) => nd.onclick = () => {
    const n = nodes.find((x) => x.id === nd.dataset.id);
    if (!n.unlocked) { info.innerHTML = `<div class="panel"><h3>${n.name}</h3><p>Beat the previous gym to unlock.</p></div>`; return; }
    const rewards = n.training ? '<p>Reward: XP.</p>' : `<p><b>Gym run:</b> 2 trainers, then the leader. Pick a boon after each win. Reward: a new creature and the <b>${n.reward.key}</b>.${n.beaten ? ' (Already claimed. Rematches give XP.)' : ''}</p>`;
    info.innerHTML = `<div class="panel" style="--el:${ELEMENTS[n.element].color}"><h3>${n.name}</h3>
      <p class="leader">${n.training ? n.leader : `Leader: ${n.leader} · ${ELEMENTS[n.element].name}`}${n.map ? ` · Map: ${MAPS[n.map].name}` : ''}</p>
      <p>${n.intro}</p>${n.team ? `<p class="foes">${n.team.map((l) => `<span style="--el:${elColor(l)}">${l}</span>`).join('')}</p>` : ''}${rewards}
      <button class="primary">Prepare team</button></div>`;
    info.querySelector('button').onclick = () => teamScreen(app, n);
  });
  el.querySelector('[data-a="team"]').onclick = () => teamScreen(app, null);
  el.querySelector('[data-a="codex"]').onclick = () => codexScreen(app);
  el.querySelector('[data-a="howto"]').onclick = () => howToPlay(app, () => app.showMap());
  el.querySelector('[data-a="title"]').onclick = () => titleScreen(app);
  app.setScreen(el);
}

// ---------------- team & collection ----------------
export function cardChip(id, locked = false, lv = 0) {
  const c = CARDS[id];
  const tip = `${c.name} (${c.kind === 'ult' ? 'Ultimate' : c.kind === 'skill' ? 'Skill' : 'Trainer'} · ${SHAPE_LABEL[c.shape]} · ${c.cost} energy): ${c.desc}${locked ? ` Unlocks at Lv ${lv}.` : ''}`;
  return `<span class="cchip ${locked ? 'locked' : ''} ${c.kind}" title="${tip.replace(/"/g, '&quot;')}">${cardIcon(id, { size: 30, dim: locked })}<b>${c.name}</b><i>${c.cost}</i></span>`;
}
function abilityList(c) {
  const st = statsFor(c), line = LINES[c.line], form = currentForm(c), u = PACING.unlock;
  const ult = form.ult || line.ult;
  return `<div class="abl"><div class="auto-ab" title="${ABILITY_DESC[st.auto] || ''}">Auto: <b>${ABILITY_NAMES[st.auto]}</b>${c.level >= u.passive ? ` · Passive: <b>${ABILITY_NAMES[form.passive || line.passive]}</b>` : ''}</div>
    <div class="cards-row">${cardChip(form.skill || line.skill)}${cardChip(ult, c.level < u.special, u.special)}</div></div>
    <p class="stats">HP ${Math.round(st.hp)} · ATK ${Math.round(st.atk)} · Range ${st.range} · Armor ${st.armor}</p>`;
}

export function pathChoice(app, c, onDone) {
  const form = currentForm(c);
  const paths = form.pendingPaths;
  const el = h(`<div class="modal"><div class="panel path">
    <h2>${form.name} is ready to evolve</h2><p>Choose a path. This choice is permanent: to own both, raise another one.</p>
    <div class="paths">${Object.entries(paths).map(([k, p]) => {
      const has = app.save.keys.includes(p.key);
      return `<div class="pathcard ${has ? '' : 'locked'}" data-k="${k}"><h3>${p.name}</h3><p class="role">${p.role}</p><p>${p.blurb}</p>
        <p class="key">${has ? `Uses: ${p.key} ✓` : `Needs: ${p.key} 🔒`}</p></div>`;
    }).join('')}</div><button class="later">Decide later</button></div></div>`);
  el.querySelectorAll('.pathcard').forEach((pc) => pc.onclick = () => {
    if (pc.classList.contains('locked')) return;
    P.choosePath(app.save, c.uid, pc.dataset.k); app.persist(); el.remove(); onDone(true);
  });
  el.querySelector('.later').onclick = () => { el.remove(); onDone(false); };
  app.overlay.appendChild(el);
}

export function teamScreen(app, opponent) {
  const s = app.save;
  const render = () => {
    const team = new Set(s.team);
    const el = h(`<div class="screen team">
      <div class="team-head"><h2>${opponent ? `Prepare for ${opponent.name}` : 'Team & collection'}</h2>
        <p>Pick up to <b>${s.teamSize}</b> creatures (${s.team.length}/${s.teamSize}) and 2 trainer cards. Each creature adds its two cards to your deck. Beat gyms to grow your team.</p></div>
      <div class="cards">${s.creatures.map((c) => {
        const f = currentForm(c), nx = nextEvolution(c);
        return `<div class="ccard ${team.has(c.uid) ? 'in' : ''}" style="--el:${elColor(c.line)}" data-uid="${c.uid}">
          <div class="cc-top"><b>${f.name}</b><span>Lv ${c.level}</span></div>
          <div class="cc-sub">${ELEMENTS[LINES[c.line].element[0]].name} · ${statsFor(c).role}</div>
          <div class="xp"><i style="width:${(c.xp / PACING.xpToNext(c.level)) * 100}%"></i></div>
          ${abilityList(c)}
          ${f.pendingPaths ? '<button class="evolve">Choose evolution path</button>' : nx ? `<p class="next">Evolves at Lv ${nx.level}${nx.paths ? ' (choose a path)' : ` → ${nx.name}`}</p>` : '<p class="next">Final form</p>'}
          <button class="details">Details & abilities</button>
        </div>`;
      }).join('')}</div>
      <div class="team-syn">${synergyPreview(s)}</div>
      <div class="kit"><h3>Trainer cards</h3>${TRAINER_CARDS.map((k) => `<button class="chip ${s.kit.includes(k) ? 'on' : ''}" data-k="${k}" title="${CARDS[k].desc}">${cardIcon(k, { size: 26 })}${CARDS[k].name} <small>${CARDS[k].cost}</small></button>`).join('')}</div>
      <div class="team-foot"><button data-a="back">Back</button>${opponent ? '<button class="primary" data-a="go">Battle!</button>' : ''}</div>
    </div>`);
    el.querySelectorAll('.ccard').forEach((cc) => cc.onclick = (e) => {
      const uid = cc.dataset.uid;
      if (e.target.classList.contains('evolve')) { pathChoice(app, P.byUid(s, uid), () => render()); return; }
      if (e.target.classList.contains('details')) { creatureSheet(app, P.byUid(s, uid), () => render()); return; }
      if (team.has(uid)) { if (s.team.length > 1) s.team = s.team.filter((x) => x !== uid); }
      else if (s.team.length < s.teamSize) s.team.push(uid);
      app.persist(); render();
    });
    el.querySelectorAll('.chip').forEach((ch) => ch.onclick = () => {
      const k = ch.dataset.k;
      if (s.kit.includes(k)) { if (s.kit.length > 1) s.kit = s.kit.filter((x) => x !== k); }
      else if (s.kit.length < 2) s.kit.push(k);
      app.persist(); render();
    });
    el.querySelector('[data-a="back"]').onclick = () => app.showMap();
    el.querySelector('[data-a="go"]')?.addEventListener('click', () => app.startBattle(opponent));
    app.setScreen(el);
  };
  render();
}

// ---------------- results ----------------
export function resultsScreen(app, { won, reports, reward, opponent }) {
  const el = h(`<div class="screen results"><div class="panel">
    <h2>${won ? 'Victory' : 'Defeat'} · ${opponent.name}</h2>
    ${reward && reward.creature ? `<div class="reward">New creature: <b>${reward.creature.line}</b> joins your collection!${reward.key ? ` You earned the <b>${reward.key}</b>.` : ''}${reward.teamSize ? ` <b>Team size is now ${reward.teamSize}!</b>` : ''}</div>` : ''}
    ${reward && reward.captured && reward.captured.length ? `<div class="reward">Captured: <b>${reward.captured.map((c) => c.line).join(', ')}</b> joined your collection!</div>` : ''}
    <div class="xp-list">${reports.map((r) => `<div class="xprow" style="--el:${elColor(r.line)}">
      <b>${r.formName}</b> <span>+${r.gained} XP</span> <span>Lv ${r.from}${r.to > r.from ? ` → <em>${r.to}</em>` : ''}</span>
      <div class="xp"><i style="width:${(r.xp / r.need) * 100}%"></i></div>
      ${r.evolvedFrom ? `<div class="evo">${r.evolvedFrom} evolved into <b>${r.formName}</b>!</div>` : ''}
      ${r.unlocks.map((x) => `<div class="unl">Unlocked ${x}</div>`).join('')}
      ${r.pendingPaths ? '<div class="evo">Ready to choose an evolution path (Team screen).</div>' : ''}
    </div>`).join('')}</div>
    <button class="primary">Continue</button></div></div>`);
  el.querySelector('button').onclick = () => app.showMap();
  app.setScreen(el);
  const pending = reports.filter((r) => r.pendingPaths);
  if (pending.length) setTimeout(() => pathChoice(app, P.byUid(app.save, pending[0].uid), () => {}), 400);
}

// ---------------- synergy preview (team screen) ----------------
function synergyPreview(s) {
  const lines = P.teamCreatures(s).map((c) => c.line);
  const owned = new Set(s.creatures.map((c) => c.line));
  const act = activeDuos(lines).map((d) => d.id);
  const counts = {};
  for (const l of lines) for (const e of LINES[l].element) counts[e] = (counts[e] || 0) + 1;
  const els = Object.entries(counts).map(([e, n]) => `<span class="${n >= 2 ? 'on' : ''}" style="--el:${ELEMENTS[e].color}">${ELEMENTS[e].name} ×${n}</span>`).join('');
  const duos = DUOS.filter((d) => d.pair.every((l) => owned.has(l))).map((d) =>
    `<span class="duo ${act.includes(d.id) ? 'on' : ''}" title="${d.desc}">${act.includes(d.id) ? '✦' : '○'} ${d.name} <small>${d.pair.join(' + ')}</small></span>`).join('');
  return `<h3>Synergies</h3><div class="els">${els}</div><div class="duos">${duos || '<i>Catch more creatures to unlock Duo synergies.</i>'}</div>`;
}

// ---------------- Creature Codex ----------------
const ROLE_ORDER = ['Tank', 'Bruiser', 'Duelist', 'Assassin', 'Mage', 'Marksman', 'Controller', 'Support', 'Healer'];
function formRole(entry) {
  const line = LINES[entry.line];
  for (const f of line.forms) {
    if (f.name === entry.name) return f.role || line.role;
    if (f.paths) for (const p of Object.values(f.paths)) if (p.name === entry.name) return p.role || line.role;
  }
  return line.role;
}

export function codexScreen(app, sort = 'no') {
  const s = app.save;
  const owned = P.ownedForms(s), seen = new Set(s.seen || []);
  const entries = [...CODEX];
  const el0 = (e) => LINES[e.line].element[0];
  const elOrder = Object.keys(ELEMENTS);
  if (sort === 'element') entries.sort((a, b) => elOrder.indexOf(el0(a)) - elOrder.indexOf(el0(b)) || a.no - b.no);
  if (sort === 'role') entries.sort((a, b) => ROLE_ORDER.indexOf(formRole(a)) - ROLE_ORDER.indexOf(formRole(b)) || a.no - b.no);
  if (sort === 'owned') entries.sort((a, b) => (owned.has(b.name) - owned.has(a.name)) || a.no - b.no);
  const count = CODEX.filter((e) => owned.has(e.name)).length;
  const el = h(`<div class="screen codex">
    <div class="codex-head"><h2>Creature Codex</h2><span>${count}/${CODEX.length} discovered</span>
      <label>Sort by <select>${[['no', 'Number'], ['element', 'Element'], ['role', 'Role'], ['owned', 'Owned first']].map(([v, l]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button data-a="back">Back</button></div>
    <div class="codex-grid">${entries.map((e) => {
      const has = owned.has(e.name), saw = seen.has(e.name);
      const img = has ? app.portraits.portrait(e.name, e.line) : saw ? app.portraits.portrait(e.name, e.line, true) : '';
      return `<div class="centry ${has ? 'owned' : saw ? 'seen' : 'unknown'}" style="--el:${ELEMENTS[el0(e)].color}" data-name="${e.name}">
        <div class="cno">#${String(e.no).padStart(3, '0')}</div>
        ${img ? `<img src="${img}" alt="">` : '<div class="q">?</div>'}
        <div class="cname">${has || saw ? e.name : '???'}</div>
        <div class="cmeta">${has ? `${ELEMENTS[el0(e)].name} · ${formRole(e)}` : saw ? 'seen in battle' : ''}</div></div>`;
    }).join('')}</div></div>`);
  el.querySelector('select').onchange = (ev) => codexScreen(app, ev.target.value);
  el.querySelector('[data-a="back"]').onclick = () => app.showMap();
  el.querySelectorAll('.centry.owned, .centry.seen').forEach((c) => c.onclick = () => {
    const entry = CODEX.find((x) => x.name === c.dataset.name);
    const mine = s.creatures.filter((x) => x.line === entry.line && currentForm(x).name === entry.name)[0];
    creatureSheet(app, mine || null, () => codexScreen(app, sort), entry);
  });
  app.setScreen(el);
}

// ---------------- creature sheet ----------------
const STAT_MAX = { hp: 1700, atk: 85, aspd: 1.4, range: 4, armor: 50, move: 1.4 };
export function creatureSheet(app, c, onClose, entry = null) {
  const s = app.save;
  entry = entry || CODEX.find((x) => x.name === currentForm(c).name) || CODEX.find((x) => x.line === c.line);
  const line = LINES[entry.line];
  const inst = c || { line: entry.line, level: PACING.maxLevel, path: entry.path || null };
  const formName = c ? currentForm(c).name : entry.name;
  const st = statsFor(inst);
  const u = PACING.unlock;
  const chain = line.forms.map((f) => (f.paths
    ? `<span class="branch">${Object.values(f.paths).map((p) => `<b class="${p.name === formName ? 'cur' : ''}">${p.name}</b>`).join(' / ')}</span>`
    : `<b class="${f.name === formName ? 'cur' : ''}">${f.name}</b>`)).join(' → ');
  const known = knownAbilities(inst);
  const eq = [st.auto];
  const form = currentForm(inst);
  const passive = form.passive || line.passive;
  const skill = form.skill || line.skill, ult = form.ult || line.ult;
  const bigCard = (id, lv) => {
    const cd = CARDS[id], locked = c && c.level < lv;
    return `<div class="bigcard ${cd.kind} ${locked ? 'locked' : ''}">${cardIcon(id, { size: 52, dim: locked })}
      <div><b>${cd.name}</b> <small>${cd.kind === 'ult' ? 'Ultimate' : 'Skill'} card · ${SHAPE_LABEL[cd.shape]} · ${cd.cost} energy</small>
      <span>${cd.desc}</span>${locked ? `<em>Unlocks at Lv ${lv}</em>` : ''}</div></div>`;
  };
  const statRow = (k, label, v, fmt = (x) => Math.round(x)) => `<div class="srow"><span>${label}</span><div class="sbar"><i style="width:${Math.min(1, v / STAT_MAX[k]) * 100}%"></i></div><b>${fmt(v)}</b></div>`;
  const nx = c ? nextEvolution(c) : null;
  const upcoming = [['a second auto ability', u.a2], ['Passive', u.passive], ['the element move', u.a3], ['Ultimate card', u.special]].filter(([, lv]) => c && c.level < lv)[0];
  const lockedAt = (lv) => (!c || c.level >= lv ? '' : `<em>Unlocks at Lv ${lv}</em>`);
  const el = h(`<div class="modal sheet-modal"><div class="panel sheet" style="--el:${ELEMENTS[line.element[0]].color}">
    <button class="close">✕</button>
    <div class="sheet-left"><div class="viewer"></div><p class="drag-hint">Drag to rotate</p></div>
    <div class="sheet-right">
      <div class="sheet-title"><span class="cno">#${String(entry.no).padStart(3, '0')}</span><h2>${formName}</h2>
        <span class="tag">${ELEMENTS[line.element[0]].name}</span><span class="tag">${st.role}</span>${c ? `<span class="tag lv">Lv ${c.level}</span>` : '<span class="tag">not owned</span>'}</div>
      <p class="chain">${chain}</p>
      <p class="desc">${entry.desc}</p>
      ${c ? `<div class="xp"><i style="width:${(c.xp / PACING.xpToNext(c.level)) * 100}%"></i></div><p class="small">${c.xp}/${PACING.xpToNext(c.level)} XP to Lv ${c.level + 1}</p>` : ''}
      <h3>Stats ${c ? `at Lv ${c.level}` : `at Lv ${PACING.maxLevel}`}</h3>
      <div class="stat-grid">${statRow('hp', 'HP', st.hp)}${statRow('atk', 'Attack', st.atk)}${statRow('aspd', 'Attack speed', st.aspd, (x) => x.toFixed(2))}
        ${statRow('range', 'Range', st.range)}${statRow('armor', 'Armor', st.armor)}${statRow('move', 'Move speed', st.move, (x) => x.toFixed(2))}</div>
      <h3>Cards <small>played from your shared energy in battle</small></h3>
      <div class="bigcards">${bigCard(skill, 1)}${bigCard(ult, u.special)}</div>
      <h3>Automatic ability ${c ? '<small>pick the one it uses on its own</small>' : ''}</h3>
      <div class="ab-list">${known.map((a) => `<label class="ab ${a.known || !c ? '' : 'locked'} ${eq.includes(a.id) ? 'on' : ''}">
          ${c && a.known ? `<input type="radio" name="auto" data-id="${a.id}" ${eq.includes(a.id) ? 'checked' : ''}>` : ''}
          <b>${ABILITY_NAMES[a.id]}</b>${a.id === ELEMENT_MOVE[line.element[0]] ? ' <small>element move</small>' : ''}
          <span>${ABILITY_DESC[a.id] || ''}</span>${a.known || !c ? '' : `<em>Unlocks at Lv ${a.at}</em>`}</label>`).join('')}
        <div class="ab fixed ${lockedAt(u.passive) ? 'locked' : ''}"><b>Passive: ${ABILITY_NAMES[passive]}</b><span>${ABILITY_DESC[passive] || ''}</span>${lockedAt(u.passive)}</div>
      </div>
      ${c ? `<p class="small next">${upcoming ? `Next unlock: <b>${upcoming[0]}</b> at Lv ${upcoming[1]}. ` : ''}${nx ? `Evolves at Lv ${nx.level}${nx.paths ? ' (choose a path)' : ` into ${nx.name}`}.` : 'Final form.'}</p>` : ''}
    </div></div></div>`);
  app.overlay.appendChild(el);
  const dispose = mountViewer(el.querySelector('.viewer'), app.assets, formName, entry.line);
  const close = () => { dispose(); el.remove(); if (onClose) onClose(); };
  el.querySelector('.close').onclick = close;
  el.addEventListener('click', (ev) => { if (ev.target === el) close(); });
  el.querySelectorAll('input[type=radio]').forEach((cb) => cb.onchange = () => {
    P.setEquipped(s, c.uid, [cb.dataset.id]); app.persist();
    el.querySelectorAll('label.ab').forEach((lb) => lb.classList.toggle('on', !!lb.querySelector('input:checked')));
  });
}

// ---------------- boon choice (between gym fights) ----------------
export function boonScreen(app, { title, offers, owned, reports, onPick }) {
  const el = h(`<div class="screen boons"><div class="panel">
    <h2>${title}</h2><p>Choose a boon for the rest of this run.</p>
    <div class="boon-cards">${offers.map((b) => `<div class="boon" data-id="${b.id}" style="--el:${b.element ? ELEMENTS[b.element].color : '#c6a0ff'}">
      <div class="bicon">✦</div><h3>${b.name}</h3><p>${b.desc}</p></div>`).join('')}</div>
    ${owned.length ? `<p class="small">Boons this run: ${owned.join(', ')}</p>` : ''}
    <p class="small">${reports.map((r) => `${r.formName} +${r.gained} XP${r.to > r.from ? ` (Lv ${r.to}!)` : ''}`).join(' · ')}</p>
  </div></div>`);
  el.querySelectorAll('.boon').forEach((b) => b.onclick = () => onPick(b.dataset.id));
  app.setScreen(el);
}
