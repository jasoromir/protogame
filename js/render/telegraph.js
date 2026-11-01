// League-of-Legends-style ground indicators for aiming and casting.
// States: 'charging' (red: not enough energy), 'ready' (blue), 'invalid' (grey), 'enemy' (orange, enemy cast).
import * as THREE from 'three';
import { HEX_W, HEX_R } from './stage.js';

export const TELEGRAPH_COLORS = { ready: 0x18b4ff, charging: 0xff2a2a, invalid: 0x8a8a96, enemy: 0xff7a10, ally: 0x30e080 };

function canvasTex(draw, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// area: soft fill brighter toward the edge, a crisp outer ring, a dashed inner ring with rune ticks
const AREA_TEX = canvasTex((g, s) => {
  const r = s / 2;
  const fill = g.createRadialGradient(r, r, 0, r, r, r);
  fill.addColorStop(0, 'rgba(255,255,255,0.3)');
  fill.addColorStop(0.75, 'rgba(255,255,255,0.48)');
  fill.addColorStop(0.97, 'rgba(255,255,255,0.8)');
  fill.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = fill; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  // dark contour just inside the rim: the tint can't lighten it, so the edge reads on any ground
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = s * 0.012;
  g.beginPath(); g.arc(r, r, r * 0.935, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = s * 0.022;
  g.beginPath(); g.arc(r, r, r * 0.965, 0, Math.PI * 2); g.stroke();
  g.lineWidth = s * 0.008; g.setLineDash([s * 0.03, s * 0.02]);
  g.beginPath(); g.arc(r, r, r * 0.8, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]); g.lineWidth = s * 0.012;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.beginPath(); g.moveTo(r + Math.cos(a) * r * 0.84, r + Math.sin(a) * r * 0.84); g.lineTo(r + Math.cos(a) * r * 0.92, r + Math.sin(a) * r * 0.92); g.stroke();
  }
});
// line: translucent band, bright side rails, chevrons pointing forward (+v)
const LINE_TEX = canvasTex((g, s) => {
  const band = g.createLinearGradient(0, 0, s, 0);
  band.addColorStop(0, 'rgba(255,255,255,1)'); band.addColorStop(0.07, 'rgba(255,255,255,1)');
  band.addColorStop(0.08, 'rgba(0,0,0,0.5)'); band.addColorStop(0.1, 'rgba(255,255,255,0.45)');
  band.addColorStop(0.9, 'rgba(255,255,255,0.45)'); band.addColorStop(0.92, 'rgba(0,0,0,0.5)');
  band.addColorStop(0.93, 'rgba(255,255,255,1)'); band.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = band; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = s * 0.04; g.lineJoin = 'round';
  for (let i = 0; i < 4; i++) {
    const y = s * (0.85 - i * 0.25);
    g.beginPath(); g.moveTo(s * 0.25, y); g.lineTo(s * 0.5, y - s * 0.12); g.lineTo(s * 0.75, y); g.stroke();
  }
});

// Normal (not additive) blending: additive washes out to white on the bright board.
function mat(tex, color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
}
function solid(color, opacity) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
}

export class Telegraph {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.renderOrder = 5;
    scene.add(this.group);
    this.kind = null;
    this.state = 'ready';
    this.t = 0;
    this.progress = null;   // 0..1 cast progress (fills the shape)
  }
  _reset(kind) {
    this.group.clear();
    this.kind = kind;
    this.parts = {};
  }
  _color() { return TELEGRAPH_COLORS[this.state] || TELEGRAPH_COLORS.ready; }
  _ensure(kind, build) { if (this.kind !== kind) { this._reset(kind); build(); } }

  /** spec: {shape, from:Vector3 (caster), at:Vector3 (aim point), radius, range, angle, length, width, y} */
  show(spec, state = 'ready', progress = null) {
    this.state = state;
    this.progress = progress;
    this.group.visible = true;
    const y = (spec.y || 0) + 0.035;
    const col = this._color();
    switch (spec.shape) {
      case 'circle': case 'self': case 'leap': {
        const r = spec.radius;
        this._ensure('circle', () => {
          this.parts.area = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat(AREA_TEX, col));
          this.parts.area.rotation.x = -Math.PI / 2;
          this.parts.fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48), solid(col, 0.22));
          this.parts.fill.rotation.x = -Math.PI / 2;
          this.group.add(this.parts.area, this.parts.fill);
          this.parts.arc = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: col, dashSize: 0.12, gapSize: 0.08, transparent: true }));
          this.group.add(this.parts.arc);
        });
        this.parts.area.position.set(spec.at.x, y, spec.at.z);
        this.parts.area.scale.setScalar(r);
        this.parts.area.rotation.z = this.t * 0.4;
        this.parts.fill.position.set(spec.at.x, y - 0.005, spec.at.z);
        this.parts.fill.scale.setScalar(r * (progress === null ? 0.001 : Math.max(0.001, progress)));
        // leap: dashed arc from the caster to the landing point
        if (spec.shape === 'leap' && spec.from) {
          const pts = [];
          for (let i = 0; i <= 20; i++) {
            const k = i / 20;
            pts.push(new THREE.Vector3().lerpVectors(spec.from, spec.at, k).setY(y + Math.sin(k * Math.PI) * 0.9));
          }
          this.parts.arc.geometry.setFromPoints(pts);
          this.parts.arc.computeLineDistances();
          this.parts.arc.visible = true;
        } else this.parts.arc.visible = false;
        break;
      }
      case 'cone': {
        const r = spec.range, a = (spec.angle * Math.PI) / 180;
        this._ensure('cone', () => {
          const sector = new THREE.CircleGeometry(1, 40, -a / 2, a);
          this.parts.area = new THREE.Mesh(sector, mat(AREA_TEX, col));
          const rim = new THREE.RingGeometry(0.95, 1.0, 40, 1, -a / 2, a);
          this.parts.rim = new THREE.Mesh(rim, solid(col, 0.95));
          const edgePts = [new THREE.Vector3(Math.cos(a / 2), Math.sin(a / 2), 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(-a / 2), Math.sin(-a / 2), 0)];
          this.parts.edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(edgePts), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 }));
          this.parts.fill = new THREE.Mesh(new THREE.CircleGeometry(1, 40, -a / 2, a), solid(col, 0.22));
          this.parts.pivot = new THREE.Group();
          this.parts.pivot.add(this.parts.area, this.parts.rim, this.parts.edge, this.parts.fill);
          this.parts.pivot.rotation.x = -Math.PI / 2;
          this.group.add(this.parts.pivot);
        });
        const dir = Math.atan2(-(spec.at.z - spec.from.z), spec.at.x - spec.from.x);
        this.parts.pivot.position.set(spec.from.x, y, spec.from.z);
        this.parts.pivot.rotation.z = dir;
        for (const k of ['area', 'rim', 'edge']) this.parts[k].scale.setScalar(r);
        this.parts.fill.scale.setScalar(r * (progress === null ? 0.001 : Math.max(0.001, progress)));
        break;
      }
      case 'line': {
        const len = spec.length, w = spec.width;
        this._ensure('line', () => {
          this.parts.band = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(LINE_TEX, col));
          const head = new THREE.Shape();
          head.moveTo(-0.5, 0); head.lineTo(0, 0.6); head.lineTo(0.5, 0); head.lineTo(-0.5, 0);
          this.parts.head = new THREE.Mesh(new THREE.ShapeGeometry(head), solid(col, 0.75));
          this.parts.fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), solid(col, 0.25));
          this.parts.pivot = new THREE.Group();
          this.parts.pivot.add(this.parts.band, this.parts.head, this.parts.fill);
          this.group.add(this.parts.pivot);
        });
        const dx = spec.at.x - spec.from.x, dz = spec.at.z - spec.from.z;
        const yaw = Math.atan2(dx, dz);
        this.parts.pivot.position.set(spec.from.x, y, spec.from.z);
        this.parts.pivot.rotation.set(0, yaw, 0);
        // band lies flat along +Z (rotated +90° so the chevrons point forward)
        this.parts.band.rotation.x = Math.PI / 2;
        this.parts.band.scale.set(w, len, 1);
        this.parts.band.position.set(0, 0, len / 2);
        this.parts.head.rotation.x = Math.PI / 2;
        this.parts.head.scale.set(w * 1.5, w * 0.9, 1);
        this.parts.head.position.set(0, 0.002, len);
        const p = progress === null ? 0 : progress;
        this.parts.fill.rotation.x = Math.PI / 2;
        this.parts.fill.scale.set(w, Math.max(0.001, len * p), 1);
        this.parts.fill.position.set(0, 0.001, (len * p) / 2);
        break;
      }
      case 'single': {
        this._ensure('single', () => {
          this.parts.ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 40), solid(col, 0.95));
          this.parts.ticks = new THREE.Group();
          for (let i = 0; i < 4; i++) {
            const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.16), solid(col, 0.95));
            tick.position.set(Math.cos((i * Math.PI) / 2) * 0.52, Math.sin((i * Math.PI) / 2) * 0.52, 0);
            tick.rotation.z = (i * Math.PI) / 2 + Math.PI / 2;
            this.parts.ticks.add(tick);
          }
          this.parts.fill = new THREE.Mesh(new THREE.CircleGeometry(0.34, 32), solid(col, 0.25));
          this.parts.pivot = new THREE.Group();
          this.parts.pivot.add(this.parts.ring, this.parts.ticks, this.parts.fill);
          this.parts.pivot.rotation.x = -Math.PI / 2;
          this.parts.tether = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: col, dashSize: 0.1, gapSize: 0.07, transparent: true, opacity: 0.8 }));
          this.group.add(this.parts.pivot, this.parts.tether);
        });
        this.parts.pivot.position.set(spec.at.x, y, spec.at.z);
        this.parts.ticks.rotation.z = this.t * 1.5;
        this.parts.fill.scale.setScalar(progress === null ? 0.001 : Math.max(0.001, progress));
        if (spec.from) {
          this.parts.tether.geometry.setFromPoints([spec.from.clone().setY(y), spec.at.clone().setY(y)]);
          this.parts.tether.computeLineDistances();
          this.parts.tether.visible = true;
        } else this.parts.tether.visible = false;
        break;
      }
      default: this.hide();
    }
    this._tint(col);
  }
  _tint(col) {
    const pulse = 0.85 + 0.15 * Math.sin(this.t * (this.state === 'charging' ? 6 : 3));
    this.group.traverse((o) => {
      if (o.material) { o.material.color.setHex(col); if (o.material.userData.base === undefined) o.material.userData.base = o.material.opacity; o.material.opacity = o.material.userData.base * pulse; }
    });
  }
  update(dt) { this.t += dt; }
  hide() { this.group.visible = false; }
  dispose() { this.scene.remove(this.group); }
}

/** World radius for an area of `r` hex rings. */
export const areaRadius = (r) => r * HEX_W + HEX_R * 0.8;
