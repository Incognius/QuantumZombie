// Rigged zombie models (Quaternius, see README credits) with state-driven animation.
// The look of each body encodes its qubit: corpse on the floor, red-eyed runner, or a
// flickering translucent "undecided" shambler tinted by its cyan answer.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Eigen } from '../quantum/qubit';
import { COLORS } from './models';

export interface ZombieModel {
  scene: THREE.Object3D;
  clips: Record<'idle' | 'walk' | 'run' | 'death' | 'attack' | 'hit', THREE.AnimationClip | undefined>;
  scale: number;
  headBone: string | null;
}

const FILES = ['zombie_a.glb', 'zombie_b.glb', 'zombie_c.glb'];

function pick(clips: THREE.AnimationClip[], re: RegExp): THREE.AnimationClip | undefined {
  return clips.find(c => re.test(c.name.split('|').pop() ?? c.name));
}

export async function loadZombieModels(base: string): Promise<ZombieModel[]> {
  const loader = new GLTFLoader();
  const out: ZombieModel[] = [];
  await Promise.all(FILES.map(async f => {
    try {
      const gltf = await loader.loadAsync(`${base}models/${f}`);
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene, true);
      let h = box.max.y - box.min.y;
      if (!(h > 0.2 && h < 20)) h = 2;
      let headBone: string | null = null;
      scene.traverse(o => {
        if ((o as THREE.Bone).isBone && !headBone && /^head$/i.test(o.name)) headBone = o.name;
        if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.frustumCulled = false; }
      });
      const c = gltf.animations;
      out.push({
        scene,
        scale: 1.85 / h,
        headBone,
        clips: {
          idle: pick(c, /^Idle$/i), walk: pick(c, /^Walk$/i), run: pick(c, /^Run$/i) ?? pick(c, /Run/i),
          death: pick(c, /^Death$/i), attack: pick(c, /^(Punch|Attack|Run_Attack|Idle_Attack)$/i), hit: pick(c, /^Hit/i),
        },
      });
    } catch (e) {
      console.warn('zombie model failed', f, e);
    }
  }));
  return out;
}

const eyeTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const ringGeo = new THREE.RingGeometry(0.4, 0.62, 28);

export interface ZombieRig {
  readonly root: THREE.Group;
  hitFlash(): void;
  update(dt: number, state: Eigen, speed: number, time: number, attacking: boolean): void;
  dispose(): void;
}

export class RiggedZombie implements ZombieRig {
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Partial<Record<keyof ZombieModel['clips'], THREE.AnimationAction>> = {};
  private current: THREE.AnimationAction | null = null;
  private readonly mats: THREE.MeshStandardMaterial[] = [];
  private readonly eyes: THREE.Sprite[] = [];
  private readonly aura: THREE.Mesh;
  private readonly auraMat: THREE.MeshBasicMaterial;
  private lastState: Eigen | null = null;
  private flash = 0;
  private phase = Math.random() * 10;
  private rising = 0;
  private head: THREE.Object3D | null = null;
  private twitch = 0;
  private twitchT = Math.random() * 3;
  private twitchAxis = new THREE.Vector3();

  constructor(model: ZombieModel, seed: number) {
    const body = cloneSkinned(model.scene);
    body.scale.multiplyScalar(model.scale);
    this.root.add(body);
    // sickly, desaturated, darker than the cartoon originals
    const tint = new THREE.Color().setHSL(0.22 + ((seed * 13) % 7) / 100, 0.22, 0.32 + ((seed * 7) % 5) / 50);
    body.scale.multiplyScalar(1 + ((seed * 17) % 10) / 70);
    body.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      const mat = src.clone();
      mat.color.multiply(tint);
      mat.transparent = true;
      mat.roughness = 0.95;
      mat.metalness = 0;
      m.material = mat;
      this.mats.push(mat);
    });
    // glowing eyes on the head bone
    const head = model.headBone ? body.getObjectByName(model.headBone) ?? null : null;
    this.head = head;
    for (const x of [-1, 1]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: eyeTex, color: COLORS.alive, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.scale.setScalar(0.17);
      if (head) {
        // head bone space is scaled by the armature (×100 in these files) and the model scale
        const wsScale = new THREE.Vector3();
        body.updateMatrixWorld(true);
        head.getWorldScale(wsScale);
        const inv = 1 / (wsScale.x || 1);
        s.position.set(x * 0.07 * inv, 0.12 * inv, 0.16 * inv);
        s.scale.multiplyScalar(inv);
        head.add(s);
      } else {
        s.position.set(x * 0.07, 1.68, 0.17);
        this.root.add(s);
      }
      this.eyes.push(s);
    }
    this.auraMat = new THREE.MeshBasicMaterial({ color: COLORS.plus, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    this.aura = new THREE.Mesh(ringGeo, this.auraMat);
    this.aura.rotation.x = -Math.PI / 2;
    this.aura.position.y = 0.03;
    this.root.add(this.aura);

    this.mixer = new THREE.AnimationMixer(body);
    for (const [k, clip] of Object.entries(model.clips) as [keyof ZombieModel['clips'], THREE.AnimationClip | undefined][]) {
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      if (k === 'death') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      if (k === 'hit') { a.setLoop(THREE.LoopOnce, 1); }
      this.actions[k] = a;
    }
  }

  private play(name: keyof ZombieModel['clips'], fade = 0.25, timeScale = 1): THREE.AnimationAction | null {
    const a = this.actions[name] ?? this.actions.idle ?? null;
    if (!a) return null;
    a.timeScale = timeScale;
    if (a === this.current) return a;
    a.reset();
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.play();
    if (this.current) this.current.crossFadeTo(a, fade, false);
    this.current = a;
    return a;
  }

  hitFlash(): void {
    this.flash = 0.1;
    const h = this.actions.hit;
    if (h && this.lastState === 'alive') { h.reset(); h.setEffectiveWeight(0.6); h.play(); }
  }

  update(dt: number, state: Eigen, speed: number, time: number, attacking: boolean): void {
    if (state !== this.lastState) {
      const prev = this.lastState;
      this.lastState = state;
      if (state === 'dead') {
        const a = this.play('death', prev === null ? 0 : 0.15);
        if (a && prev === null) { a.time = a.getClip().duration; } // pre-placed corpses start down
      } else if (prev === 'dead') {
        // getting back up: run the death clip backwards
        const d = this.actions.death;
        if (d) { d.paused = false; d.timeScale = -1.1; d.setLoop(THREE.LoopOnce, 1); d.clampWhenFinished = true; d.play(); this.current = d; this.rising = d.getClip().duration / 1.1; }
      }
    }
    if (this.rising > 0) {
      this.rising -= dt;
    } else if (state !== 'dead') {
      if (attacking && state === 'alive') this.play('attack', 0.12, 1.2);
      else if (state === 'alive') this.play(speed > 0.2 ? 'run' : 'idle', 0.2, 1.05);
      else this.play(speed > 0.2 ? 'walk' : 'idle', 0.3, 0.55);
    }
    this.mixer.update(dt);
    // twitchy, broken-neck head jerks on top of the animation
    if (this.head && state !== 'dead') {
      this.twitchT -= dt;
      if (this.twitchT <= 0) {
        this.twitchT = 0.4 + Math.random() * (state === 'alive' ? 1.2 : 2.5);
        this.twitch = 0.5 + Math.random() * 0.5;
        this.twitchAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      }
      this.twitch = Math.max(0, this.twitch - dt * 4);
      const lean = state === 'alive' ? 0.25 : 0.45;
      this.head.rotateZ(Math.sin(time * 0.7 + this.phase) * lean * 0.5);
      if (this.twitch > 0) this.head.rotateOnAxis(this.twitchAxis, this.twitch * 0.6);
    }

    const undecided = state === 'plus' || state === 'minus' || state === 'other';
    const tint = state === 'minus' ? COLORS.minus : COLORS.plus;
    const glitch = Math.random() < 0.05 ? 0.15 : 1;
    const op = undecided ? (0.28 + 0.25 * (0.5 + 0.5 * Math.sin(time * 8 + this.phase * 3))) * glitch : 1;
    for (const m of this.mats) {
      m.opacity = op;
      m.depthWrite = !undecided;
      m.emissive.setHex(this.flash > 0 ? 0xffffff : undecided ? tint : 0x000000);
      m.emissiveIntensity = this.flash > 0 ? 0.8 : undecided ? 0.6 : 0;
    }
    this.flash = Math.max(0, this.flash - dt);
    const eyeCol = state === 'alive' ? COLORS.alive : state === 'minus' ? COLORS.minus : COLORS.plus;
    for (const e of this.eyes) {
      e.visible = state !== 'dead';
      (e.material as THREE.SpriteMaterial).color.setHex(eyeCol);
      (e.material as THREE.SpriteMaterial).opacity = state === 'alive' ? 1 : 0.6 * op;
    }
    this.aura.visible = undecided;
    this.auraMat.color.setHex(tint);
    this.aura.scale.setScalar(1 + 0.12 * Math.sin(time * 4 + this.phase));
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const m of this.mats) m.dispose();
    this.auraMat.dispose();
    for (const e of this.eyes) e.material.dispose();
  }
}
