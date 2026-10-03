// Procedural low-poly art: textures, zombies, guns, terminal, door, beacon, pickups.
import * as THREE from 'three';
import type { Eigen } from '../quantum/qubit';

export const COLORS = {
  amber: 0xffb347,
  cyan: 0x3de8ff,
  plus: 0x2ef2c8,
  minus: 0xb36bff,
  alive: 0xff2a2a,
};

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function speckle(g: CanvasRenderingContext2D, s: number, n: number, light: number, dark: number): void {
  for (let i = 0; i < n; i++) {
    const v = Math.random() < 0.5 ? light : dark;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.18})`;
    const r = Math.random() * 3 + 0.5;
    g.fillRect(Math.random() * s, Math.random() * s, r, r);
  }
}

export function wallTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#4a4f55'; g.fillRect(0, 0, s, s);
    speckle(g, s, 5000, 200, 20);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
    for (let y = 0; y <= s; y += s / 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
    for (let row = 0; row < 4; row++) {
      for (let x = (row % 2) * (s / 4); x <= s; x += s / 2) {
        g.beginPath(); g.moveTo(x, row * s / 4); g.lineTo(x, (row + 1) * s / 4); g.stroke();
      }
    }
    const grime = g.createLinearGradient(0, s * 0.6, 0, s);
    grime.addColorStop(0, 'rgba(20,30,15,0)'); grime.addColorStop(1, 'rgba(20,30,15,0.55)');
    g.fillStyle = grime; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(110,10,10,0.35)';
    for (let i = 0; i < 3; i++) { const x = Math.random() * s; g.fillRect(x, s * 0.55 + Math.random() * 40, 3 + Math.random() * 4, 30 + Math.random() * 60); }
  });
}

export function floorTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#2b2e30'; g.fillRect(0, 0, s, s);
    speckle(g, s, 6000, 160, 10);
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 4;
    g.strokeRect(0, 0, s, s);
    g.strokeStyle = 'rgba(255,255,255,0.04)'; g.lineWidth = 2;
    g.strokeRect(6, 6, s - 12, s - 12);
    g.fillStyle = 'rgba(70,5,5,0.4)';
    if (Math.random() < 1) { g.beginPath(); g.ellipse(s * 0.3, s * 0.6, 30, 18, 0.4, 0, Math.PI * 2); g.fill(); }
  });
}

// ---------------------------------------------------------------- zombie
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const ringGeo = new THREE.RingGeometry(0.35, 0.55, 24);
const EYE_MATS: Record<Eigen, THREE.MeshBasicMaterial> = {
  alive: new THREE.MeshBasicMaterial({ color: COLORS.alive }),
  dead: new THREE.MeshBasicMaterial({ color: 0x111111 }),
  plus: new THREE.MeshBasicMaterial({ color: COLORS.plus }),
  minus: new THREE.MeshBasicMaterial({ color: COLORS.minus }),
  other: new THREE.MeshBasicMaterial({ color: 0xffffff }),
};
const CLOTH = [0x3d4a5c, 0x5a4636, 0x3f5240, 0x553040, 0x4a4a4a];

function part(mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}

export class ZombieView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly eyes: THREE.Mesh;
  private readonly aura: THREE.Mesh;
  private readonly skin: THREE.MeshStandardMaterial;
  private readonly cloth: THREE.MeshStandardMaterial;
  private readonly auraMat: THREE.MeshBasicMaterial;
  private fall = 0;
  private phase = Math.random() * 10;
  private flash = 0;

  constructor(seed: number) {
    const hue = 0.22 + ((seed * 37) % 10) / 100;
    this.skin = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.25, 0.42), roughness: 0.85, transparent: true });
    this.cloth = new THREE.MeshStandardMaterial({ color: CLOTH[seed % CLOTH.length]!, roughness: 0.95, transparent: true });
    this.auraMat = new THREE.MeshBasicMaterial({ color: COLORS.plus, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
    this.body.add(part(this.cloth, 0.55, 0.62, 0.3, 0, 1.15, 0)); // torso
    this.head = part(this.skin, 0.36, 0.36, 0.36, 0, 1.66, 0.02);
    this.body.add(this.head);
    this.eyes = part(EYE_MATS.alive, 0.24, 0.06, 0.02, 0, 1.69, 0.2);
    this.body.add(this.eyes);
    for (const [g, x] of [[this.armL, -0.36], [this.armR, 0.36]] as const) {
      g.position.set(x, 1.42, 0);
      g.add(part(this.skin, 0.15, 0.62, 0.15, 0, -0.3, 0));
      this.body.add(g);
    }
    for (const [g, x] of [[this.legL, -0.14], [this.legR, 0.14]] as const) {
      g.position.set(x, 0.84, 0);
      g.add(part(this.cloth, 0.2, 0.84, 0.2, 0, -0.42, 0));
      this.body.add(g);
    }
    this.aura = new THREE.Mesh(ringGeo, this.auraMat);
    this.aura.rotation.x = -Math.PI / 2;
    this.aura.position.y = 0.03;
    this.root.add(this.body, this.aura);
    this.root.traverse(o => { o.castShadow = false; });
  }

  hitFlash(): void { this.flash = 0.12; }

  update(dt: number, state: Eigen, speed: number, time: number): void {
    const lying = state === 'dead';
    const target = lying ? 1 : 0;
    const rate = lying ? 3.2 : 1.6; // getting up is slower than falling
    this.fall += Math.sign(target - this.fall) * Math.min(Math.abs(target - this.fall), rate * dt);
    this.body.rotation.x = -this.fall * Math.PI / 2;
    this.body.position.y = this.fall * 0.15;

    this.phase += dt * (1.5 + speed * 2.6);
    const swing = Math.sin(this.phase) * Math.min(1, speed / 1.2) * 0.7;
    this.legL.rotation.x = swing; this.legR.rotation.x = -swing;
    const reach = state === 'alive' ? -1.45 : state === 'dead' ? 0 : -0.8;
    this.armL.rotation.x = reach + Math.sin(this.phase * 0.5) * 0.12;
    this.armR.rotation.x = reach - Math.sin(this.phase * 0.5 + 1) * 0.12;
    this.head.rotation.z = Math.sin(time * 1.3 + this.phase) * (state === 'alive' ? 0.08 : 0.25);

    const undecided = state === 'plus' || state === 'minus' || state === 'other';
    const tint = state === 'minus' ? COLORS.minus : COLORS.plus;
    const op = undecided ? 0.32 + 0.22 * (0.5 + 0.5 * Math.sin(time * 9 + this.phase * 3)) * (Math.random() < 0.06 ? 0.2 : 1) : 1;
    for (const m of [this.skin, this.cloth]) {
      m.opacity = op;
      m.depthWrite = !undecided;
      m.emissive.setHex(this.flash > 0 ? 0xffffff : undecided ? tint : 0x000000);
      m.emissiveIntensity = this.flash > 0 ? 0.9 : undecided ? 0.55 : 0;
    }
    this.flash = Math.max(0, this.flash - dt);
    this.eyes.material = EYE_MATS[state];
    this.aura.visible = undecided;
    this.auraMat.color.setHex(tint);
    this.aura.scale.setScalar(1 + 0.12 * Math.sin(time * 4 + this.phase));
  }

  dispose(): void {
    this.skin.dispose(); this.cloth.dispose(); this.auraMat.dispose();
  }
}

// ---------------------------------------------------------------- guns
export interface GunModel { group: THREE.Group; muzzle: THREE.Object3D; flash: THREE.Mesh }

function flashMesh(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  m.visible = false;
  return m;
}

export function makeCarbine(): GunModel {
  const metal = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.45, metalness: 0.3 });
  const polymer = new THREE.MeshStandardMaterial({ color: 0x5a6045, roughness: 0.8 });
  const group = new THREE.Group();
  group.add(part(polymer, 0.07, 0.09, 0.42, 0, 0, 0));           // receiver
  group.add(part(metal, 0.035, 0.035, 0.32, 0, 0.015, -0.36));  // barrel
  group.add(part(polymer, 0.06, 0.065, 0.2, 0, -0.005, -0.25)); // handguard
  group.add(part(metal, 0.045, 0.15, 0.07, 0, -0.11, -0.04));   // mag
  group.add(part(polymer, 0.05, 0.11, 0.06, 0, -0.09, 0.13));   // grip
  group.add(part(polymer, 0.06, 0.08, 0.18, 0, -0.01, 0.28));   // stock
  group.add(part(metal, 0.03, 0.03, 0.06, 0, 0.065, 0.02));     // rear sight
  group.add(part(metal, 0.012, 0.04, 0.012, 0, 0.055, -0.33));  // front post
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.015, -0.54); group.add(muzzle);
  const flash = flashMesh(); flash.position.copy(muzzle.position); group.add(flash);
  return { group, muzzle, flash };
}

export function makeMarksman(): GunModel {
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.4, metalness: 0.3 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.7 });
  const group = new THREE.Group();
  group.add(part(wood, 0.075, 0.09, 0.62, 0, -0.01, 0.02));
  group.add(part(metal, 0.03, 0.03, 0.5, 0, 0.02, -0.52));
  group.add(part(metal, 0.06, 0.06, 0.26, 0, 0.1, -0.05));   // scope tube
  group.add(part(metal, 0.075, 0.075, 0.05, 0, 0.1, -0.19)); // objective bell
  group.add(part(metal, 0.02, 0.05, 0.02, 0.05, 0.03, 0.04)); // bolt handle
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, -0.78); group.add(muzzle);
  const flash = flashMesh(); flash.position.copy(muzzle.position); group.add(flash);
  return { group, muzzle, flash };
}

// ---------------------------------------------------------------- terminal
export type ScreenMode = { kind: 'dark' } | { kind: 'cyan' | 'amber'; outcomes: (0 | 1)[]; corrupt?: number } | { kind: 'reencode'; seconds: number };

export class TerminalView {
  readonly root = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly tex: THREE.CanvasTexture;
  private readonly lamp: THREE.PointLight;
  private last = '';

  constructor(facing: THREE.Vector3, label: string) {
    this.canvas.width = 512; this.canvas.height = 256;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const caseMat = new THREE.MeshStandardMaterial({ color: 0x30353a, roughness: 0.6, metalness: 0.4 });
    const cab = new THREE.Mesh(boxGeo, caseMat);
    cab.scale.set(1.9, 2.4, 1.9);
    cab.position.y = 1.2;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: this.tex }));
    screen.position.set(0, 1.65, 0.96);
    const sign = new THREE.Group();
    sign.add(screen);
    sign.lookAt(facing);
    this.root.add(cab, sign);
    this.lamp = new THREE.PointLight(0x3355aa, 3, 7, 1.5);
    this.lamp.position.set(facing.x * 1.6, 2.2, facing.z * 1.6);
    this.root.add(this.lamp);
    this.label = label;
    this.draw({ kind: 'dark' });
  }
  private label: string;

  draw(mode: ScreenMode, progress = -1): void {
    const key = JSON.stringify(mode) + Math.round(progress * 100);
    if (key === this.last) return;
    this.last = key;
    const g = this.canvas.getContext('2d')!;
    const W = 512, H = 256;
    g.fillStyle = '#05080a'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(80,140,160,0.08)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2);
    g.font = 'bold 26px monospace'; g.fillStyle = '#6b8a96';
    g.fillText(this.label, 20, 36);
    if (mode.kind === 'dark') {
      g.fillStyle = '#26323a'; g.font = 'bold 30px monospace';
      g.fillText('▒▒ SHINE TO READ ▒▒', 80, 150);
      this.lamp.color.setHex(0x3355aa);
    } else if (mode.kind === 'reencode') {
      g.fillStyle = '#ff5544'; g.font = 'bold 30px monospace';
      g.fillText('SIGNAL CORRUPTED', 110, 120);
      g.fillText(`RE-ENCODING ${Math.ceil(mode.seconds)}s`, 120, 170);
      this.lamp.color.setHex(0xff3322);
    } else {
      const cyan = mode.kind === 'cyan';
      mode.outcomes.forEach((o, i) => {
        const cx = 80 + i * 118, cy = 145;
        g.lineWidth = 9;
        if (cyan) {
          g.strokeStyle = o === 0 ? '#2ef2c8' : '#b36bff';
          g.beginPath();
          if (o === 0) g.arc(cx, cy, 38, 0, Math.PI * 2);
          else { g.moveTo(cx, cy - 44); g.lineTo(cx + 40, cy); g.lineTo(cx, cy + 44); g.lineTo(cx - 40, cy); g.closePath(); }
          g.stroke();
        } else {
          g.fillStyle = '#ffb347'; g.font = 'bold 90px monospace';
          g.fillText(String(o), cx - 26, cy + 32);
        }
      });
      this.lamp.color.setHex(cyan ? 0x3de8ff : 0xffb347);
      if (mode.corrupt) {
        g.fillStyle = '#ff5544'; g.font = 'bold 22px monospace';
        g.fillText(`CORRUPTED · RE-ENCODE ${Math.ceil(mode.corrupt)}s`, 210, 36);
      }
    }
    if (progress >= 0) {
      g.fillStyle = '#1a2a30'; g.fillRect(20, 214, W - 40, 22);
      g.fillStyle = '#3de8ff'; g.fillRect(20, 214, (W - 40) * Math.min(1, progress), 22);
    }
    this.tex.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- door, beacon, pickups
export function makeDoor(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3b3f44'; g.fillRect(0, 0, 128, 128);
  for (let i = -128; i < 256; i += 32) {
    g.fillStyle = '#c9a227';
    g.beginPath(); g.moveTo(i, 128); g.lineTo(i + 16, 128); g.lineTo(i + 16 + 40, 88); g.lineTo(i + 40, 88); g.fill();
  }
  g.fillStyle = '#ff3b30'; g.fillRect(52, 30, 24, 24);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ map: tex, metalness: 0.5, roughness: 0.5 }));
  m.scale.set(2, 3, 2);
  return m;
}

export function makeBeacon(): { group: THREE.Group; setActive(a: boolean): void } {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 14, 20, 1, true), mat);
  beam.position.y = 7;
  const pad = new THREE.Mesh(new THREE.CircleGeometry(1.2, 24), new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: 0.5 }));
  pad.rotation.x = -Math.PI / 2; pad.position.y = 0.02;
  const light = new THREE.PointLight(0x3dff7a, 6, 12, 1.4);
  light.position.y = 2;
  group.add(beam, pad, light);
  return {
    group,
    setActive(a: boolean) {
      const col = a ? 0x3dff7a : 0xff3322;
      mat.color.setHex(col); (pad.material as THREE.MeshBasicMaterial).color.setHex(col); light.color.setHex(col);
      mat.opacity = a ? 0.25 : 0.08;
    },
  };
}

export function makePickup(kind: 'med' | 'ammo'): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'med') {
    g.add(part(new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: 0x333333 }), 0.5, 0.3, 0.35, 0, 0, 0));
    const red = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    g.add(part(red, 0.3, 0.08, 0.36, 0, 0, 0), part(red, 0.08, 0.31, 0.36, 0, 0, 0));
  } else {
    g.add(part(new THREE.MeshStandardMaterial({ color: 0x4b5320, emissive: 0x1a1f05 }), 0.55, 0.3, 0.32, 0, 0, 0));
    g.add(part(new THREE.MeshBasicMaterial({ color: 0xffd23f }), 0.3, 0.06, 0.33, 0, 0.05, 0));
  }
  const l = new THREE.PointLight(kind === 'med' ? 0xff6666 : 0xffd23f, 1.5, 4, 1.5);
  l.position.y = 0.6; g.add(l);
  return g;
}

// ---------------------------------------------------------------- floodlights, helicopter, blood
export function makeLamp(basis: 'Z' | 'X'): { group: THREE.Group; light: THREE.SpotLight; setOn(on: boolean): void } {
  const col = basis === 'Z' ? COLORS.amber : COLORS.cyan;
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.5 });
  g.add(part(metal, 0.12, 4.6, 0.12, 0, 2.3, 0));
  g.add(part(metal, 0.9, 0.12, 0.12, 0.4, 4.55, 0));
  const lensMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  const lens = part(lensMat, 0.5, 0.12, 0.5, 0.8, 4.45, 0);
  g.add(lens);
  const box = part(new THREE.MeshStandardMaterial({ color: 0x3a3f44, emissive: col, emissiveIntensity: 0.25 }), 0.3, 0.4, 0.15, 0, 1.2, 0.12);
  g.add(box);
  const light = new THREE.SpotLight(col, 0, 16, 0.95, 0.5, 1.2);
  light.position.set(0.8, 4.4, 0);
  light.target.position.set(0.8, 0, 0);
  g.add(light, light.target);
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(3.6, 4.4, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  cone.position.set(0.8, 2.2, 0);
  g.add(cone);
  return {
    group: g, light,
    setOn(on: boolean) {
      light.intensity = on ? 70 : 0;
      lensMat.color.setHex(on ? col : 0x222222);
      cone.visible = on;
    },
  };
}

export function makeHeli(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.5, metalness: 0.3 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.8 });
  g.add(part(body, 2.2, 1.7, 4.2, 0, 1.4, 0));
  g.add(part(glass, 2.0, 1.0, 1.0, 0, 1.7, -2.2));
  g.add(part(red, 2.25, 0.3, 4.25, 0, 1.0, 0));
  g.add(part(body, 0.5, 0.5, 4.5, 0, 1.8, 4.2));
  g.add(part(red, 0.12, 1.4, 0.8, 0, 2.4, 6.3));
  g.add(part(body, 0.15, 0.15, 3.8, -0.9, 0.2, 0), part(body, 0.15, 0.15, 3.8, 0.9, 0.2, 0));
  const rotor = new THREE.Group();
  rotor.name = 'rotor';
  rotor.add(part(new THREE.MeshStandardMaterial({ color: 0x222222 }), 11, 0.06, 0.35, 0, 0, 0), part(new THREE.MeshStandardMaterial({ color: 0x222222 }), 0.35, 0.06, 11, 0, 0, 0));
  rotor.position.y = 2.45;
  g.add(rotor);
  const beacon = new THREE.PointLight(0xff2020, 6, 14, 1.5);
  beacon.position.set(0, 3, 0);
  g.add(beacon);
  const spot = new THREE.SpotLight(0xffffff, 120, 40, 0.5, 0.4, 1);
  spot.position.set(0, 0.5, -2);
  spot.target.position.set(0, -10, -4);
  g.add(spot, spot.target);
  return g;
}

const bloodTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(${70 + Math.random() * 40},0,0,${0.35 + Math.random() * 0.4})`;
    g.beginPath();
    g.ellipse(64 + (Math.random() - 0.5) * 60, 64 + (Math.random() - 0.5) * 60, 6 + Math.random() * 26, 4 + Math.random() * 16, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

export function makeBlood(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshStandardMaterial({ map: bloodTex, transparent: true, depthWrite: false, roughness: 0.3 }));
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = Math.random() * Math.PI * 2;
  m.position.y = 0.015;
  return m;
}
