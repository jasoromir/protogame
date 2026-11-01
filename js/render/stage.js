// Three.js stage: renderer with bloom, lighting, hex board and terrain tiles.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as hex from '../sim/hex.js';

export const HEX_R = 0.5;
export const HEX_W = Math.sqrt(3) * HEX_R;
export const ROW_H = 1.5 * HEX_R;
const TILE_H = 0.12;
const HIGH_H = 0.28;

export function tileXZ([col, row]) {
  return new THREE.Vector3((col + 0.5 * (row & 1) - 3.25) * HEX_W, 0, (3.5 - row) * ROW_H);
}

const TILE_LOOK = {
  plain: { color: 0x6c9a52, emissive: 0x000000, h: 0 },
  high: { color: 0x9a8f86, emissive: 0x000000, h: HIGH_H },
  river: { color: 0x2f8fd0, emissive: 0x0a2a44, h: -0.03, opacity: 0.85 },
  brush: { color: 0x3f7a2e, emissive: 0x000000, h: 0 },
  lava: { color: 0xff5a1a, emissive: 0xff4400, h: -0.02, glow: 2.2 },
  icewall: { color: 0xcff2ff, emissive: 0x3aa0d0, h: 0 },
  charged: { color: 0x8a8040, emissive: 0xffd23a, h: 0, glow: 1.2 },
  frozen: { color: 0xd8f4ff, emissive: 0x204060, h: 0 },
  steam: { color: 0xc8d4dc, emissive: 0x506070, h: 0, opacity: 0.9 },
  mud: { color: 0x5a4030, emissive: 0x000000, h: -0.02 },
};

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    this.timer = new THREE.Timer();
    this.time = 0;
    this._lights();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);
    this.tiles = new Map();
    this.raycaster = new THREE.Raycaster();
    this.onFrame = null;
    this.cameraMode = 'battle';
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _lights() {
    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x5a4a3a, 1.1);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.set(-4, 9, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.sun = sun;
    const rim = new THREE.DirectionalLight(0x9fc8ff, 1.3);   // back light so silhouettes pop
    rim.position.set(3, 5, -8);
    this.scene.add(rim);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setMap(map) {
    this.map = map;
    this.boardGroup.visible = true;
    this.scene.background = new THREE.Color(map.sky);
    this.scene.fog = new THREE.Fog(map.sky, 14, 34);
    this.hemi.groundColor = new THREE.Color(map.ground);
    this.buildBoard();
  }

  buildBoard() {
    this.boardGroup.clear();
    this.tiles.clear();
    // island under the board
    const island = new THREE.Mesh(new THREE.CylinderGeometry(4.9, 3.6, 1.4, 9),
      new THREE.MeshStandardMaterial({ color: this.map.ground, roughness: 1, flatShading: true }));
    island.position.y = -0.78;
    island.receiveShadow = true;
    this.boardGroup.add(island);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(4.95, 4.9, 0.12, 9),
      new THREE.MeshStandardMaterial({ color: 0x3a3028, roughness: 1, flatShading: true }));
    rim.position.y = -0.1;
    this.boardGroup.add(rim);
    // scattered rocks for scale
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x7d7468, roughness: 1, flatShading: true });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.3, r = 4.4 + (i % 3) * 0.2;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18 + (i % 4) * 0.07), rockMat);
      rock.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
      rock.castShadow = true;
      this.boardGroup.add(rock);
    }
    const geo = new THREE.CylinderGeometry(HEX_R * 0.95, HEX_R * 0.97, TILE_H, 6);
    geo.translate(0, -TILE_H / 2, 0);
    for (const p of hex.ALL) {
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);
      const pos = tileXZ(p);
      mesh.position.copy(pos);
      mesh.receiveShadow = true;
      mesh.userData.pos = p;
      this.boardGroup.add(mesh);
      const extras = new THREE.Group();
      extras.position.copy(pos);
      this.boardGroup.add(extras);
      // side edge marks which half belongs to whom
      const edge = new THREE.Mesh(new THREE.RingGeometry(HEX_R * 0.86, HEX_R * 0.93, 6),
        new THREE.MeshBasicMaterial({ color: p[1] <= 3 ? 0x4aa8ff : 0xff5a4a, transparent: true, opacity: 0.35 }));
      edge.rotation.x = -Math.PI / 2;
      edge.rotation.z = Math.PI / 2;
      edge.position.y = 0.006;
      extras.add(edge);
      const t = { mesh, mat, extras, edge, type: null, base: pos.clone() };
      this.tiles.set(hex.key(p), t);
      this.setTile(p, this.map.base.get(hex.key(p)) || 'plain');
    }
  }

  setTile(p, type) {
    const t = this.tiles.get(hex.key(p));
    if (!t || t.type === type) return;
    t.type = type;
    const look = TILE_LOOK[type] || TILE_LOOK.plain;
    const shade = ((p[0] + p[1]) % 2) ? 1 : 0.92;
    t.mat.color.setHex(look.color).multiplyScalar(type === 'plain' ? shade : 1);
    t.mat.emissive.setHex(look.emissive);
    t.mat.emissiveIntensity = look.glow || 1;
    t.mat.opacity = look.opacity || 1;
    t.mesh.scale.y = 1 + (look.h > 0 ? look.h / TILE_H : 0);
    t.mesh.position.y = look.h < 0 ? look.h : 0;
    t.height = Math.max(look.h, 0);
    for (const c of [...t.extras.children]) if (c !== t.edge && c !== t.fill) t.extras.remove(c);
    t.edge.position.y = t.height + 0.006;
    if (type === 'brush') this._grass(t);
    if (type === 'icewall') this._ice(t);
    if (type === 'high') this._boulders(t);
  }
  tileHeight(p) { const t = this.tiles.get(hex.key(p)); return t ? t.height || 0 : 0; }

  _grass(t) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x5aa83a, roughness: 0.9, flatShading: true });
    for (let i = 0; i < 16; i++) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22 + Math.random() * 0.12, 4), mat);
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.36;
      blade.position.set(Math.cos(a) * r, 0.12, Math.sin(a) * r);
      blade.rotation.z = (Math.random() - 0.5) * 0.5;
      blade.castShadow = true;
      t.extras.add(blade);
    }
  }
  _ice(t) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8f6ff, emissive: 0x3a9ad0, emissiveIntensity: 0.4, roughness: 0.1,
      transparent: true, opacity: 0.85, flatShading: true });
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.16 + i * 0.03), mat);
      c.scale.y = 2.4;
      c.position.set((i - 1.5) * 0.12, 0.3, (i % 2) * 0.1 - 0.05);
      c.rotation.y = i;
      c.castShadow = true;
      t.extras.add(c);
    }
  }
  _boulders(t) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8c8278, roughness: 1, flatShading: true });
    const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11), mat);
    b.position.set(0.28, HIGH_H + 0.05, 0.1);
    b.castShadow = true;
    t.extras.add(b);
  }

  /** Sync tile visuals with the battle's current terrain (overlays expire on their own). */
  syncTiles(battle) { for (const p of hex.ALL) this.setTile(p, battle.tile(p)); }

  /** Color tiles (deploy area, aim preview, targets). marks: Map(key -> color). */
  setMarks(marks) {
    for (const [k, t] of this.tiles) {
      const p = hex.fromKey(k), c = marks.get(k);
      t.edge.material.color.setHex(c ?? (p[1] <= 3 ? 0x4aa8ff : 0xff5a4a));
      t.edge.material.opacity = c !== undefined ? 0.95 : 0.3;
      t.edge.scale.setScalar(c !== undefined ? 1.06 : 1);
      if (!t.fill) {
        t.fill = new THREE.Mesh(new THREE.CircleGeometry(HEX_R * 0.86, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
        t.fill.rotation.x = -Math.PI / 2; t.fill.rotation.z = Math.PI / 2;
        t.extras.add(t.fill);
      }
      t.fill.position.y = (t.height || 0) + 0.01;
      t.fill.material.color.setHex(c ?? 0xffffff);
      t.fill.material.opacity = c !== undefined && marks.size < 30 ? 0.35 : 0;
    }
  }

  setBattleCamera() {
    this.cameraMode = 'battle';
    this.camera.fov = 36; this.camera.updateProjectionMatrix();
    this.camera.position.set(0, 7.3, 6.9);
    this.camera.lookAt(0, 0, 0.55);
    this.shake = 0;
  }
  setTitleCamera() { this.cameraMode = 'orbit'; this.camera.fov = 36; this.camera.updateProjectionMatrix(); }

  pickTile(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hits = this.raycaster.intersectObjects([...this.tiles.values()].map((t) => t.mesh));
    return hits.length ? hits[0].object.userData.pos : null;
  }

  /** Ground point (y = 0 plane) under the mouse, or null. */
  pickPoint(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? hit : null;
  }

  /** World position -> pixel position on screen (for HTML health bars and text). */
  project(v) {
    const p = v.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: (p.x * 0.5 + 0.5) * r.width + r.left, y: (-p.y * 0.5 + 0.5) * r.height + r.top, visible: p.z < 1 };
  }

  _frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.time += dt;
    if (this.cameraMode === 'orbit') {
      const a = this.time * 0.12;
      this.camera.position.set(Math.sin(a) * 7.5, 4.2, Math.cos(a) * 7.5);
      this.camera.lookAt(0, 0.6, 0);
    }
    if (this.cameraMode === 'battle') {
      this.shake = Math.max(0, (this.shake || 0) - dt);
      const k = this.shake * 0.5;
      this.camera.position.set((Math.random() - 0.5) * k, 7.3 + (Math.random() - 0.5) * k, 6.9);
      this.camera.lookAt(0, 0, 0.55);
    }
    for (const t of this.tiles.values()) {
      if (t.type === 'steam') t.mat.emissiveIntensity = 0.6 + Math.sin(this.time * 3 + t.base.x) * 0.2;
      if (t.type === 'lava') t.mat.emissiveIntensity = 1.8 + Math.sin(this.time * 4 + t.base.x) * 0.5;
      if (t.type === 'charged') t.mat.emissiveIntensity = 0.8 + Math.abs(Math.sin(this.time * 9 + t.base.z)) * 0.9;
      if (t.type === 'river') t.mat.emissiveIntensity = 0.7 + Math.sin(this.time * 2 + t.base.x * 2) * 0.3;
    }
    if (this.onFrame) this.onFrame(dt);
    this.composer.render(dt);
  }
}
