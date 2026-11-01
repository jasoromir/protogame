// Creature visuals: animated GLB models where we have them, stylized placeholder figures otherwise.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { tileXZ } from './stage.js';
import { ELEMENT_COLOR } from './fx.js';
import { ELEMENTS, LINES } from '../data/creatures.js';

const MODELS = ['Cindrake', 'Ignarion', 'Brinehorn'];
export const STATUS_ICONS = [['soak', '💧'], ['chill', '❄️'], ['freeze', '🧊'], ['shock', '⚡'], ['burn', '🔥'], ['crack', '🪨'],
  ['stun', '💫'], ['root', '🌿'], ['brittle', '💔'], ['steamed', '♨️']];
const MODEL_SCALE = { Cindrake: 1.0, Ignarion: 0.95, Brinehorn: 0.72 };
const CLOSED_EYES = { Cindrake: 'assets/models/Cindrake_Color_closed.png' };

export async function loadAssets() {
  const loader = new GLTFLoader();
  const tl = new THREE.TextureLoader();
  const assets = { models: {}, closedEyes: {} };
  await Promise.all(MODELS.map(async (name) => {
    for (let attempt = 0; attempt < 3 && !assets.models[name]; attempt++) {
      try { assets.models[name] = await loader.loadAsync(`assets/models/${name}.glb`); }
      catch (e) { console.warn(`model ${name} failed (attempt ${attempt + 1})`, e); }
    }
  }));
  for (const [name, url] of Object.entries(CLOSED_EYES)) {
    const t = await tl.loadAsync(url).catch(() => null);
    if (t) { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; assets.closedEyes[name] = t; }
  }
  return assets;
}

const BODY = {  // placeholder silhouettes
  Ashlet: 'bird', Flurrette: 'bird', Zippit: 'bird', Lotl: 'blob', Mossfawn: 'beast', Hrimfang: 'beast',
  Raijura: 'beast', Terragon: 'beast', Cindrake: 'beast', Brinehorn: 'beast',
};

export function placeholder(line, formIndex) {
  const el = LINES[line].element[0];
  const color = new THREE.Color(ELEMENTS[el].color);
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, flatShading: true });
  const belly = new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.45), roughness: 0.6, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b22, roughness: 0.4 });
  const kind = BODY[line] || 'beast';
  const add = (geo, m, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = true; g.add(o); return o; };
  if (kind === 'beast') {
    add(new THREE.CapsuleGeometry(0.17, 0.26, 4, 10), mat, 0, 0.28, 0, 1, 1, 1).rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(0.14, 12, 10), belly, 0, 0.26, 0.05, 1.1, 0.9, 1.4);
    add(new THREE.SphereGeometry(0.15, 14, 12), mat, 0, 0.42, 0.25);
    for (const [x, z] of [[-0.1, 0.14], [0.1, 0.14], [-0.1, -0.14], [0.1, -0.14]]) add(new THREE.CylinderGeometry(0.045, 0.05, 0.18, 6), mat, x, 0.09, z);
    add(new THREE.ConeGeometry(0.05, 0.3, 6), mat, 0, 0.3, -0.33).rotation.x = -Math.PI / 2.4;
    for (const x of [-0.07, 0.07]) add(new THREE.ConeGeometry(0.03, 0.12, 5), belly, x, 0.56, 0.22);
  } else if (kind === 'bird') {
    add(new THREE.SphereGeometry(0.2, 14, 12), mat, 0, 0.32, 0, 1, 1.1, 1);
    add(new THREE.SphereGeometry(0.13, 12, 10), belly, 0, 0.3, 0.1, 1, 1.1, 0.8);
    add(new THREE.ConeGeometry(0.04, 0.12, 5), new THREE.MeshStandardMaterial({ color: 0xffb030 }), 0, 0.4, 0.22).rotation.x = Math.PI / 2;
    for (const x of [-1, 1]) add(new THREE.BoxGeometry(0.28, 0.03, 0.16), mat, x * 0.24, 0.36, -0.02).rotation.z = x * 0.4;
    add(new THREE.ConeGeometry(0.06, 0.2, 5), belly, 0, 0.58, 0);
  } else {
    add(new THREE.SphereGeometry(0.24, 16, 12), mat, 0, 0.24, 0, 1.1, 0.85, 1.2);
    add(new THREE.SphereGeometry(0.16, 12, 10), belly, 0, 0.2, 0.1, 1.2, 0.8, 1);
    for (const x of [-1, 1]) for (let i = 0; i < 3; i++) add(new THREE.ConeGeometry(0.03, 0.14, 5), belly, x * 0.25, 0.3 + i * 0.05, 0.05 - i * 0.05).rotation.z = x * 1.2;
  }
  const eyeY = kind === 'beast' ? 0.45 : kind === 'bird' ? 0.42 : 0.3;
  const eyeZ = kind === 'beast' ? 0.38 : kind === 'bird' ? 0.18 : 0.24;
  const eyes = [-1, 1].map((x) => add(new THREE.SphereGeometry(0.032, 8, 8), dark, x * 0.065, eyeY, eyeZ));
  g.scale.setScalar(1 + formIndex * 0.2);
  return { group: g, eyes, flashMats: [mat, belly] };
}

export class UnitView {
  constructor(ctx, unit) {
    this.ctx = ctx;
    this.unit = unit;
    const { stage, assets } = ctx;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    stage.scene.add(this.root);
    const look = unit.def.look;
    const model = look && assets.models[look.model];
    this.flashMats = [];
    if (model) {
      const obj = SkeletonUtils.clone(model.scene);
      obj.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.material = o.material.clone();
          if (look.tint) o.material.color.multiply(new THREE.Color(look.tint));
          o.material.transparent = true;
          this.flashMats.push(o.material);
          this.mainMat = this.mainMat || o.material;
        }
      });
      obj.scale.setScalar((MODEL_SCALE[look.model] || 1) * (look.scale || 1));
      this.body.add(obj);
      this.model = obj;
      this.openMap = this.mainMat && this.mainMat.map;
      this.closedMap = assets.closedEyes[look.model] || null;
      if (model.animations.length) {
        this.mixer = new THREE.AnimationMixer(obj);
        this.clips = {};
        for (const c of model.animations) this.clips[c.name.split('_').pop()] = c;
        this.mixer.addEventListener('finished', () => { if (!this.dead) this.play(this.moving ? 'Walk' : 'Idle'); });
      }
      const box = new THREE.Box3().setFromObject(obj);
      this.height = box.max.y - box.min.y;
    } else {
      const ph = placeholder(unit.line, Math.max(0, LINES[unit.line].forms.findIndex((f) => f.name === unit.name)));
      this.body.add(ph.group);
      this.flashMats = ph.flashMats;
      this.eyes = ph.eyes;
      this.height = 0.65 * ph.group.scale.y;
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.37, 32),
      new THREE.MeshBasicMaterial({ color: unit.team === 0 ? 0x4ab0ff : 0xff5040, transparent: true, opacity: 0.85 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.root.add(ring);
    this.ring = ring;
    this.yaw = unit.team === 0 ? Math.PI : 0;   // models face +Z; team 0 faces the enemy at -Z
    this.root.rotation.y = this.yaw;
    this.place(unit.pos);
    this.lunge = 0; this.flash = 0; this.hop = 0; this.shake = 0;
    this.blinkAt = 1 + Math.random() * 3;
    this.statusFx = {};
    this.bar = this._makeBar();
    this.play('Idle');
  }

  _makeBar() {
    const el = document.createElement('div');
    el.className = `unitbar team${this.unit.team}`;
    el.innerHTML = `<div class="ub-icons"></div><div class="ub-name">${this.unit.name} <span>Lv${this.unit.def.level}</span></div>
      <div class="ub-hp"><i class="hp"></i><i class="sh"></i></div><div class="ub-en"><i class="en"></i><i class="sp"></i></div>`;
    this.ctx.overlay.appendChild(el);
    return { el, hp: el.querySelector('.hp'), sh: el.querySelector('.sh'), en: el.querySelector('.en'), sp: el.querySelector('.sp'),
             icons: el.querySelector('.ub-icons'), iconStr: '' };
  }

  place(p) {
    const v = tileXZ(p);
    v.y = this.ctx.stage.tileHeight(p);
    this.root.position.copy(v);
  }

  play(name, once = false) {
    if (!this.mixer || !this.clips[name]) return;
    const next = this.mixer.clipAction(this.clips[name]);
    if (this.current === next && !once) return;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    if (this.current && this.current !== next) next.crossFadeFrom(this.current, 0.12, false);
    next.play();
    this.current = next;
  }

  faceTo(worldPos) {
    const d = new THREE.Vector3().subVectors(worldPos, this.root.position);
    if (d.lengthSq() > 1e-4) this.yaw = Math.atan2(d.x, d.z);
  }

  moveTo(from, to, kind, dur) {
    const a = tileXZ(from), b = tileXZ(to);
    a.y = this.root.position.y;
    b.y = this.ctx.stage.tileHeight(to);
    this.moving = { a, b, t: 0, dur: Math.max(dur, 0.05), kind };
    this.faceTo(b);
    if (kind === 'walk') this.play('Walk');
    if (kind === 'blink') { this.root.position.copy(b); this.moving = null; this.ctx.fx.spark(b.clone().setY(0.3), { color: 0xbfefff, count: 14 }); }
  }

  attackAnim(targetView, ranged) {
    if (targetView) this.faceTo(targetView.root.position);
    if (this.mixer) this.play('Attack', true);
    if (!ranged) this.lunge = 1;
  }
  castAnim(special, ability) {
    const clip = special ? 'Special' : (this.unit.abilities.indexOf(ability) === 1 ? 'Ability2' : 'Ability1');
    if (this.mixer) this.play(clip, true);
    this.hop = special ? 1 : 0.5;
  }
  hitAnim() { this.flash = 1; this.shake = 1; if (this.mixer && !this.lungeLocked && Math.random() < 0.5) this.play('Hit', true); }
  deathAnim() {
    this.dead = true;
    if (this.mixer && this.clips.Death) this.play('Death', true); else this.dying = 0;
    this.bar.el.classList.add('dead');
  }
  reviveAnim() {
    this.dead = false; this.dying = undefined;
    this.body.scale.setScalar(1); this.body.position.set(0, 0, 0);
    this.place(this.unit.pos);
    this.bar.el.classList.remove('dead');
    this.play('Idle');
    this.ctx.fx.spark(this.root.position.clone().setY(0.4), { color: 0xffd060, count: 24, speed: 2 });
  }
  victory() { if (this.mixer && this.clips.Victory) this.play('Victory'); else this.hop = 1; }

  _setStatusFx(name, on, make) {
    const cur = this.statusFx[name];
    if (on && !cur) { const o = make(); this.root.add(o); this.statusFx[name] = o; }
    else if (!on && cur) { this.root.remove(cur); delete this.statusFx[name]; }
  }

  update(dt, battle) {
    const u = this.unit, fx = this.ctx.fx;
    if (this.mixer) this.mixer.update(dt);
    // movement
    if (this.moving) {
      const m = this.moving;
      m.t += dt;
      const k = Math.min(m.t / m.dur, 1);
      this.root.position.lerpVectors(m.a, m.b, k);
      if (m.kind === 'leap') this.root.position.y += Math.sin(k * Math.PI) * 0.7;
      if (k >= 1) { this.moving = null; if (!this.dead && this.current && this.clips && this.current.getClip() === this.clips.Walk) this.play('Idle'); }
    }
    // facing: target if fighting
    if (!this.moving && u.active && u.target && u.target.active) {
      const tv = this.ctx.views.get(u.target.uid);
      if (tv) this.faceTo(tv.root.position);
    }
    let dy = this.yaw - this.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.root.rotation.y += dy * Math.min(1, dt * 10);
    // procedural extras (placeholders rely on these; models get a subtle version)
    const t = this.ctx.stage.time;
    this.lunge = Math.max(0, this.lunge - dt * 5);
    this.hop = Math.max(0, this.hop - dt * 2.5);
    this.shake = Math.max(0, this.shake - dt * 6);
    const lungeZ = Math.sin(this.lunge * Math.PI) * (this.mixer ? 0.08 : 0.25);
    const bob = this.mixer ? 0 : Math.abs(Math.sin(t * 3 + u.uid)) * 0.03;
    if (this.dying !== undefined && !this.mixer) {
      this.dying += dt;
      this.body.scale.setScalar(Math.max(0.01, 1 - this.dying * 1.5));
      this.body.position.y = -this.dying * 0.2;
    } else {
      this.body.position.set(Math.sin(t * 60) * 0.03 * this.shake, bob + Math.sin(this.hop * Math.PI) * 0.25, lungeZ);
      if (!this.mixer && this.moving && this.moving.kind === 'walk') this.body.position.y += Math.abs(Math.sin(this.moving.t * 14)) * 0.08;
    }
    // hit flash
    this.flash = Math.max(0, this.flash - dt * 5);
    for (const m of this.flashMats) { m.emissive?.setRGB(this.flash * 0.9, this.flash * 0.15, this.flash * 0.1); }
    // statuses
    const frozen = battle.has(u, 'freeze');
    this._setStatusFx('freeze', u.active && frozen, () => {
      const o = new THREE.Mesh(new THREE.IcosahedronGeometry(this.height * 0.7, 0),
        new THREE.MeshStandardMaterial({ color: 0xcff6ff, emissive: 0x3a9ad0, emissiveIntensity: 0.5, transparent: true, opacity: 0.45, roughness: 0.1, flatShading: true }));
      o.position.y = this.height * 0.5; return o;
    });
    this._setStatusFx('shield', u.active && u.shield > 1 && u.shieldUntil > battle.t, () => {
      const o = new THREE.Mesh(new THREE.SphereGeometry(this.height * 0.75, 20, 14),
        new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
      o.position.y = this.height * 0.5; return o;
    });
    this._setStatusFx('stun', u.active && battle.has(u, 'stun'), () => {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), new THREE.MeshBasicMaterial({ color: 0xfff27a }));
        s.position.set(Math.cos(i * 2.1) * 0.2, this.height + 0.12, Math.sin(i * 2.1) * 0.2); g.add(s);
      }
      g.userData.spin = true; return g;
    });
    this._setStatusFx('egg', u.alive && u.eggUntil !== null, () => {
      const o = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffb060, emissive: 0xff6a20, emissiveIntensity: 0.8 }));
      o.scale.y = 1.3; o.position.y = 0.25; return o;
    });
    if (this.statusFx.stun) this.statusFx.stun.rotation.y += dt * 4;
    this.body.visible = !(u.alive && u.eggUntil !== null);
    const invis = battle.has(u, 'invis');
    for (const m of this.flashMats) m.opacity = invis ? 0.35 : 1;
    const head = this.root.position.clone().add(new THREE.Vector3(0, this.height * 0.6, 0));
    if (u.active && Math.random() < dt * 8) {
      if (battle.has(u, 'burn')) fx.spark(head, { color: 0xff7a20, count: 1, speed: 0.6, size: 0.16, life: 0.45, gravity: 1.2 });
      if (battle.has(u, 'shock')) fx.spark(head, { color: 0xffe04a, count: 1, speed: 1.6, size: 0.09, life: 0.2, gravity: 0 });
      if (battle.has(u, 'soak')) fx.spark(head, { color: 0x3ab8ff, count: 1, speed: 0.3, size: 0.08, life: 0.5, gravity: -3 });
      if (battle.has(u, 'crack')) fx.spark(head, { color: 0xc89a5a, count: 1, speed: 0.4, size: 0.08, life: 0.4, gravity: -2 });
    }
    // blinking: texture swap on models, squash on placeholder eyes
    this.blinkAt -= dt;
    const closed = this.dead || frozen || battle.has(u, 'stun') || this.blinkAt < 0;
    if (this.blinkAt < -0.12) this.blinkAt = 2 + Math.random() * 3;
    if (this.closedMap && this.mainMat) {
      const want = closed ? this.closedMap : this.openMap;
      if (this.mainMat.map !== want) { this.mainMat.map = want; this.mainMat.needsUpdate = true; }
    }
    if (this.eyes) for (const e of this.eyes) e.scale.y = closed ? 0.15 : 1;
    // health bar
    const sp = this.ctx.stage.project(this.root.position.clone().add(new THREE.Vector3(0, this.height + 0.22, 0)));
    const b = this.bar;
    b.el.style.transform = `translate(${sp.x - 34}px, ${sp.y - 22}px)`;
    b.el.style.display = (u.alive || this.dead) && sp.visible ? '' : 'none';
    b.hp.style.width = `${Math.max(0, u.hpf) * 100}%`;
    b.sh.style.width = `${Math.min(1, (u.shieldUntil > battle.t ? u.shield : 0) / u.maxHp) * 100}%`;
    b.en.style.width = `${u.energy}%`;
    b.sp.style.width = `${u.special ? u.smeter : 0}%`;
    b.el.classList.toggle('special-ready', !!u.special && u.smeter >= 100 && u.active);
    const icons = u.active ? STATUS_ICONS.filter(([st]) => battle.has(u, st)).map(([, i]) => i).join('') : '';
    if (icons !== b.iconStr) { b.iconStr = icons; b.icons.textContent = icons; }
  }

  dispose() {
    this.ctx.stage.scene.remove(this.root);
    this.bar.el.remove();
  }
}

export { ELEMENT_COLOR };
