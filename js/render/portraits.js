// Portraits for the Codex (rendered once from the 3D figures) and a small turntable viewer.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { placeholder } from './units.js';
import { LOOKS, LINES } from '../data/creatures.js';

const MODEL_SCALE = { Cindrake: 1.0, Ignarion: 0.95, Brinehorn: 0.72 };

/** A display object for a form: {object, mixer, clips}. */
export function buildFigure(assets, formName, line) {
  const look = LOOKS[formName];
  const model = look && assets.models[look.model];
  if (model) {
    const obj = SkeletonUtils.clone(model.scene);
    obj.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        if (look.tint) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(look.tint)); }
      }
    });
    obj.scale.setScalar((MODEL_SCALE[look.model] || 1) * (look.scale || 1));
    const g = new THREE.Group();
    g.add(obj);
    let mixer = null;
    if (model.animations.length) {
      mixer = new THREE.AnimationMixer(obj);
      const idle = model.animations.find((c) => c.name.endsWith('_Idle'));
      if (idle) mixer.clipAction(idle).play();
    }
    return { object: g, mixer };
  }
  const idx = Math.max(0, LINES[line].forms.findIndex((f) => f.name === formName));
  return { object: placeholder(line, idx).group, mixer: null };
}

function studio() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.4));
  const key = new THREE.DirectionalLight(0xfff0dd, 2.6); key.position.set(-2, 4, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc8ff, 1.6); rim.position.set(3, 3, -4); scene.add(rim);
  return scene;
}

function frame(camera, obj, angle = 0.6) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) * 0.95;
  camera.position.set(center.x + Math.sin(angle) * r * 1.9, center.y + r * 0.45, center.z + Math.cos(angle) * r * 1.9);
  camera.lookAt(center);
}

export class PortraitStudio {
  constructor(assets) {
    this.assets = assets;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setSize(220, 220);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = studio();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
    this.cache = new Map();
  }
  portrait(formName, line, silhouette = false) {
    const key = `${formName}|${silhouette}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const { object, mixer } = buildFigure(this.assets, formName, line);
    if (mixer) mixer.update(0.5);
    if (silhouette) object.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: 0x1a1724 }); });
    this.scene.add(object);
    frame(this.camera, object);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.scene.remove(object);
    this.cache.set(key, url);
    return url;
  }
}

/** Turntable viewer inside an HTML element; returns a dispose() function. */
export function mountViewer(container, assets, formName, line) {
  const w = container.clientWidth || 360, h = container.clientHeight || 360;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  const scene = studio();
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 6), new THREE.MeshStandardMaterial({ color: 0x3a3448, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(32, w / h, 0.01, 50);
  const { object, mixer } = buildFigure(assets, formName, line);
  scene.add(object);
  frame(camera, object, 0.5);
  const timer = new THREE.Timer();
  let angle = 0, dragging = false, lastX = 0, alive = true;
  renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; });
  window.addEventListener('pointerup', () => { dragging = false; });
  renderer.domElement.addEventListener('pointermove', (e) => { if (dragging) { angle += (e.clientX - lastX) * 0.01; lastX = e.clientX; } });
  renderer.setAnimationLoop(() => {
    if (!alive) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    if (!dragging) angle += dt * 0.5;
    object.rotation.y = angle;
    if (mixer) mixer.update(dt);
    renderer.render(scene, camera);
  });
  return () => { alive = false; renderer.setAnimationLoop(null); renderer.dispose(); renderer.domElement.remove(); };
}
