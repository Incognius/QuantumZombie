// The running mission: fixed-step simulation + three.js rendering.
// Every qubit change goes through src/game/rules.ts — this file only decides
// *when* a light, floodlight, bullet or bite touches something.
import * as THREE from 'three';
import { eigen } from '../quantum/qubit';
import type { Basis, Eigen } from '../quantum/qubit';
import { seededRandom } from '../quantum/random';
import {
  bulletHit, contact, isIntact, kill, lightTarget, lightTerminal, makeTerminal, reencode, sameCode, spawnState,
} from '../game/rules';
import type { TerminalQ, Transition } from '../game/rules';
import { Grid, TILE, cellOf, center, flowDirection, flowField, parseMap } from '../game/grid';
import type { Cell, ParsedMap, Point } from '../game/grid';
import type { Mission, StepCtx } from '../levels';
import { Hud, codeHtml } from '../ui/hud';
import type { Filter, HudState } from '../ui/hud';
import { Sfx } from './audio';
import { Music } from './music';
import {
  COLORS, TerminalView, ZombieView, floorTexture, makeBeacon, makeBlood, makeCarbine, makeDoor, makeHeli, makeLamp, makeMarksman, makePickup, wallTexture,
} from './models';
import type { GunModel, ScreenMode } from './models';
import { RiggedZombie } from './zombieModels';
import type { ZombieModel, ZombieRig } from './zombieModels';

const STEP = 1 / 60;
const EYE = 1.62;
const PLAYER_R = 0.35;
const ZOMBIE_R = 0.32;
const LIGHT_RANGE = 18;
const LIGHT_HALF_ANGLE = 0.36; // rad (~21°)
const COS_HALF = Math.cos(LIGHT_HALF_ANGLE);
const LAMP_RADIUS = 7.5;
const BASE_FOV = 75;

export interface Stats {
  time: number;
  shots: number;
  hits: number;
  headshots: number;
  kills: number;
  amberDropped: number;
  amberWoke: number;
  cyanRaised: number;
  raisedCameBackAlive: number;
  bulletsAsked: number;
  bites: number;
  scrambles: number;
  wrongCodes: number;
}

export type EndResult = 'win' | 'dead';

interface WeaponDef {
  name: string; damage: number; interval: number; auto: boolean; magSize: number;
  reload: number; hipSpread: number; adsSpread: number; bloom: number; recoil: number; adsFov: number; scope: boolean;
}
const WEAPONS: WeaponDef[] = [
  { name: 'CARBINE', damage: 34, interval: 0.1, auto: true, magSize: 30, reload: 1.8, hipSpread: 0.022, adsSpread: 0.006, bloom: 0.007, recoil: 0.014, adsFov: 50, scope: false },
  { name: 'MARKSMAN', damage: 110, interval: 0.9, auto: false, magSize: 5, reload: 2.4, hipSpread: 0.07, adsSpread: 0.0006, bloom: 0.03, recoil: 0.06, adsFov: 16, scope: true },
];

interface WeaponState { mag: number; cooldown: number; reloadT: number; bloom: number }

interface Zombie {
  id: number;
  x: number; z: number;
  theta: number;
  hp: number;
  view: ZombieRig;
  biteCd: number;
  stun: number;
  raised: boolean;
  changedAt: number;
  facing: number;
  speed: number;
  attacking: number;
}

interface Terminal {
  q: TerminalQ; view: TerminalView; pos: Point; cell: Cell; label: string; uplink: number;
  reencodeT: number; readHold: number; litT: number; lastMode: ScreenMode; known: (0 | 1)[] | null;
}
interface Lamp { basis: Basis; label: string; pos: Point; on: boolean; poweredByDoor?: number; view: ReturnType<typeof makeLamp> }
interface Door { cell: Cell; label: string; needs: number[]; mesh: THREE.Mesh; open: boolean; openT: number }
interface Pickup { pos: Point; obj: THREE.Group; respawn: number }
interface Fx { obj: THREE.Object3D; life: number; max: number }

export interface GameOptions {
  mission: Mission;
  container: HTMLElement;
  debug: boolean;
  sfx: Sfx;
  music: Music;
  models: ZombieModel[];
  sensitivity: number;
  onEnd: (r: EndResult, s: Stats) => void;
  onPauseChange: (paused: boolean) => void;
}

export class Game {
  readonly mission: Mission;
  readonly stats: Stats = { time: 0, shots: 0, hits: 0, headshots: 0, kills: 0, amberDropped: 0, amberWoke: 0, cyanRaised: 0, raisedCameBackAlive: 0, bulletsAsked: 0, bites: 0, scrambles: 0, wrongCodes: 0 };
  private readonly opts: GameOptions;
  private readonly rng: () => number;
  private readonly map: ParsedMap;
  private readonly grid: Grid;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 200);
  private readonly vmScene = new THREE.Scene();
  private readonly vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  private readonly flashlight: THREE.SpotLight;
  private readonly hud: Hud;
  private readonly sfx: Sfx;
  private readonly music: Music;
  private readonly guns: GunModel[];
  private readonly spawnCap: { cap: number };

  // player
  private pos: Point;
  private y = 0;
  private vy = 0;
  private vel = { x: 0, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private recoil = 0;
  private shake = 0;
  private hp = 100;
  private bob = 0;
  private weapon = 0;
  private readonly wstate: WeaponState[];
  private adsT = 0;
  private swapT = 0;
  private filter: Filter = 'off';
  private battery = 100;
  private batteryLock = false;

  // world
  private zombies: Zombie[] = [];
  private nextId = 1;
  private flow: Int32Array;
  private flowT = 0;
  private spawnAcc = 0;
  private time = 0;
  private terms: Terminal[] = [];
  private lamps: Lamp[] = [];
  private doors: Door[] = [];
  private exitPos: Point | null;
  private exitObj: THREE.Object3D | null = null;
  private beacon: ReturnType<typeof makeBeacon> | null = null;
  private heliY = 30;
  private stepIdx = -1;
  private uplink = 0;
  private pickups: Pickup[] = [];
  private fx: Fx[] = [];
  private flickers: { light: THREE.PointLight; base: number; phase: number }[] = [];
  private tipsShown = new Set<string>();

  // loop/input
  private keys = new Set<string>();
  private mouseL = false;
  private mouseR = false;
  private firedThisPress = false;
  private acc = 0;
  private lastFrame = 0;
  private raf = 0;
  private ended = false;
  paused = false;
  private disposers: (() => void)[] = [];

  constructor(opts: GameOptions) {
    this.opts = opts;
    this.sfx = opts.sfx;
    this.music = opts.music;
    this.mission = opts.mission;
    this.spawnCap = { cap: opts.mission.spawn.cap };
    this.rng = seededRandom(opts.mission.seed ^ (Date.now() & 0xffff));
    this.map = parseMap(this.mission.map);
    this.grid = new Grid(this.map.w, this.map.h, this.map.solid);
    this.pos = { ...this.map.start };
    this.exitPos = this.map.exits[0] ?? null;
    this.wstate = WEAPONS.map(w => ({ mag: w.magSize, cooldown: 0, reloadT: -1, bloom: 0 }));

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: opts.debug });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.autoClear = false;
    this.renderer.domElement.className = 'game-canvas';
    opts.container.appendChild(this.renderer.domElement);
    this.hud = new Hud(opts.container);

    this.scene.background = new THREE.Color(0x020304);
    this.scene.fog = new THREE.FogExp2(0x020304, 0.06);
    this.scene.add(new THREE.HemisphereLight(0x33405a, 0x0a0808, 0.7));
    const playerGlow = new THREE.PointLight(0x46506a, 1.6, 6, 1.6);
    this.camera.add(playerGlow);
    this.flashlight = new THREE.SpotLight(0xffffff, 0, LIGHT_RANGE + 6, LIGHT_HALF_ANGLE * 1.15, 0.35, 1.1);
    this.flashlight.position.set(0.25, -0.15, 0);
    this.flashlight.target.position.set(0, 0, -1);
    this.camera.add(this.flashlight, this.flashlight.target);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.buildWorld();
    this.flow = flowField(this.grid, cellOf(this.pos));

    this.vmScene.add(new THREE.HemisphereLight(0x9aaacc, 0x222222, 2.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(1, 2, 1); this.vmScene.add(key);
    this.guns = [makeCarbine(), makeMarksman()];
    for (const g of this.guns) { g.group.scale.setScalar(0.42); this.vmScene.add(g.group); }

    this.yaw = this.initialYaw();
    this.bindInput();
    this.resize();
    if (opts.debug) this.installDebug();
    this.advanceStep();
  }

  // ------------------------------------------------------------------ world
  private initialYaw(): number {
    let best = 0, bestD = -1;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const d = this.grid.rayDistance(this.pos.x, this.pos.z, -Math.sin(ang), -Math.cos(ang), 60);
      if (d > bestD) { bestD = d; best = ang; }
    }
    return best;
  }

  private buildWorld(): void {
    const { w, h } = this.map;
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.92 });
    const special = (x: number, y: number) => this.map.doors.some(d => d.x === x && d.y === y) || this.map.terminals.some(t => t && cellOf(t).x === x && cellOf(t).y === y);
    const wallAt = (x: number, y: number) => this.map.solid[y * w + x] === 1 && !special(x, y);
    const nearFloor = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => {
      const nx = x + dx!, ny = y + dy!;
      return nx >= 0 && ny >= 0 && nx < w && ny < h && this.map.solid[ny * w + nx] === 0;
    });
    let walls = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (wallAt(x, y) && nearFloor(x, y)) walls++;
    const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, 3.6, TILE), wallMat, walls);
    const m4 = new THREE.Matrix4();
    let i = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!wallAt(x, y) || !nearFloor(x, y)) continue;
      const c = center({ x, y });
      m4.makeTranslation(c.x, 1.8, c.z);
      wallMesh.setMatrixAt(i++, m4);
    }
    this.scene.add(wallMesh);

    const ft = floorTexture();
    ft.repeat.set(w, h);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w * TILE, h * TILE), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((w * TILE) / 2, 0, (h * TILE) / 2);
    this.scene.add(floor);
    if (this.mission.exitKind !== 'heli') {
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w * TILE, h * TILE), new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 1 }));
      ceil.rotation.x = Math.PI / 2;
      ceil.position.set((w * TILE) / 2, 3.6, (h * TILE) / 2);
      this.scene.add(ceil);
    }

    const lr = seededRandom(this.mission.seed);
    for (let k = 0; k < 7; k++) {
      const x = 1 + Math.floor(lr() * (w - 2)), y = 1 + Math.floor(lr() * (h - 2));
      if (this.map.solid[y * w + x]) continue;
      const c = center({ x, y });
      const l = new THREE.PointLight(0xffa060, 1.5, 7, 1.6);
      l.position.set(c.x, 3.2, c.z);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07), new THREE.MeshBasicMaterial({ color: 0xffcc88 }));
      bulb.position.copy(l.position);
      this.scene.add(l, bulb);
      this.flickers.push({ light: l, base: 1.5, phase: lr() * 100 });
    }

    for (const p of this.map.corpses) { this.spawnZombie(p, 0, 'dead'); if (lr() < 0.7) this.addBlood(p); }
    for (const p of this.map.plus) this.spawnZombie(p, 0, 'plus');
    for (const p of this.map.minus) this.spawnZombie(p, 0, 'minus');
    for (const p of this.map.runners) this.spawnZombie(p, 0, 'alive');
    for (let k = 0; k < 6; k++) {
      const x = 1 + Math.floor(lr() * (w - 2)), y = 1 + Math.floor(lr() * (h - 2));
      if (!this.map.solid[y * w + x]) this.addBlood(center({ x, y }));
    }

    this.mission.terminals.forEach((def, idx) => {
      const t = this.map.terminals[idx];
      if (!t) return;
      const cell = cellOf(t);
      let face = new THREE.Vector3(0, 0, 1);
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        if (!this.grid.isSolid(cell.x + dx, cell.y + dy)) { face = new THREE.Vector3(dx, 0, dy); break; }
      }
      const view = new TerminalView(face, def.label);
      view.root.position.set(t.x, 0, t.z);
      this.scene.add(view.root);
      const code = Array.from({ length: def.symbols }, () => (this.rng() < 0.5 ? 0 : 1) as 0 | 1);
      this.terms.push({ q: makeTerminal(code), view, pos: t, cell, label: def.label, uplink: def.uplink ?? 0, reencodeT: 0, readHold: 0, litT: 99, lastMode: { kind: 'dark' }, known: null });
    });
    this.map.doors.forEach((d, idx) => {
      const def = this.mission.doors[idx]!;
      const mesh = makeDoor();
      const c = center(d);
      mesh.position.set(c.x, 1.5, c.z);
      this.scene.add(mesh);
      this.doors.push({ cell: d, label: def.label, needs: def.needs, mesh, open: false, openT: 0 });
    });
    this.map.lamps.forEach((l, idx) => {
      const def = this.mission.lamps[idx]!;
      const view = makeLamp(def.basis);
      view.group.position.set(l.pos.x - 0.8, 0, l.pos.z);
      view.setOn(!!def.on);
      this.scene.add(view.group);
      this.lamps.push({ basis: def.basis, label: def.label, pos: l.pos, on: !!def.on, poweredByDoor: def.poweredByDoor, view });
    });
    if (this.exitPos) {
      if (this.mission.exitKind === 'heli') {
        this.exitObj = makeHeli();
        this.exitObj.position.set(this.exitPos.x, this.heliY, this.exitPos.z);
        this.exitObj.visible = false;
        this.scene.add(this.exitObj);
      }
      this.beacon = makeBeacon();
      this.beacon.group.position.set(this.exitPos.x, 0, this.exitPos.z);
      this.beacon.group.visible = false;
      this.scene.add(this.beacon.group);
    }
    for (const p of this.map.medkits) {
      const obj = makePickup('med');
      obj.position.set(p.x, 0.5, p.z);
      this.scene.add(obj);
      this.pickups.push({ pos: p, obj, respawn: 0 });
    }
  }

  private addBlood(p: Point): void {
    const b = makeBlood();
    b.position.x = p.x + (this.rng() - 0.5); b.position.z = p.z + (this.rng() - 0.5);
    this.scene.add(b);
  }

  private spawnZombie(p: Point, jitter: number, state: Eigen | 0 | 1): Zombie {
    const theta = state === 'dead' ? 0 : state === 'alive' ? Math.PI : state === 'plus' ? spawnState(0) : state === 'minus' ? spawnState(1)
      : spawnState(state as 0 | 1);
    const id = this.nextId++;
    const models = this.opts.models;
    const view: ZombieRig = models.length ? new RiggedZombie(models[id % models.length]!, id) : new ZombieView(id);
    const z: Zombie = {
      id, x: p.x + (this.rng() - 0.5) * jitter, z: p.z + (this.rng() - 0.5) * jitter,
      theta, hp: 100, view, biteCd: 0, stun: 0, raised: false, changedAt: -99, facing: this.rng() * Math.PI * 2, speed: 0, attacking: 0,
    };
    this.grid.collide(z, ZOMBIE_R);
    view.root.position.set(z.x, 0, z.z);
    view.update(0.001, eigen(theta), 0, 0, false);
    if (eigen(theta) === 'dead') view.update(10, 'dead', 0, 0, false);
    this.scene.add(view.root);
    this.zombies.push(z);
    return z;
  }

  // ------------------------------------------------------------------ steps / story
  private ctx(): StepCtx {
    const near = (m: string, r: number) => { const p = this.map.markers[m]; return !!p && Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < r; };
    return {
      filter: this.filter,
      read: i => !!this.terms[i]?.known && sameCode(this.terms[i]!.known, this.terms[i]!.q.code),
      door: i => !!this.doors[i]?.open,
      lamp: i => !!this.lamps[i]?.on,
      near,
      zone: (m, r) => {
        const p = this.map.markers[m];
        const out = { dead: 0, alive: 0, undecided: 0 };
        if (!p) return out;
        for (const z of this.zombies) {
          if (Math.hypot(z.x - p.x, z.z - p.z) > r) continue;
          const e = eigen(z.theta);
          if (e === 'dead') out.dead++; else if (e === 'alive') out.alive++; else out.undecided++;
        }
        return out;
      },
      raised: this.stats.cyanRaised,
      uplink: this.uplink,
      stats: this.stats,
    };
  }

  private get step(): Mission['steps'][number] | undefined { return this.mission.steps[this.stepIdx]; }

  private advanceStep(): void {
    this.stepIdx++;
    const s = this.step;
    if (!s) return;
    if (s.radio) this.hud.radio(s.radio);
    if (this.stepIdx > 0) this.sfx.good();
    if (s.exit) {
      if (this.beacon) { this.beacon.group.visible = this.mission.exitKind !== 'heli'; this.beacon.setActive(true); }
      if (this.exitObj) this.exitObj.visible = true;
    }
  }

  private stepObjective(): void {
    const s = this.step;
    if (!s) return;
    if (s.exit) {
      const e = this.exitPos;
      const ready = this.mission.exitKind !== 'heli' || this.heliY < 0.3;
      if (e && ready && Math.hypot(e.x - this.pos.x, e.z - this.pos.z) < (this.mission.exitKind === 'heli' ? 3.2 : 1.7)) this.end('win');
      return;
    }
    for (let guard = 0; guard < 4 && this.step && !this.step.exit && this.step.done(this.ctx()); guard++) this.advanceStep();
  }

  // ------------------------------------------------------------------ input
  private bindInput(): void {
    const on = <K extends keyof DocumentEventMap>(t: K, f: (e: DocumentEventMap[K]) => void) => {
      document.addEventListener(t, f as EventListener);
      this.disposers.push(() => document.removeEventListener(t, f as EventListener));
    };
    on('keydown', e => {
      if (e.code === 'Tab') { e.preventDefault(); this.hud.guide(true); }
      if (this.paused || this.ended || e.repeat) return;
      this.keys.add(e.code);
      this.onKey(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    on('keyup', e => { this.keys.delete(e.code); if (e.code === 'Tab') this.hud.guide(false); });
    on('mousedown', e => {
      if (this.paused || this.ended || !this.locked()) return;
      if (e.button === 0) { this.mouseL = true; this.firedThisPress = false; }
      if (e.button === 2) this.mouseR = true;
    });
    on('mouseup', e => {
      if (e.button === 0) this.mouseL = false;
      if (e.button === 2) this.mouseR = false;
    });
    on('mousemove', e => {
      if (this.paused || this.ended || !this.locked()) return;
      const sens = 0.0022 * this.opts.sensitivity * (this.camera.fov / BASE_FOV);
      this.yaw -= e.movementX * sens;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * sens));
    });
    on('contextmenu', e => e.preventDefault());
    on('pointerlockchange', () => {
      if (this.opts.debug || this.ended) return;
      const p = !this.locked();
      if (p !== this.paused) { this.paused = p; this.keys.clear(); this.mouseL = this.mouseR = false; this.opts.onPauseChange(p); }
    });
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    this.disposers.push(() => window.removeEventListener('resize', onResize));
  }

  private locked(): boolean { return this.opts.debug || document.pointerLockElement === this.renderer.domElement; }

  requestLock(): void {
    if (this.opts.debug) return;
    try {
      const r = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => { /* needs a click first; the HUD says so */ });
    } catch { /* older browsers throw synchronously */ }
  }

  private onKey(code: string): void {
    switch (code) {
      case 'KeyZ': this.setFilter(this.filter === 'Z' ? 'off' : 'Z'); break;
      case 'KeyX': this.setFilter(this.filter === 'X' ? 'off' : 'X'); break;
      case 'KeyF': this.setFilter('off'); break;
      case 'KeyR': this.startReload(); break;
      case 'Digit1': this.switchWeapon(0); break;
      case 'Digit2': this.switchWeapon(1); break;
      case 'KeyQ': this.switchWeapon(1 - this.weapon); break;
      case 'KeyE': this.interact(); break;
    }
  }

  setFilter(f: Filter): void {
    if (f !== 'off' && this.batteryLock) { this.sfx.dry(); this.tipOnce('battery', 'The flashlight battery is recharging. It charges while the light is off.'); return; }
    if (f === this.filter) return;
    this.filter = f;
    this.sfx.click();
  }

  private switchWeapon(i: number): void {
    if (i === this.weapon) return;
    this.weapon = i;
    this.swapT = 0.35;
    this.wstate[i]!.reloadT = -1;
    this.sfx.bolt();
  }

  private startReload(): void {
    const w = WEAPONS[this.weapon]!, s = this.wstate[this.weapon]!;
    if (s.reloadT >= 0 || s.mag >= w.magSize) return;
    s.reloadT = 0;
    this.sfx.reload();
  }

  private nearestInteractable(): { kind: 'door'; d: Door } | { kind: 'lamp'; l: Lamp } | null {
    for (const d of this.doors) {
      if (d.open) continue;
      const c = center(d.cell);
      if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < 3.2) return { kind: 'door', d };
    }
    for (const l of this.lamps) if (Math.hypot(l.pos.x - this.pos.x, l.pos.z - this.pos.z) < 2.6) return { kind: 'lamp', l };
    return null;
  }

  private interact(): void {
    const it = this.nearestInteractable();
    if (!it) return;
    if (it.kind === 'lamp') {
      it.l.on = !it.l.on;
      it.l.view.setOn(it.l.on);
      this.sfx.click();
      if (it.l.on && it.l.basis === 'Z') this.tipOnce('lampZ', 'An <b class="c-amber">amber</b> floodlight asks every body under it “dead or alive?” — all at once, for as long as it is on.');
      return;
    }
    const d = it.d;
    const missing = d.needs.filter(i => !this.terms[i]?.known);
    if (missing.length) {
      this.sfx.bad();
      this.hud.tip(`${d.label} is locked. Code missing from: <b>${missing.map(i => this.terms[i]!.label).join(', ')}</b> — read it under <b class="c-cyan">CYAN</b>.`);
      return;
    }
    const entered = d.needs.flatMap(i => this.terms[i]!.known!);
    const truth = d.needs.flatMap(i => this.terms[i]!.q.code);
    if (sameCode(entered, truth)) {
      d.open = true;
      this.grid.solid[d.cell.y * this.grid.w + d.cell.x] = 0;
      this.sfx.good();
      const idx = this.doors.indexOf(d);
      for (const l of this.lamps) if (l.poweredByDoor === idx) { l.on = true; l.view.setOn(true); }
      if (this.lamps.some(l => l.poweredByDoor === idx)) { this.music.boom(); this.sfx.alarm(); }
    } else {
      this.stats.wrongCodes++;
      for (const i of d.needs) this.terms[i]!.known = null;
      this.sfx.bad();
      this.alarm(this.pos);
      this.hud.tip('<b>REJECTED.</b> That code was read off a scrambled screen — cyan reading an amber-scrambled symbol is a coin flip. Wait for the terminal to re-encode, then read it again.', 8);
    }
  }

  // ------------------------------------------------------------------ loop
  start(): void {
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      if (!this.paused && !this.ended) {
        this.acc += dt;
        while (this.acc >= STEP) { this.stepSim(); this.acc -= STEP; if (this.ended) break; }
      }
      this.render(this.paused ? 0 : dt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private stepSim(): void {
    const dt = STEP;
    this.time += dt;
    this.stats.time = this.time;
    this.stepPlayer(dt);
    this.stepWeapon(dt);
    this.stepLight(dt);
    this.stepLamps();
    this.stepSpawns(dt);
    this.stepZombies(dt);
    this.stepTerminals(dt);
    this.stepObjective();
    this.stepPickups(dt);
    if (this.mission.exitKind === 'heli' && this.step?.exit) this.heliY = Math.max(0, this.heliY - dt * 4);
    if (this.hp <= 0) this.end('dead');
  }

  private stepPlayer(dt: number): void {
    const k = this.keys;
    let fx = 0, fz = 0;
    if (k.has('KeyW')) fz -= 1;
    if (k.has('KeyS')) fz += 1;
    if (k.has('KeyA')) fx -= 1;
    if (k.has('KeyD')) fx += 1;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = fx * cos + fz * sin, wz = -fx * sin + fz * cos;
    const sprint = k.has('ShiftLeft') && this.adsT < 0.2 && fz < 0;
    const speed = (sprint ? 6.4 : 4.1) * (1 - 0.45 * this.adsT);
    const a = Math.min(1, dt * 12);
    this.vel.x += (wx * speed - this.vel.x) * a;
    this.vel.z += (wz * speed - this.vel.z) * a;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.grid.collide(this.pos, PLAYER_R);
    if (k.has('Space') && this.y <= 0) this.vy = 5.2;
    this.vy -= 15 * dt;
    this.y = Math.max(0, this.y + this.vy * dt);
    if (this.y === 0 && this.vy < 0) this.vy = 0;
    this.bob += Math.hypot(this.vel.x, this.vel.z) * dt * 1.9;
    this.recoil = Math.max(0, this.recoil - dt * (0.18 + this.recoil * 4));
    this.shake = Math.max(0, this.shake - dt * 2.5);

    const adsTarget = this.mouseR && this.swapT <= 0 && this.wstate[this.weapon]!.reloadT < 0 ? 1 : 0;
    this.adsT += Math.sign(adsTarget - this.adsT) * Math.min(Math.abs(adsTarget - this.adsT), dt / 0.16);
    this.swapT = Math.max(0, this.swapT - dt);

    if (this.filter !== 'off') {
      this.battery = Math.max(0, this.battery - dt * 2.2);
      if (this.battery <= 0) { this.batteryLock = true; this.filter = 'off'; this.sfx.dry(); this.tipOnce('battery', 'Flashlight battery empty — it recharges while off.'); }
    } else {
      this.battery = Math.min(100, this.battery + dt * 10);
      if (this.batteryLock && this.battery >= 25) this.batteryLock = false;
    }
  }

  private stepWeapon(dt: number): void {
    const w = WEAPONS[this.weapon]!, s = this.wstate[this.weapon]!;
    s.cooldown = Math.max(0, s.cooldown - dt);
    s.bloom = Math.max(0, s.bloom - dt * 0.09);
    if (s.reloadT >= 0) {
      s.reloadT += dt;
      if (s.reloadT >= w.reload) { s.mag = w.magSize; s.reloadT = -1; }
      return;
    }
    if (!this.mouseL || this.swapT > 0) return;
    if (!w.auto && this.firedThisPress) return;
    if (s.cooldown > 0) return;
    if (s.mag <= 0) {
      if (!this.firedThisPress) this.sfx.dry();
      this.firedThisPress = true;
      this.startReload();
      return;
    }
    this.firedThisPress = true;
    s.mag--;
    s.cooldown = w.interval;
    this.fire(w, s);
    if (!w.auto) setTimeout(() => this.sfx.bolt(), 380);
  }

  private aimDir(spread: number): THREE.Vector3 {
    const e = new THREE.Euler(this.pitch + this.recoil, this.yaw, 0, 'YXZ');
    const d = new THREE.Vector3(0, 0, -1).applyEuler(e);
    if (spread > 0) {
      const r = spread * Math.sqrt(this.rng()), a = this.rng() * Math.PI * 2;
      const right = new THREE.Vector3(1, 0, 0).applyEuler(e), up = new THREE.Vector3(0, 1, 0).applyEuler(e);
      d.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    }
    return d;
  }

  private currentSpread(): number {
    const w = WEAPONS[this.weapon]!, s = this.wstate[this.weapon]!;
    const moving = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 4.1);
    const base = w.hipSpread + (w.adsSpread - w.hipSpread) * this.adsT;
    return base + s.bloom + moving * 0.02 * (1 - this.adsT * 0.7) + (this.y > 0 ? 0.05 : 0);
  }

  private castRay(o: THREE.Vector3, d: THREE.Vector3, max = 80): { t: number; zombie: Zombie | null; head: boolean } {
    const hl = Math.hypot(d.x, d.z);
    let tWall = max;
    if (hl > 1e-6) tWall = this.grid.rayDistance(o.x, o.z, d.x / hl, d.z / hl, max * hl) / hl;
    if (d.y < 0) tWall = Math.min(tWall, o.y / -d.y);
    let best = tWall, hitZ: Zombie | null = null, head = false;
    for (const z of this.zombies) {
      if (eigen(z.theta) === 'dead') continue;
      const tb = slab(o, d, z.x - 0.32, 0, z.z - 0.32, z.x + 0.32, 1.45, z.z + 0.32);
      const th = slab(o, d, z.x - 0.22, 1.45, z.z - 0.22, z.x + 0.22, 1.95, z.z + 0.22);
      if (th < best) { best = th; hitZ = z; head = true; }
      if (tb < best) { best = tb; hitZ = z; head = false; }
    }
    return { t: best, zombie: hitZ, head };
  }

  private eye(): THREE.Vector3 { return new THREE.Vector3(this.pos.x, EYE + this.y, this.pos.z); }

  private fire(w: WeaponDef, s: WeaponState): void {
    this.stats.shots++;
    w.scope ? this.sfx.rifle() : this.sfx.shot();
    const o = this.eye();
    const d = this.aimDir(this.currentSpread());
    s.bloom = Math.min(0.06, s.bloom + w.bloom);
    this.recoil += w.recoil * (1 - 0.4 * this.adsT);
    this.yaw += (this.rng() - 0.5) * w.recoil * 0.35;
    const gun = this.guns[this.weapon]!;
    gun.flash.visible = true;
    gun.flash.rotation.z = this.rng() * Math.PI;
    setTimeout(() => { gun.flash.visible = false; }, 45);

    const hit = this.castRay(o, d);
    const end = o.clone().addScaledVector(d, Math.min(hit.t, 80));
    const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const start = o.clone().addScaledVector(d, 0.6).addScaledVector(right, 0.12 * (1 - this.adsT)).add(new THREE.Vector3(0, -0.1, 0));
    this.addTracer(start, end);
    this.addSpark(end, hit.zombie ? 0x880000 : 0xffcc66);

    const z = hit.zombie;
    if (!z) return;
    const tr = bulletHit(z, this.rng);
    this.onTransition(z, tr, 'bullet');
    if (!tr.damage) return;
    this.stats.hits++;
    const dmg = w.damage * (hit.head ? 2.5 : 1);
    if (hit.head) this.stats.headshots++;
    z.hp -= dmg;
    z.view.hitFlash();
    z.stun = Math.max(z.stun, 0.12);
    z.x += d.x * 0.15; z.z += d.z * 0.15;
    this.hud.hitMarker(hit.head);
    hit.head ? this.sfx.headshot() : this.sfx.hit();
    if (z.hp <= 0) {
      kill(z);
      z.hp = 100;
      z.changedAt = this.time;
      this.stats.kills++;
      this.sfx.collapse();
      this.addBlood(z);
    }
  }

  // ------------------------------------------------------------------ lights
  private inCone(o: THREE.Vector3, fwd: THREE.Vector3, tx: number, ty: number, tz: number): boolean {
    const vx = tx - o.x, vy = ty - o.y, vz = tz - o.z;
    const d = Math.hypot(vx, vy, vz);
    if (d > LIGHT_RANGE) return false;
    if (d < 0.6) return true;
    return (vx * fwd.x + vy * fwd.y + vz * fwd.z) / d >= COS_HALF;
  }

  private terminalVisibleFrom(t: Terminal, from: Point): boolean {
    const dx = from.x - t.pos.x, dz = from.z - t.pos.z;
    const dd = Math.hypot(dx, dz) || 1;
    if (dd < 1.6) return true;
    const face = { x: t.pos.x + (dx / dd) * 1.45, z: t.pos.z + (dz / dd) * 1.45 };
    return this.grid.lineOfSight(from, face);
  }

  private stepLight(dt: number): void {
    for (const t of this.terms) t.litT += dt;
    const basis: Basis | null = this.filter === 'off' ? null : this.filter;
    if (!basis) { for (const t of this.terms) t.readHold = 0; return; }
    const o = this.eye();
    const fwd = this.aimDir(0);
    for (const z of this.zombies) {
      const dead = eigen(z.theta) === 'dead';
      if (!this.inCone(o, fwd, z.x, dead ? 0.3 : 1.1, z.z)) continue;
      if (!this.grid.lineOfSight(this.pos, z)) continue;
      this.onTransition(z, lightTarget(z, basis, this.rng), 'light');
    }
    for (const t of this.terms) {
      if (this.inCone(o, fwd, t.pos.x, 1.6, t.pos.z) && this.terminalVisibleFrom(t, this.pos)) this.lightOnTerminal(t, basis, dt, true);
      else t.readHold = 0;
    }
  }

  private stepLamps(): void {
    for (const l of this.lamps) {
      if (!l.on) continue;
      for (const z of this.zombies) {
        if (Math.hypot(z.x - l.pos.x, z.z - l.pos.z) > LAMP_RADIUS) continue;
        if (!this.grid.lineOfSight(l.pos, z)) continue;
        this.onTransition(z, lightTarget(z, l.basis, this.rng), 'light');
      }
      for (const t of this.terms) {
        if (Math.hypot(t.pos.x - l.pos.x, t.pos.z - l.pos.z) > LAMP_RADIUS + 1) continue;
        if (this.terminalVisibleFrom(t, l.pos)) this.lightOnTerminal(t, l.basis, STEP, false);
      }
    }
  }

  private lightOnTerminal(t: Terminal, basis: Basis, dt: number, byPlayer: boolean): void {
    const r = lightTerminal(t.q, basis, this.rng);
    t.litT = 0;
    t.lastMode = { kind: basis === 'X' ? 'cyan' : 'amber', outcomes: r.outcomes, corrupt: t.reencodeT > 0 ? t.reencodeT : undefined };
    if (r.scrambledNow) {
      this.stats.scrambles++;
      t.reencodeT = this.mission.reencodeSeconds;
      this.alarm(t.pos);
      if (t.uplink) this.uplink = Math.max(0, this.uplink - t.uplink * 0.25);
      this.hud.tip(`<b class="c-amber">AMBER</b> asked the screen “0 or 1?” — the cyan code is destroyed. ${t.label} re-encodes in ${this.mission.reencodeSeconds}s, and the alarm is drawing them in.`, 7);
    }
    if (basis !== 'X' || !byPlayer) { if (byPlayer) t.readHold = 0; return; }
    t.readHold += dt;
    if (t.uplink) {
      if (isIntact(t.q)) this.uplink = Math.min(t.uplink, this.uplink + dt);
      return;
    }
    if (t.readHold >= 0.9 && !sameCode(t.known, r.outcomes)) {
      t.known = r.outcomes.slice();
      this.sfx.pickup();
      this.hud.tip(`${t.label}: code ${codeHtml(r.outcomes)} read under cyan.`, 4);
    }
  }

  private onTransition(z: Zombie, tr: Transition, cause: 'light' | 'bullet' | 'contact'): void {
    if (tr.from === tr.to) {
      if (this.time - z.changedAt < 2.5) return;
      if (cause === 'light' && tr.basis === 'X' && (tr.to === 'plus' || tr.to === 'minus'))
        this.tipOnce('cyanSafe', 'Cyan does not change the flickering ones — they already have a cyan answer, and asking again gets the same answer.');
      return;
    }
    z.changedAt = this.time;
    const undecided = (e: Eigen) => e === 'plus' || e === 'minus' || e === 'other';
    const dist = Math.hypot(z.x - this.pos.x, z.z - this.pos.z);
    if (undecided(tr.from) && tr.to === 'dead') {
      if (cause === 'light') this.stats.amberDropped++;
      if (cause === 'bullet') { this.stats.bulletsAsked++; this.tipOnce('bullet', 'Your bullet asked “dead or alive?” too — that one answered dead.'); }
      this.sfx.collapse();
    } else if (undecided(tr.from) && tr.to === 'alive') {
      if (cause === 'light') this.stats.amberWoke++;
      if (cause === 'bullet') this.stats.bulletsAsked++;
      if (z.raised) this.stats.raisedCameBackAlive++;
      this.sfx.charge();
      if (dist < 6) { this.music.stab(); this.shake = 0.5; }
      if (z.raised) this.tipOnce('raisedAlive', 'That corpse came back <b>alive</b>. “Dead” was only true until you asked it something else.', 6);
    } else if (tr.from === 'dead' && undecided(tr.to)) {
      this.stats.cyanRaised++;
      z.raised = true;
      z.stun = 1.4;
      this.sfx.revive();
      if (this.mission.id > 0) this.tipOnce('raise', 'It is getting up. <b class="c-cyan">Cyan</b> asked the corpse a different question — and that erased “dead”.', 6);
    }
  }

  // ------------------------------------------------------------------ horde
  private alarm(at: Point): void {
    this.sfx.alarm();
    if (!this.map.spawners.length) return;
    const sp = [...this.map.spawners].sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z));
    for (let i = 0; i < 4; i++) this.spawnZombie(sp[i % Math.min(2, sp.length)]!, 1.2, this.rng() < this.mission.spawn.minus ? 1 : 0);
  }

  private liveCount(): number {
    let n = 0;
    for (const z of this.zombies) if (eigen(z.theta) !== 'dead') n++;
    return n;
  }

  private stepSpawns(dt: number): void {
    const s = this.mission.spawn;
    if (!this.map.spawners.length || this.spawnCap.cap <= 0) return;
    const rate = s.rate0 + (s.rate1 - s.rate0) * Math.min(1, this.time / s.ramp);
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (this.liveCount() >= this.spawnCap.cap) break;
      const far = this.map.spawners.filter(p => Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > 10);
      const pool = far.length ? far : this.map.spawners;
      this.spawnZombie(pool[Math.floor(this.rng() * pool.length)]!, 1.4, this.rng() < s.minus ? 1 : 0);
    }
    if (this.zombies.length > 90) {
      const idx = this.zombies.findIndex(z => eigen(z.theta) === 'dead' && Math.hypot(z.x - this.pos.x, z.z - this.pos.z) > 22);
      if (idx >= 0) { const [z] = this.zombies.splice(idx, 1); this.scene.remove(z!.view.root); z!.view.dispose(); }
    }
  }

  private stepZombies(dt: number): void {
    this.flowT -= dt;
    if (this.flowT <= 0) { this.flow = flowField(this.grid, cellOf(this.pos)); this.flowT = 0.25; }
    const zs = this.zombies;
    for (const z of zs) {
      const st = eigen(z.theta);
      z.biteCd = Math.max(0, z.biteCd - dt);
      z.attacking = Math.max(0, z.attacking - dt);
      if (st === 'dead') { z.speed = 0; continue; }
      if (z.stun > 0) { z.stun -= dt; z.speed = 0; continue; }
      const dx = this.pos.x - z.x, dz = this.pos.z - z.z;
      const dist = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz);
      let diff = want - z.facing; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      z.facing += diff * Math.min(1, dt * 6);
      if (st !== 'alive' && (this.mission.calm || dist > 26)) { z.speed = 0; this.touch(z, st, dist, dx, dz); continue; }
      let mx: number, mz: number;
      if (dist < 7 && this.grid.lineOfSight(z, this.pos)) { mx = dx / dist; mz = dz / dist; }
      else {
        const f = flowDirection(this.grid, this.flow, cellOf(z));
        if (f) { mx = f.x; mz = f.z; } else { mx = dx / (dist || 1); mz = dz / (dist || 1); }
      }
      for (const o of zs) {
        if (o === z || eigen(o.theta) === 'dead') continue;
        const ox = z.x - o.x, oz = z.z - o.z, d2 = ox * ox + oz * oz;
        if (d2 > 0.0001 && d2 < 0.5) { const d = Math.sqrt(d2); mx += (ox / d) * (0.7 - d) * 1.6; mz += (oz / d) * (0.7 - d) * 1.6; }
      }
      const ml = Math.hypot(mx, mz) || 1;
      const sp = st === 'alive' ? 3.0 : 1.1;
      z.speed = dist > 0.8 ? sp : 0;
      if (dist > 0.8) { z.x += (mx / ml) * sp * dt; z.z += (mz / ml) * sp * dt; }
      this.grid.collide(z, ZOMBIE_R);
      this.touch(z, st, dist, dx, dz);
      if (st === 'alive' && dist < 14 && this.rng() < dt * 0.1) this.sfx.groan();
    }
  }

  private touch(z: Zombie, st: Eigen, dist: number, dx: number, dz: number): void {
    if (dist >= 0.95) return;
    if (st !== 'alive') {
      const tr = contact(z, this.rng);
      this.onTransition(z, tr, 'contact');
      if (tr.bites) this.tipOnce('contact', 'It touched you — and touching asks “dead or alive?” too. It answered alive.');
    }
    if (eigen(z.theta) === 'alive' && z.biteCd <= 0) {
      z.biteCd = 1.0;
      z.attacking = 0.6;
      this.hp -= 12;
      this.stats.bites++;
      this.shake = 0.35;
      this.sfx.bite();
      this.hud.damage();
      this.pos.x += (dx / (dist || 1)) * 0.3; this.pos.z += (dz / (dist || 1)) * 0.3;
      this.grid.collide(this.pos, PLAYER_R);
    }
  }

  // ------------------------------------------------------------------ objectives
  private stepTerminals(dt: number): void {
    for (const t of this.terms) {
      if (t.reencodeT <= 0) continue;
      t.reencodeT -= dt;
      if (t.reencodeT <= 0) { reencode(t.q); t.reencodeT = 0; this.hud.tip(`${t.label} re-encoded its code in <b class="c-cyan">cyan</b>. Read it with cyan this time.`); }
    }
    for (const d of this.doors) if (d.open && d.openT < 1) { d.openT = Math.min(1, d.openT + dt * 1.2); d.mesh.position.y = 1.5 - d.openT * 3.1; }
  }

  private stepPickups(dt: number): void {
    for (const p of this.pickups) {
      if (p.respawn > 0) { p.respawn -= dt; p.obj.visible = p.respawn <= 0; continue; }
      p.obj.rotation.y += dt * 1.5;
      if (this.hp >= 100 || Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) > 1.1) continue;
      this.hp = Math.min(100, this.hp + 50);
      this.sfx.pickup();
      p.respawn = 45; p.obj.visible = false;
    }
  }

  private tipOnce(key: string, html: string, s = 6): void {
    if (this.tipsShown.has(key)) return;
    this.tipsShown.add(key);
    this.hud.tip(html, s);
  }

  private end(r: EndResult): void {
    if (this.ended) return;
    this.ended = true;
    this.keys.clear(); this.mouseL = this.mouseR = false;
    if (!this.opts.debug && document.pointerLockElement) document.exitPointerLock();
    if (r === 'win') this.sfx.good(); else { this.sfx.bad(); this.music.stab(); }
    setTimeout(() => { if (!this.disposed) this.opts.onEnd(r, { ...this.stats }); }, r === 'dead' ? 1200 : 400);
  }

  // ------------------------------------------------------------------ render
  private resize(): void {
    const w = this.opts.container.clientWidth || innerWidth, h = this.opts.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = this.vmCamera.aspect = w / h;
    this.camera.updateProjectionMatrix(); this.vmCamera.updateProjectionMatrix();
  }

  private render(dt: number): void {
    const w = WEAPONS[this.weapon]!, s = this.wstate[this.weapon]!;
    const scoped = w.scope && this.adsT > 0.92;
    const sway = scoped ? 0.0022 : 0;
    const sh = this.shake * this.shake * 0.06;
    this.camera.position.set(this.pos.x, EYE + this.y + Math.sin(this.bob * 2) * 0.03 * (1 - this.adsT), this.pos.z);
    this.camera.rotation.set(
      this.pitch + this.recoil + Math.sin(this.time * 1.3) * sway + (Math.random() - 0.5) * sh,
      this.yaw + Math.cos(this.time * 0.9) * sway + (Math.random() - 0.5) * sh, 0);
    const fov = BASE_FOV + (w.adsFov - BASE_FOV) * (w.scope ? (this.adsT > 0.92 ? 1 : this.adsT * 0.3) : this.adsT);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    this.flashlight.color.setHex(this.filter === 'Z' ? COLORS.amber : COLORS.cyan);
    const flicker = this.battery < 15 ? (Math.random() < 0.15 ? 0.3 : 1) : 1;
    this.flashlight.intensity = this.filter === 'off' ? 0 : 55 * flicker;
    this.flashlight.position.set(0.25 * (1 - this.adsT), -0.15 * (1 - this.adsT), 0);
    for (const f of this.flickers) {
      const n = Math.sin(this.time * 13 + f.phase) + Math.sin(this.time * 31 + f.phase * 2);
      f.light.intensity = n > 1.6 ? 0 : f.base * (0.8 + 0.2 * Math.sin(this.time * 7 + f.phase));
    }

    for (const z of this.zombies) {
      z.view.root.position.set(z.x, 0, z.z);
      z.view.root.rotation.y = z.facing;
      z.view.update(dt, eigen(z.theta), z.speed, this.time, z.attacking > 0);
    }
    for (const t of this.terms) {
      const progress = t.uplink ? this.uplink / t.uplink : -1;
      const mode: ScreenMode = t.litT < 0.25 ? t.lastMode : t.reencodeT > 0 ? { kind: 'reencode', seconds: t.reencodeT } : { kind: 'dark' };
      t.view.draw(mode, progress);
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]!;
      f.life -= dt || 0.016;
      const mat = (f.obj as THREE.Mesh).material as THREE.Material & { opacity: number };
      mat.opacity = Math.max(0, f.life / f.max);
      if (f.life <= 0) { this.scene.remove(f.obj); this.fx.splice(i, 1); }
    }
    if (this.exitObj && this.exitObj.visible) {
      this.exitObj.position.y = this.heliY;
      this.exitObj.rotation.y = Math.sin(this.time * 0.3) * 0.1;
      const rotor = this.exitObj.getObjectByName('rotor');
      if (rotor) rotor.rotation.y += (dt || 0.016) * 25;
    }

    for (let i = 0; i < this.guns.length; i++) this.guns[i]!.group.visible = i === this.weapon && !scoped;
    const g = this.guns[this.weapon]!.group;
    const hip = new THREE.Vector3(0.1, -0.09, -0.3), ads = new THREE.Vector3(0, w.scope ? -0.043 : -0.029, -0.2);
    const p = hip.lerp(ads, this.adsT);
    const moving = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 4.1) * (1 - this.adsT * 0.8);
    p.x += Math.cos(this.bob) * 0.012 * moving;
    p.y += Math.abs(Math.sin(this.bob)) * 0.014 * moving - this.swapT * 0.6;
    p.z += this.recoil * 1.6;
    g.position.copy(p);
    const reloadP = s.reloadT >= 0 ? Math.sin((s.reloadT / w.reload) * Math.PI) : 0;
    g.rotation.set(this.recoil * 2 - reloadP * 0.6, 0, reloadP * 0.5);

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
    const hs = this.hudState(scoped);
    this.hud.update(hs, dt);
    this.music.update(dt, hs.danger, this.hp);
  }

  private inspect(): string | null {
    if (this.adsT < 0.5) return null;
    const o = this.eye(), d = this.aimDir(0);
    const hit = this.castRay(o, d, 40);
    let target = hit.zombie, best = hit.t;
    for (const z of this.zombies) {
      if (eigen(z.theta) !== 'dead') continue;
      const t = slab(o, d, z.x - 0.7, 0, z.z - 0.7, z.x + 0.7, 0.5, z.z + 0.7);
      if (t < best) { best = t; target = z; }
    }
    if (target) {
      const st = eigen(target.theta);
      const amber = '<b class="c-amber">Dead or alive?</b>', cyan = '<b class="c-cyan">Cyan answer</b>';
      if (st === 'dead') return `${amber} DEAD — certain<br>${cyan} unknown (50/50)<br><i>cyan on it → it gets up</i>`;
      if (st === 'alive') return `${amber} ALIVE — certain<br><i>shoot it</i>`;
      if (st === 'plus' || st === 'minus') return `${amber} undecided (50/50)<br>${cyan} ${st === 'plus' ? '<span class="g-plus">◯</span>' : '<span class="g-minus">◇</span>'} — certain<br><i>amber or a bullet makes it choose</i>`;
    }
    for (const t of this.terms) {
      const tt = slab(o, d, t.pos.x - 1, 0, t.pos.z - 1, t.pos.x + 1, 2.4, t.pos.z + 1);
      if (tt < hit.t + 0.01 && tt < 40) return t.reencodeT > 0 ? `${t.label}<br>scrambled — re-encoding ${Math.ceil(t.reencodeT)}s` : `${t.label}<br>code stored in <b class="c-cyan">CYAN</b>`;
    }
    return null;
  }

  private hudState(scoped: boolean): HudState {
    const w = WEAPONS[this.weapon]!, s = this.wstate[this.weapon]!;
    const st = this.step;
    const goal = st ? (typeof st.goal === 'function' ? st.goal(this.ctx()) : st.goal) : '';
    let prompt: string | null = null;
    const it = this.nearestInteractable();
    if (it?.kind === 'door') {
      const known = it.d.needs.every(i => this.terms[i]?.known);
      prompt = known ? `[E] ${it.d.label}: enter ${it.d.needs.map(i => codeHtml(this.terms[i]!.known!)).join('')}` : `[E] ${it.d.label} — locked`;
    } else if (it?.kind === 'lamp') {
      prompt = `[E] ${it.l.on ? 'Switch off' : 'Switch on'}: ${it.l.label}`;
    }
    const upl = this.terms.find(t => t.uplink);
    let danger = 0;
    for (const z of this.zombies) {
      if (eigen(z.theta) !== 'alive') continue;
      const d = Math.hypot(z.x - this.pos.x, z.z - this.pos.z);
      if (d < 12) danger += (12 - d) / 12;
    }
    const spreadPx = Math.max(3, this.currentSpread() * (innerHeight / 2) / Math.tan((this.camera.fov * Math.PI) / 360));
    return {
      hp: this.hp, weapon: w.name, mag: s.mag,
      reloading: s.reloadT >= 0 ? s.reloadT / w.reload : -1, filter: this.filter, battery: this.battery,
      chapter: `${this.mission.chapter} · ${this.mission.name.toUpperCase()}`, objective: goal,
      inspector: this.inspect(), spread: spreadPx, ads: this.adsT, scoped,
      prompt: prompt ?? (this.locked() ? null : 'Click to take control'),
      codes: this.terms.filter(t => t.known && !t.uplink).map(t => ({ label: t.label, html: codeHtml(t.known!) })),
      progress: upl && !this.step?.exit ? { value: this.uplink, total: upl.uplink, label: `SIGNAL ${Math.floor(this.uplink)} / ${upl.uplink}s` } : null,
      danger: Math.min(1, danger / 2),
    };
  }

  private addTracer(a: THREE.Vector3, b: THREE.Vector3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }));
    this.scene.add(line);
    this.fx.push({ obj: line, life: 0.06, max: 0.06 });
  }

  private addSpark(p: THREE.Vector3, color: number): void {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(p);
    this.scene.add(m);
    this.fx.push({ obj: m, life: 0.14, max: 0.14 });
  }

  // ------------------------------------------------------------------ teardown / debug
  private disposed = false;

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ended = true;
    for (const d of this.disposers) d();
    for (const z of this.zombies) z.view.dispose();
    this.hud.destroy();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    delete (window as unknown as { __dr?: unknown }).__dr;
  }

  private installDebug(): void {
    const api = {
      step: (n = 1) => { for (let i = 0; i < n && !this.ended; i++) this.stepSim(); this.render(STEP); return api.state(); },
      state: () => {
        const counts: Record<string, number> = { dead: 0, alive: 0, plus: 0, minus: 0, other: 0 };
        for (const z of this.zombies) counts[eigen(z.theta)]!++;
        return {
          hp: this.hp, pos: { ...this.pos }, filter: this.filter, battery: this.battery, weapon: WEAPONS[this.weapon]!.name,
          ...this.wstate[this.weapon]!, ads: this.adsT, fov: this.camera.fov, counts, step: this.stepIdx,
          goal: this.hudState(false).objective, terms: this.terms.map(t => ({ label: t.label, code: t.q.code, known: t.known, intact: isIntact(t.q), pos: t.pos })),
          doors: this.doors.map(d => ({ open: d.open, pos: center(d.cell) })), lamps: this.lamps.map(l => ({ on: l.on, pos: l.pos, basis: l.basis })),
          markers: this.map.markers, exit: this.exitPos, uplink: this.uplink, ended: this.ended, stats: { ...this.stats },
        };
      },
      key: (code: string, down: boolean) => { if (down) { this.keys.add(code); this.onKey(code); } else this.keys.delete(code); },
      mouse: (button: 0 | 2, down: boolean) => { if (button === 0) { this.mouseL = down; if (down) this.firedThisPress = false; } else this.mouseR = down; },
      lookAt: (x: number, y: number, z: number) => {
        const dx = x - this.pos.x, dy = y - EYE, dz = z - this.pos.z;
        this.yaw = Math.atan2(-dx, -dz); this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      },
      teleport: (x: number, z: number) => { this.pos.x = x; this.pos.z = z; },
      setFilter: (f: Filter) => this.setFilter(f),
      setHp: (v: number) => { this.hp = v; },
      spawn: (n: number, kind: 'dead' | 'plus' | 'minus' | 'alive', x: number, z: number) => { for (let i = 0; i < n; i++) this.spawnZombie({ x, z }, 0.1, kind); },
      clear: () => { for (const z of this.zombies) { this.scene.remove(z.view.root); z.view.dispose(); } this.zombies = []; },
      lightAll: (basis: Basis) => { for (const z of this.zombies) this.onTransition(z, lightTarget(z, basis, this.rng), 'light'); return api.state().counts; },
      killAlive: () => { for (const z of this.zombies) if (eigen(z.theta) === 'alive') kill(z); },
      freeze: (on: boolean) => { this.spawnCap.cap = on ? 0 : this.mission.spawn.cap; this.spawnAcc = 0; },
      interact: () => this.interact(),
    };
    (window as unknown as { __dr: typeof api }).__dr = api;
  }
}

function slab(o: THREE.Vector3, d: THREE.Vector3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  let tmin = 0, tmax = Infinity;
  const os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z], lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]!) < 1e-9) { if (os[i]! < lo[i]! || os[i]! > hi[i]!) return Infinity; continue; }
    let t1 = (lo[i]! - os[i]!) / ds[i]!, t2 = (hi[i]! - os[i]!) / ds[i]!;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}
