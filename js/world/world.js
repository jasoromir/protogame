// The semi-open world: walk around, meet wild creatures (battle + capture), enter gyms.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { placeholder } from '../render/units.js';
import { LOOKS, LINES, ELEMENTS, currentForm } from '../data/creatures.js';
import { GYMS } from '../data/gyms.js';
import * as P from '../game/progress.js';
import * as T from './terrain.js';

const MODEL_SCALE = { Cindrake: 1.0, Ignarion: 0.95, Brinehorn: 0.72 };
const WALK = 6, RUN = 10;
const ENCOUNTER_DIST = 1.8;
const WILD_PER_BIOME = 5;

function rng(seed) { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

/** A creature figure for the world, with Idle/Walk clips if it has a real model. */
function creatureFigure(assets, formName, line) {
  const look = LOOKS[formName];
  const model = look && assets.models[look.model];
  const g = new THREE.Group();
  if (model) {
    const obj = SkeletonUtils.clone(model.scene);
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; if (look.tint) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(look.tint)); } } });
    obj.scale.setScalar((MODEL_SCALE[look.model] || 1) * (look.scale || 1));
    g.add(obj);
    if (model.animations.length) {
      const mixer = new THREE.AnimationMixer(obj);
      const clip = (n) => model.animations.find((c) => c.name.endsWith(`_${n}`));
      const idle = clip('Idle') && mixer.clipAction(clip('Idle'));
      const walk = clip('Walk') && mixer.clipAction(clip('Walk'));
      if (idle) idle.play();
      return { g, mixer, idle, walk };
    }
    return { g };
  }
  const idx = Math.max(0, LINES[line].forms.findIndex((f) => f.name === formName));
  g.add(placeholder(line, idx).group);
  return { g };
}

function trainerFigure() {
  const g = new THREE.Group();
  const m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, flatShading: true });
  const add = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  const legs = [-0.12, 0.12].map((x) => add(new THREE.BoxGeometry(0.16, 0.62, 0.18), m(0x2b3550), x, 0.31, 0));
  add(new THREE.CapsuleGeometry(0.24, 0.42, 4, 10), m(0x2f7ad8), 0, 0.98, 0);            // jacket
  add(new THREE.BoxGeometry(0.34, 0.4, 0.16), m(0xd9a441), 0, 1.02, -0.24);              // backpack
  const arms = [-0.33, 0.33].map((x) => add(new THREE.CapsuleGeometry(0.07, 0.42, 3, 6), m(0x2f7ad8), x, 0.98, 0));
  add(new THREE.SphereGeometry(0.2, 14, 12), m(0xf2c9a0), 0, 1.5, 0.02);                  // head
  add(new THREE.SphereGeometry(0.21, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(0xd8392b), 0, 1.56, 0); // cap
  add(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 16, 1, false, -Math.PI / 2, Math.PI), m(0xd8392b), 0, 1.57, 0.12);
  for (const x of [-0.07, 0.07]) add(new THREE.SphereGeometry(0.025, 6, 6), m(0x1a1a22), x, 1.52, 0.19);
  return { g, legs, arms };
}

export class WorldScene {
  constructor(app) {
    this.app = app;
    this.stage = app.stage;
    this.scene = this.stage.scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.labels = [];
    this.wilds = [];
    this.keys = new Set();
    this.time = 0;
    this.busy = false;
    const s = app.save;
    const pos = s.world || { x: T.START_POS[0], z: T.START_POS[1] };
    this._terrain();
    this._water();
    this._props();
    this._gyms();
    this._player(pos);
    for (const id of Object.keys(T.BIOMES)) for (let i = 0; i < WILD_PER_BIOME; i++) this._spawnWild(id);
    this._hud();
    this._handlers = {
      keydown: (e) => this._keydown(e), keyup: (e) => this.keys.delete(e.key.toLowerCase()),
      down: (e) => this._click(e),
    };
    this.resume();
  }

  // ---------------- building the world ----------------
  _terrain() {
    const N = 150, S = T.WORLD_SIZE;
    const geo = new THREE.PlaneGeometry(S, S, N, N);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = T.heightAt(x, z);
      pos.setY(i, h);
      const b = T.biomeAt(x, z);
      c.setRGB(...T.BIOMES[b].color);
      const n = T.fbm(x * 0.2, z * 0.2) - 0.5;
      c.offsetHSL(0, 0, n * 0.08);
      if (T.isShore(x, z, h)) c.setRGB(0.82, 0.76, 0.56);                     // sandy shore
      if (b === 'volcano' && h > 9) c.setRGB(0.22, 0.17, 0.16);                    // ashen peak
      if (h > 10 && b !== 'volcano') c.setRGB(0.92, 0.94, 0.97);                   // snow caps
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    this.ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
    this.ground.receiveShadow = true;
    this.group.add(this.ground);
  }
  _water() {
    const l = T.BIOMES.lake.center;
    this.water = new THREE.Mesh(new THREE.CircleGeometry(24, 48), new THREE.MeshStandardMaterial({
      color: 0x3a9ae0, emissive: 0x0a3050, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }));
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(l[0], T.LAKE_LEVEL, l[1]);
    this.group.add(this.water);
    const v = T.BIOMES.volcano.center;
    this.lava = new THREE.Mesh(new THREE.CircleGeometry(5.5, 24), new THREE.MeshStandardMaterial({ color: 0xff5a10, emissive: 0xff4000, emissiveIntensity: 2 }));
    this.lava.rotation.x = -Math.PI / 2;
    this.lava.position.set(v[0], T.heightAt(v[0], v[1]) + 0.4, v[1]);
    this.group.add(this.lava);
    this.lavaLight = new THREE.PointLight(0xff6a20, 40, 30);
    this.lavaLight.position.copy(this.lava.position).add(new THREE.Vector3(0, 3, 0));
    this.group.add(this.lavaLight);
  }
  _props() {
    const r = rng(1234), S = T.WORLD_SIZE / 2 - 8;
    const spots = { tree: [], pine: [], rock: [], flower: [] };
    const nearSite = (x, z) => T.GYM_SITES.some((g) => Math.hypot(x - g.pos[0], z - g.pos[1]) < 7) || Math.hypot(x - T.START_POS[0], z - T.START_POS[1]) < 6;
    for (let i = 0; i < 2600; i++) {
      const x = (r() * 2 - 1) * S, z = (r() * 2 - 1) * S;
      if (T.isWater(x, z) || nearSite(x, z)) continue;
      const b = T.biomeAt(x, z), h = T.heightAt(x, z);
      const p = r();
      if (b === 'forest' && p < 0.55) spots.tree.push([x, h, z]);
      else if (b === 'meadow' && p < 0.06) spots.tree.push([x, h, z]);
      else if (b === 'meadow' && p < 0.4) spots.flower.push([x, h, z]);
      else if (b === 'snow' && p < 0.3) spots.pine.push([x, h, z]);
      else if (b === 'lake' && p < 0.08) spots.tree.push([x, h, z]);
      else if (b === 'volcano' && p < 0.18 && h < 9) spots.rock.push([x, h, z]);
      else if (p < 0.03) spots.rock.push([x, h, z]);
    }
    const inst = (geo, mat, list, scaleFn, yOff = 0) => {
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      const d = new THREE.Object3D();
      list.forEach(([x, y, z], i) => {
        const s = scaleFn(i);
        d.position.set(x, y + yOff * s, z); d.rotation.set(0, i * 2.4, 0); d.scale.setScalar(s); d.updateMatrix();
        m.setMatrixAt(i, d.matrix);
      });
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    const flat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true });
    const sz = (i) => 0.8 + ((i * 7919) % 100) / 100 * 0.7;
    inst(new THREE.CylinderGeometry(0.18, 0.25, 1.4, 6), flat(0x6a4a2a), spots.tree, sz, 0.7);
    inst(new THREE.IcosahedronGeometry(1.4, 0), flat(0x3f8a34), spots.tree, sz, 2.3);
    inst(new THREE.CylinderGeometry(0.15, 0.2, 1, 6), flat(0x5a3c22), spots.pine, sz, 0.5);
    inst(new THREE.ConeGeometry(1.1, 3, 7), flat(0xdfeaf2), spots.pine, sz, 2.2);
    inst(new THREE.DodecahedronGeometry(0.8, 0), flat(0x7a726a), spots.rock, sz, 0.3);
    const fl = inst(new THREE.ConeGeometry(0.12, 0.35, 5), flat(0xffffff), spots.flower, () => 1, 0.15);
    const fc = [0xff7aa0, 0xffe04a, 0xffffff, 0xb08aff].map((h) => new THREE.Color(h));
    spots.flower.forEach((_, i) => fl.setColorAt(i, fc[i % fc.length]));
  }
  _gyms() {
    this.gymObjs = T.GYM_SITES.map((site, i) => {
      const gym = GYMS[i];
      const [x, z] = site.pos, y = T.heightAt(x, z);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const stone = new THREE.MeshStandardMaterial({ color: 0xb8ad9c, roughness: 0.9, flatShading: true });
      const col = new THREE.Color(ELEMENTS[gym.element].color);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.8, 0.8, 6), stone);
      base.position.y = 0.4; base.receiveShadow = true; base.castShadow = true; g.add(base);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 3.4, 8), stone);
        pil.position.set(Math.cos(a) * 3.2, 2.5, Math.sin(a) * 3.2); pil.castShadow = true; g.add(pil);
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 2.2, 6), new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.7), roughness: 0.6, flatShading: true }));
      roof.position.y = 5.3; roof.castShadow = true; g.add(roof);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6, flatShading: true }));
      crystal.position.y = 7.4; g.add(crystal);
      this.group.add(g);
      const label = this._label(`${gym.name}`, 'gym');
      return { site, gym, g, crystal, label, i };
    });
  }
  _player(pos) {
    const t = trainerFigure();
    this.player = { ...t, x: pos.x, z: pos.z, yaw: 0, speed: 0, walkT: 0, target: null };
    this.group.add(t.g);
    this._buildPartner();
  }
  _buildPartner() {
    if (this.partner) this.group.remove(this.partner.g);
    const c = P.teamCreatures(this.app.save)[0];
    if (!c) { this.partner = null; return; }
    const f = creatureFigure(this.app.assets, currentForm(c).name, c.line);
    this.partner = { ...f, x: this.player.x - 1.5, z: this.player.z + 1.5, yaw: 0, uid: c.uid };
    this.group.add(f.g);
  }
  _spawnWild(biomeId) {
    const b = T.BIOMES[biomeId], r = Math.random;
    let x, z, tries = 0;
    do {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * b.radius * 0.85;
      x = b.center[0] + Math.cos(a) * d; z = b.center[1] + Math.sin(a) * d;
      tries++;
    } while ((T.isWater(x, z) || T.biomeAt(x, z) !== biomeId || Math.hypot(x - this.player.x, z - this.player.z) < 12) && tries < 40);
    const line = b.creatures[Math.floor(r() * b.creatures.length)];
    const level = b.level[0] + Math.floor(r() * (b.level[1] - b.level[0] + 1));
    const members = [{ line, level }];
    if (r() < 0.35) members.push({ line: b.creatures[Math.floor(r() * b.creatures.length)], level: Math.max(b.level[0], level - 1) });
    const form = currentForm({ line, level, path: r() < 0.5 ? 'A' : 'B' }).name;
    const f = creatureFigure(this.app.assets, form, line);
    f.g.scale.multiplyScalar(1.15);
    this.group.add(f.g);
    const w = { ...f, biome: biomeId, members, x, z, home: [x, z], dest: null, wait: r() * 3, yaw: r() * 6,
      label: this._label(`${line}${members.length > 1 ? ` +${members.length - 1}` : ''} <small>Lv ${level}</small>`, 'wild'), alert: 0 };
    this.wilds.push(w);
    return w;
  }
  _label(html, cls) {
    const el = document.createElement('div');
    el.className = `wlabel ${cls}`;
    el.innerHTML = html;
    this.app.overlay.appendChild(el);
    this.labels.push(el);
    return el;
  }

  // ---------------- HUD ----------------
  _hud() {
    const el = document.createElement('div');
    el.className = 'whud';
    el.innerHTML = `
      <div class="zone"><b></b><small></small></div>
      <canvas class="minimap" width="180" height="180"></canvas>
      <div class="wbtns">
        <button data-a="team" title="Team, collection and trainer cards (T)">Team <small>T</small></button>
        <button data-a="codex" title="Creature Codex (C)">Codex <small>C</small></button>
        <button data-a="versus" class="vs" title="Battle a friend online (V)">Versus <small>V</small></button>
        <button data-a="howto">How to play</button>
        <button data-a="title">Title</button>
      </div>
      <div class="wteam"></div>
      <div class="prompt"></div>
      <div class="toast"></div>
      <div class="controls-hint">WASD / arrows or click to move · Shift to run · walk into wild creatures to battle · E at a gym</div>`;
    this.app.overlay.appendChild(el);
    this.hudEl = el;
    el.querySelector('[data-a="team"]').onclick = () => this.app.openTeam();
    el.querySelector('[data-a="codex"]').onclick = () => this.app.openCodex();
    el.querySelector('[data-a="versus"]').onclick = () => this.app.openVersus();
    el.querySelector('[data-a="howto"]').onclick = () => this.app.openHowTo();
    el.querySelector('[data-a="title"]').onclick = () => this.app.toTitle();
    this.mini = el.querySelector('.minimap').getContext('2d');
    this.miniBg = document.createElement('canvas');
    this.miniBg.width = this.miniBg.height = 180;
    const g = this.miniBg.getContext('2d');
    for (let py = 0; py < 180; py += 3) for (let px = 0; px < 180; px += 3) {
      const x = (px / 180 - 0.5) * T.WORLD_SIZE, z = (py / 180 - 0.5) * T.WORLD_SIZE;
      const [r, gg, b] = T.isWater(x, z) ? [0.25, 0.55, 0.85] : T.BIOMES[T.biomeAt(x, z)].color;
      g.fillStyle = `rgb(${r * 255 | 0},${gg * 255 | 0},${b * 255 | 0})`;
      g.fillRect(px, py, 3, 3);
    }
    this.refreshTeam();
  }
  refreshTeam() {
    const s = this.app.save;
    const team = P.teamCreatures(s);
    this.hudEl.querySelector('.wteam').innerHTML = `<div class="wt-head">Team ${team.length}/${s.teamSize}</div>` + team.map((c) =>
      `<div class="wt" style="--el:${ELEMENTS[LINES[c.line].element[0]].color}"><img src="${this.app.portraits.portrait(currentForm(c).name, c.line)}" alt=""><span>${currentForm(c).name}<small>Lv ${c.level}</small></span></div>`).join('');
    if (!this.partner || this.partner.uid !== (team[0] && team[0].uid)) this._buildPartner();
  }
  toast(text) {
    const t = this.hudEl.querySelector('.toast');
    t.innerHTML = text;
    t.classList.add('on');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove('on'), 3200);
  }

  // ---------------- input ----------------
  _keydown(e) {
    if (this.busy) return;
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if (k === 'e' && this.nearGym) this._enterGym(this.nearGym);
    if (k === 't') this.app.openTeam();
    if (k === 'c') this.app.openCodex();
    if (k === 'v') this.app.openVersus();
  }
  _click(e) {
    if (this.busy || e.button !== 0) return;
    const r = this.stage.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.stage.raycaster.setFromCamera(v, this.stage.camera);
    const hit = this.stage.raycaster.intersectObject(this.ground)[0];
    if (hit) this.player.target = [hit.point.x, hit.point.z];
  }

  // ---------------- encounters ----------------
  _enterGym(go) {
    const s = this.app.save;
    if (!P.isUnlocked(s, go.i, GYMS)) { this.toast(`🔒 ${go.gym.name} is sealed. Beat <b>${GYMS[go.i - 1].name}</b> first.`); return; }
    this.app.prepareBattle(go.gym);
  }
  _encounter(w) {
    this.busy = true;
    w.alert = 1;
    this.player.target = null;
    this.toast(`A wild <b>${w.members.map((m) => m.line).join(' and ')}</b> appeared!`);
    setTimeout(() => {
      this.pendingWild = w;
      const b = T.BIOMES[w.biome];
      this.app.startBattle({ wild: true, id: 'wild', name: `Wild ${w.members[0].line}`, leader: 'Wild creature', element: LINES[w.members[0].line].element[0],
        creatures: w.members, map: b.map, intro: '' });
    }, 650);
  }
  /** Called when returning from a battle. */
  afterBattle(won) {
    const w = this.pendingWild;
    this.pendingWild = null;
    if (w && won) {
      this.group.remove(w.g);
      w.label.remove();
      this.wilds = this.wilds.filter((x) => x !== w);
      setTimeout(() => this._spawnWild(w.biome), 30000);
    } else if (w) {
      w.x = w.home[0] + 6; w.z = w.home[1] + 6;   // it runs off
    }
    this.refreshTeam();
  }

  // ---------------- lifecycle ----------------
  suspend() {
    this.active = false;
    this.group.visible = false;
    this.hudEl.style.display = 'none';
    for (const l of this.labels) l.style.display = 'none';
    window.removeEventListener('keydown', this._handlers.keydown);
    window.removeEventListener('keyup', this._handlers.keyup);
    this.stage.canvas.removeEventListener('pointerdown', this._handlers.down);
    this.stage.boardGroup.visible = true;
    this.stage.camera.fov = 36; this.stage.camera.updateProjectionMatrix();
    this.stage.sun.position.set(-4, 9, 5); this.stage.sun.target.position.set(0, 0, 0);
    this.scene.fog = null;
    this._lighting(false);
    if (this.stage.onFrame === this._frameFn) this.stage.onFrame = null;
  }
  resume() {
    this.active = true;
    this.busy = false;
    this.keys.clear();
    this.group.visible = true;
    this.hudEl.style.display = '';
    this.stage.boardGroup.visible = false;
    this.stage.cameraMode = 'world';
    this.stage.camera.fov = 45; this.stage.camera.updateProjectionMatrix();
    this.scene.background = new THREE.Color(0xa8d8ff);
    this.scene.fog = new THREE.Fog(0xa8d8ff, 55, 120);
    if (!this.stage.sun.target.parent) this.scene.add(this.stage.sun.target);
    this._lighting(true);
    window.addEventListener('keydown', this._handlers.keydown);
    window.addEventListener('keyup', this._handlers.keyup);
    this.stage.canvas.addEventListener('pointerdown', this._handlers.down);
    this._frameFn = (dt) => this._frame(dt);
    this.stage.onFrame = this._frameFn;
    this.refreshTeam();
  }
  /** Open terrain needs softer light than the battle board (otherwise it washes out). */
  _lighting(world) {
    const st = this.stage;
    st.sun.intensity = world ? 1.7 : 2.4;
    st.hemi.intensity = world ? 0.75 : 1.1;
    st.hemi.groundColor.setHex(world ? 0x4a5a3a : 0x5a4a3a);
    st.renderer.toneMappingExposure = world ? 0.9 : 1.05;
    st.bloom.strength = world ? 0.25 : 0.55;
  }
  dispose() {
    this.suspend();
    this.scene.remove(this.group);
    this.hudEl.remove();
    for (const l of this.labels) l.remove();
  }

  // ---------------- frame ----------------
  _frame(dt) {
    this.time += dt;
    const p = this.player;
    // movement: keys first, then click target
    let mx = 0, mz = 0;
    const k = this.keys;
    if (!this.busy) {
      if (k.has('w') || k.has('arrowup')) mz -= 1;
      if (k.has('s') || k.has('arrowdown')) mz += 1;
      if (k.has('a') || k.has('arrowleft')) mx -= 1;
      if (k.has('d') || k.has('arrowright')) mx += 1;
      if (mx || mz) p.target = null;
      else if (p.target) {
        const dx = p.target[0] - p.x, dz = p.target[1] - p.z, d = Math.hypot(dx, dz);
        if (d < 0.3) p.target = null; else { mx = dx / d; mz = dz / d; }
      }
    }
    const len = Math.hypot(mx, mz);
    const speed = (k.has('shift') ? RUN : WALK) * (len ? 1 : 0);
    if (len) {
      const nx = p.x + (mx / len) * speed * dt, nz = p.z + (mz / len) * speed * dt;
      const lim = T.WORLD_SIZE / 2 - 10;
      if (!T.isWater(nx, nz) && Math.abs(nx) < lim && Math.abs(nz) < lim && T.heightAt(nx, nz) - T.heightAt(p.x, p.z) < 0.9) { p.x = nx; p.z = nz; }
      else p.target = null;
      p.yaw = Math.atan2(mx, mz);
    }
    p.walkT += dt * speed * 1.6;
    const y = T.heightAt(p.x, p.z);
    p.g.position.set(p.x, y, p.z);
    let dyaw = p.yaw - p.g.rotation.y; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    p.g.rotation.y += dyaw * Math.min(1, dt * 12);
    const swing = len ? Math.sin(p.walkT) * 0.6 : 0;
    p.legs[0].rotation.x = swing; p.legs[1].rotation.x = -swing;
    p.arms[0].rotation.x = -swing * 0.8; p.arms[1].rotation.x = swing * 0.8;
    p.g.position.y += len ? Math.abs(Math.sin(p.walkT)) * 0.06 : 0;
    // partner follows a couple of meters behind
    const pt = this.partner;
    if (pt) {
      const bx = p.x - Math.sin(p.g.rotation.y) * 1.6 + Math.cos(p.g.rotation.y) * 0.9;
      const bz = p.z - Math.cos(p.g.rotation.y) * 1.6 - Math.sin(p.g.rotation.y) * 0.9;
      const dx = bx - pt.x, dz = bz - pt.z, d = Math.hypot(dx, dz);
      const moving = d > 0.25;
      if (moving) { const sp = Math.min(d * 3, RUN * 1.1); pt.x += (dx / d) * sp * dt; pt.z += (dz / d) * sp * dt; pt.yaw = Math.atan2(dx, dz); }
      pt.g.position.set(pt.x, T.heightAt(pt.x, pt.z), pt.z);
      let dy = pt.yaw - pt.g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      pt.g.rotation.y += dy * Math.min(1, dt * 8);
      this._anim(pt, moving, dt);
    }
    // wild creatures wander around home
    for (const w of this.wilds) {
      w.wait -= dt;
      if (!w.dest && w.wait <= 0) {
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 6;
        const tx = w.home[0] + Math.cos(a) * r, tz = w.home[1] + Math.sin(a) * r;
        if (!T.isWater(tx, tz)) w.dest = [tx, tz];
        w.wait = 2 + Math.random() * 4;
      }
      let moving = false;
      if (w.dest) {
        const dx = w.dest[0] - w.x, dz = w.dest[1] - w.z, d = Math.hypot(dx, dz);
        if (d < 0.2) w.dest = null;
        else { w.x += (dx / d) * 1.4 * dt; w.z += (dz / d) * 1.4 * dt; w.yaw = Math.atan2(dx, dz); moving = true; }
      }
      const dp = Math.hypot(w.x - p.x, w.z - p.z);
      if (dp < 7) w.yaw = Math.atan2(p.x - w.x, p.z - w.z);   // watches you
      w.g.position.set(w.x, T.heightAt(w.x, w.z), w.z);
      let dy = w.yaw - w.g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      w.g.rotation.y += dy * Math.min(1, dt * 5);
      if (!w.mixer) w.g.position.y += Math.abs(Math.sin(this.time * 3 + w.home[0])) * (moving ? 0.12 : 0.04);
      this._anim(w, moving, dt);
      if (!this.busy && dp < ENCOUNTER_DIST) this._encounter(w);
      this._place(w.label, w.g.position, 1.6, dp < 30);
      w.label.classList.toggle('alert', !!w.alert);
    }
    // gyms
    this.nearGym = null;
    for (const go of this.gymObjs) {
      go.crystal.rotation.y += dt;
      go.crystal.position.y = 7.4 + Math.sin(this.time * 2 + go.i) * 0.25;
      const d = Math.hypot(go.site.pos[0] - p.x, go.site.pos[1] - p.z);
      const beaten = this.app.save.gymsBeaten.includes(go.gym.id), open = P.isUnlocked(this.app.save, go.i, GYMS);
      go.label.innerHTML = `${beaten ? '✓ ' : open ? '' : '🔒 '}${go.gym.name} <small>Lv ${go.gym.level}</small>`;
      this._place(go.label, go.g.position, 9, d < 70);
      if (d < 6.5) this.nearGym = go;
    }
    const prompt = this.hudEl.querySelector('.prompt');
    if (this.nearGym && !this.busy) {
      const go = this.nearGym, open = P.isUnlocked(this.app.save, go.i, GYMS);
      prompt.innerHTML = open ? `<b>E</b> Enter ${go.gym.name} · Leader ${go.gym.leader} · Lv ${go.gym.level} · 3 fights` : `🔒 Beat ${GYMS[go.i - 1].name} first`;
      prompt.classList.add('on');
    } else prompt.classList.remove('on');
    // zone
    const b = T.BIOMES[T.biomeAt(p.x, p.z)];
    const zone = this.hudEl.querySelector('.zone');
    if (zone.dataset.z !== b.name) { zone.dataset.z = b.name; zone.querySelector('b').textContent = b.name; zone.querySelector('small').textContent = `Wild creatures Lv ${b.level[0]}–${b.level[1]}`; }
    // camera follows (TFT-ish high angle, a bit more tilted)
    const cam = this.stage.camera, target = new THREE.Vector3(p.x, y + 1, p.z);
    const want = new THREE.Vector3(p.x, y + 13, p.z + 13);
    cam.position.lerp(want, Math.min(1, dt * 4));
    cam.lookAt(target);
    this.stage.sun.position.set(p.x - 20, y + 40, p.z + 20);
    this.stage.sun.target.position.set(p.x, y, p.z);
    Object.assign(this.stage.sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 120 });
    this.stage.sun.shadow.camera.updateProjectionMatrix();
    this.water.material.emissiveIntensity = 0.8 + Math.sin(this.time) * 0.2;
    this.lava.material.emissiveIntensity = 1.8 + Math.sin(this.time * 3) * 0.4;
    this._minimap();
    this.saveT = (this.saveT || 0) + dt;
    if (this.saveT > 2) { this.saveT = 0; this.app.save.world = { x: p.x, z: p.z }; this.app.persist(); }
  }
  _anim(o, moving, dt) {
    if (!o.mixer) return;
    o.mixer.update(dt);
    if (o.walk && o.idle) {
      const want = moving ? o.walk : o.idle, other = moving ? o.idle : o.walk;
      if (!want.isRunning()) { want.reset().play(); want.crossFadeFrom(other, 0.2, false); }
    }
  }
  _place(el, pos, h, visible) {
    const sp = this.stage.project(pos.clone().add(new THREE.Vector3(0, h, 0)));
    el.style.display = visible && sp.visible && this.active ? '' : 'none';
    el.style.transform = `translate(${sp.x - el.offsetWidth / 2}px, ${sp.y}px)`;
  }
  _minimap() {
    const g = this.mini, s = 180 / T.WORLD_SIZE, toPx = (x, z) => [(x + T.WORLD_SIZE / 2) * s, (z + T.WORLD_SIZE / 2) * s];
    g.drawImage(this.miniBg, 0, 0);
    for (const go of this.gymObjs) {
      const [x, y] = toPx(...go.site.pos);
      g.fillStyle = ELEMENTS[go.gym.element].color; g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.fillStyle = '#ff5a4a';
    for (const w of this.wilds) { const [x, y] = toPx(w.x, w.z); g.fillRect(x - 1, y - 1, 2, 2); }
    const [px, py] = toPx(this.player.x, this.player.z);
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.beginPath(); g.arc(px, py, 4, 0, Math.PI * 2); g.fill(); g.stroke();
  }
}
