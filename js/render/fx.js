// Lightweight VFX: additive sprite particles, projectiles, lightning, impact rings, floating text.
import * as THREE from 'three';

export const ELEMENT_COLOR = { fire: 0xff6a20, water: 0x3ab8ff, ice: 0xbfefff, electric: 0xffe04a, earth: 0xc89a5a, heal: 0x7dff8a, shield: 0x9fd8ff };

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class FX {
  constructor(stage, overlay) {
    this.stage = stage;
    this.scene = stage.scene;
    this.overlay = overlay;   // HTML element for floating text
    this.tex = glowTexture();
    this.particles = [];
    this.effects = [];        // {update(dt) -> alive}
    this.texts = [];
  }

  spark(pos, { color = 0xffffff, count = 10, speed = 1.5, size = 0.18, life = 0.5, up = 1, gravity = -2, spread = 1 } = {}) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      const s = new THREE.Sprite(mat);
      s.position.copy(pos);
      const v = new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * up, (Math.random() - 0.5) * spread).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      const sz = size * (0.6 + Math.random() * 0.8);
      s.scale.setScalar(sz);
      this.scene.add(s);
      this.particles.push({ s, v, life, max: life, sz, gravity });
    }
  }

  ring(pos, color, radius) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.RingGeometry(0.75, 1, 40), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos).add(new THREE.Vector3(0, 0.05, 0));
    this.scene.add(m);
    let t = 0;
    const target = Math.max(radius, 0.4) * 0.9 + 0.3;
    this.effects.push({ update: (dt) => {
      t += dt;
      const k = Math.min(t / 0.45, 1);
      m.scale.setScalar(0.2 + k * target);
      mat.opacity = 0.9 * (1 - k);
      if (k >= 1) { this.scene.remove(m); return false; }
      return true;
    } });
  }

  projectile(from, to, color, { size = 0.22, dur = 0.28, trail = true } = {}) {
    const mat = new THREE.SpriteMaterial({ map: this.tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(size * 1.8);
    this.scene.add(s);
    let t = 0;
    return new Promise((resolve) => {
      this.effects.push({ update: (dt) => {
        t += dt;
        const k = Math.min(t / dur, 1);
        s.position.lerpVectors(from, to, k);
        s.position.y += Math.sin(k * Math.PI) * 0.35;
        if (trail) this.spark(s.position, { color, count: 1, speed: 0.2, size: size * 0.9, life: 0.25, gravity: 0 });
        if (k >= 1) { this.scene.remove(s); resolve(); return false; }
        return true;
      } });
    });
  }

  bolt(from, to, color = 0xffe04a, dur = 0.16) {
    const pts = [];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const p = new THREE.Vector3().lerpVectors(from, to, i / n);
      if (i > 0 && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25));
      pts.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, linewidth: 2 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.spark(to, { color, count: 6, speed: 1.2, size: 0.14, life: 0.25 });
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      mat.opacity = 1 - t / dur;
      if (t >= dur) { this.scene.remove(line); geo.dispose(); return false; }
      return true;
    } });
  }

  lightning(pos) {
    const top = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 4, (Math.random() - 0.5) * 0.6));
    this.bolt(top, pos, 0xfff27a, 0.25);
    this.bolt(top, pos, 0xffffff, 0.12);
    this.ring(pos, 0xffe04a, 0.6);
  }

  cone(from, to, color) {
    const dir = new THREE.Vector3().subVectors(to, from).setY(0).normalize();
    for (let i = 0; i < 40; i++) {
      const spread = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((Math.random() - 0.5) * 1.2);
      const v = dir.clone().multiplyScalar(2.5 + Math.random() * 2).add(spread).add(new THREE.Vector3(0, Math.random() * 0.6, 0));
      const mat = new THREE.SpriteMaterial({ map: this.tex, color: i % 3 ? color : 0xffd060, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      const s = new THREE.Sprite(mat);
      s.position.copy(from).add(new THREE.Vector3(0, 0.35, 0));
      s.scale.setScalar(0.25);
      this.scene.add(s);
      this.particles.push({ s, v, life: 0.6, max: 0.6, sz: 0.3 + Math.random() * 0.25, gravity: 0.6, grow: true, delay: i * 0.008 });
    }
  }

  /** Floating text at a world position (damage numbers, reactions, banners). */
  text(worldPos, str, cls = '') {
    const el = document.createElement('div');
    el.className = `float-text ${cls}`;
    el.textContent = str;
    this.overlay.appendChild(el);
    this.texts.push({ el, pos: worldPos.clone(), t: 0, life: cls.includes('reaction') ? 1.3 : 0.9, dx: (Math.random() - 0.5) * 30 });
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (p.delay > 0) { p.delay -= dt; p.s.visible = false; continue; }
      p.s.visible = true;
      p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.s); p.s.material.dispose(); this.particles.splice(i, 1); continue; }
      p.v.y += p.gravity * dt;
      p.s.position.addScaledVector(p.v, dt);
      const k = p.life / p.max;
      p.s.material.opacity = Math.min(1, k * 1.5);
      p.s.scale.setScalar(p.grow ? p.sz * (1.6 - k) : p.sz * (0.4 + 0.6 * k));
    }
    this.effects = this.effects.filter((e) => e.update(dt));
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t += dt;
      const sp = this.stage.project(t.pos);
      t.el.style.transform = `translate(${sp.x + t.dx * t.t - t.el.offsetWidth / 2}px, ${sp.y - 40 - t.t * 55}px)`;
      t.el.style.opacity = String(Math.min(1, (t.life - t.t) * 3));
      if (t.t >= t.life) { t.el.remove(); this.texts.splice(i, 1); }
    }
  }

  clear() {
    for (const p of this.particles) this.scene.remove(p.s);
    this.particles = []; this.effects = [];
    for (const t of this.texts) t.el.remove();
    this.texts = [];
  }
}
