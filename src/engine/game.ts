// The running level: fixed-step simulation + three.js rendering.
// Every qubit change goes through src/game/rules.ts — this file only decides
// *when* a light, bullet or bite touches something.
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
import type { LevelDef } from '../levels';
import { Hud, codeHtml } from '../ui/hud';
import type { Filter, HudState } from '../ui/hud';
import { Sfx } from './audio';
import {
  COLORS, TerminalView, ZombieView, floorTexture, makeBeacon, makeCarbine, makeDoor, makeMarksman, makePickup, wallTexture,
} from './models';
import type { GunModel, ScreenMode } from './models';

const STEP = 1 / 60;
const EYE = 1.62;
const PLAYER_R = 0.35;
const ZOMBIE_R = 0.32;
const LIGHT_RANGE = 18;
const LIGHT_HALF_ANGLE = 0.36; // rad (~21°)
const COS_HALF = Math.cos(LIGHT_HALF_ANGLE);
const BASE_FOV = 75;

export interface Stats {
  time: number;
  shots: number;
  hits: number;
  headshots: number;
  kills: number;
  amberDropped: number;   // undecided → dead under amber
  amberWoke: number;      // undecided → alive under amber
  cyanRaised: number;     // dead → undecided under cyan
  raisedCameBackAlive: number;
  bulletsAsked: number;   // bullet hit an undecided body
  bites: number;
  scrambles: number;
  wrongCodes: number;
}

export type EndResult = 'win' | 'dead';

interface WeaponDef {
  name: string; damage: number; interval: number; auto: boolean; magSize: number; reserve: number;
  reload: number; hipSpread: number; adsSpread: number; bloom: number; recoil: number; adsFov: number; scope: boolean;
}
const WEAPONS: WeaponDef[] = [
  { name: 'CARBINE', damage: 34, interval: 0.1, auto: true, magSize: 30, reserve: 120, reload: 2.0, hipSpread: 0.022, adsSpread: 0.006, bloom: 0.007, recoil: 0.014, adsFov: 50, scope: false },
  { name: 'MARKSMAN', damage: 110, interval: 0.9, auto: false, magSize: 5, reserve: 25, reload: 2.6, hipSpread: 0.07, adsSpread: 0.0006, bloom: 0.03, recoil: 0.06, adsFov: 16, scope: true },
];

interface WeaponState { mag: number; reserve: number; cooldown: number; reloadT: number; bloom: number }

interface Zombie {
  id: number;
  x: number; z: number;
  theta: number;
  hp: number;
  view: ZombieView;
  biteCd: number;
  stun: number;
  raised: boolean; // was raised from a corpse by cyan
  changedAt: number;
  facing: number;
  speed: number;
}

interface Pickup { kind: 'med' | 'ammo'; pos: Point; obj: THREE.Group; respawn: number }

interface Fx { obj: THREE.Object3D; life: number; max: number; kind: 'tracer' | 'spark' }

export interface GameOptions {
  level: LevelDef;
  container: HTMLElement;
  debug: boolean;
  sfx: Sfx;
  onEnd: (r: EndResult, s: Stats) => void;
  onPauseChange: (paused: boolean) => void;
}

export class Game {
  readonly level: LevelDef;
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
  private readonly guns: GunModel[];

  // player
  private pos: Point;
  private y = 0;
  private vy = 0;
  private vel = { x: 0, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private recoil = 0;
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
  private term: { q: TerminalQ; view: TerminalView; pos: Point; cell: Cell; reencodeT: number; readHold: number; litT: number; lastMode: ScreenMode } | null = null;
  private doors: { cell: Cell; mesh: THREE.Mesh; open: boolean; openT: number }[] = [];
  private beacon: ReturnType<typeof makeBeacon> | null = null;
  private exitActive: boolean;
  private knownCode: (0 | 1)[] | null = null;
  private uplink = 0;
  private pickups: Pickup[] = [];
  private fx: Fx[] = [];
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
    this.rng = seededRandom(opts.level.seed ^ (Date.now() & 0xffff));
    // fresh copy per run; the door/uplink code is re-rolled every attempt
    this.level = {
      ...opts.level,
      spawn: { ...opts.level.spawn },
      code: opts.level.code?.map(() => (this.rng() < 0.5 ? 0 : 1) as 0 | 1),
    };
    this.map = parseMap(this.level.map);
    this.grid = new Grid(this.map.w, this.map.h, this.map.solid);
    this.pos = { ...this.map.start };
    this.exitActive = this.level.kind !== 'uplink';
    this.wstate = WEAPONS.map(w => ({ mag: w.magSize, reserve: w.reserve, cooldown: 0, reloadT: -1, bloom: 0 }));

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: opts.debug });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.autoClear = false;
    this.renderer.domElement.className = 'game-canvas';
    opts.container.appendChild(this.renderer.domElement);
    this.hud = new Hud(opts.container);

    this.scene.background = new THREE.Color(0x04060a);
    this.scene.fog = new THREE.FogExp2(0x04060a, 0.045);
    this.scene.add(new THREE.HemisphereLight(0x4a5a7a, 0x15151a, 1.1));
    const playerGlow = new THREE.PointLight(0x5a6a88, 2.2, 7, 1.6);
    this.camera.add(playerGlow);
    this.flashlight = new THREE.SpotLight(0xffffff, 0, LIGHT_RANGE + 6, LIGHT_HALF_ANGLE * 1.15, 0.35, 1.1);
    this.flashlight.position.set(0.25, -0.15, 0);
    this.flashlight.target.position.set(0, 0, -1);
    this.camera.add(this.flashlight, this.flashlight.target);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.buildWorld();
    this.flow = flowField(this.grid, cellOf(this.pos));

    // view-model scene
    this.vmScene.add(new THREE.HemisphereLight(0x9aaacc, 0x222222, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(1, 2, 1); this.vmScene.add(key);
    this.guns = [makeCarbine(), makeMarksman()];
    for (const g of this.guns) { g.group.scale.setScalar(0.55); this.vmScene.add(g.group); }

    this.yaw = this.initialYaw();
    this.bindInput();
    this.resize();
    if (opts.debug) this.installDebug();
    this.hud.tip(`<b>${this.level.name}</b> — ${this.level.objective}`, 6);
  }

  // ------------------------------------------------------------------ world
  private initialYaw(): number {
    // face the most open direction
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
    let walls = 0;
    const wallAt = (x: number, y: number) => this.map.solid[y * w + x] === 1 && !this.map.doors.some(d => d.x === x && d.y === y) && !this.isTerminalCell(x, y);
    const nearFloor = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => {
      const nx = x + dx!, ny = y + dy!;
      return nx >= 0 && ny >= 0 && nx < w && ny < h && this.map.solid[ny * w + nx] === 0;
    });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (wallAt(x, y) && nearFloor(x, y)) walls++;
    const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, 3.4, TILE), wallMat, walls);
    const m4 = new THREE.Matrix4();
    let i = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!wallAt(x, y) || !nearFloor(x, y)) continue;
      const c = center({ x, y });
      m4.makeTranslation(c.x, 1.7, c.z);
      wallMesh.setMatrixAt(i++, m4);
    }
    this.scene.add(wallMesh);

    const ft = floorTexture();
    ft.repeat.set(w, h);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w * TILE, h * TILE), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((w * TILE) / 2, 0, (h * TILE) / 2);
    this.scene.add(floor);

    // a few dim hanging lamps over random floor tiles, for mood
    const lr = seededRandom(this.level.seed);
    for (let k = 0; k < 6; k++) {
      const x = 1 + Math.floor(lr() * (w - 2)), y = 1 + Math.floor(lr() * (h - 2));
      if (this.map.solid[y * w + x]) continue;
      const c = center({ x, y });
      const l = new THREE.PointLight(0xffaa66, 1.6, 7, 1.6);
      l.position.set(c.x, 3, c.z);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08), new THREE.MeshBasicMaterial({ color: 0xffcc88 }));
      bulb.position.copy(l.position);
      this.scene.add(l, bulb);
    }

    for (const p of this.map.corpses) this.spawnZombie(p, 0, 'dead');
    for (const p of this.map.plus) this.spawnZombie(p, 0, 'plus');
    for (const p of this.map.minus) this.spawnZombie(p, 0, 'minus');

    const t = this.map.terminals[0];
    if (t && this.level.code) {
      const cell = cellOf(t);
      // face the open neighbour
      let face = new THREE.Vector3(0, 0, 1);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (!this.grid.isSolid(cell.x + dx, cell.y + dy)) { face = new THREE.Vector3(dx, 0, dy); break; }
      }
      const view = new TerminalView(face, this.level.kind === 'uplink' ? 'UPLINK-7' : 'DOOR CODE');
      view.root.position.set(t.x, 0, t.z);
      this.scene.add(view.root);
      this.term = { q: makeTerminal(this.level.code), view, pos: t, cell, reencodeT: 0, readHold: 0, litT: 99, lastMode: { kind: 'dark' } };
    }
    for (const d of this.map.doors) {
      const mesh = makeDoor();
      const c = center(d);
      mesh.position.set(c.x, 1.5, c.z);
      this.scene.add(mesh);
      this.doors.push({ cell: d, mesh, open: false, openT: 0 });
    }
    const e = this.map.exits[0];
    if (e) {
      this.beacon = makeBeacon();
      this.beacon.group.position.set(e.x, 0, e.z);
      this.beacon.setActive(this.exitActive);
      this.scene.add(this.beacon.group);
    }
    for (const p of this.map.medkits) this.addPickup('med', p);
    for (const p of this.map.ammo) this.addPickup('ammo', p);
  }

  private isTerminalCell(x: number, y: number): boolean {
    return this.map.terminals.some(t => { const c = cellOf(t); return c.x === x && c.y === y; });
  }

  private addPickup(kind: 'med' | 'ammo', pos: Point): void {
    const obj = makePickup(kind);
    obj.position.set(pos.x, 0.5, pos.z);
    this.scene.add(obj);
    this.pickups.push({ kind, pos, obj, respawn: 0 });
  }

  private spawnZombie(p: Point, jitter: number, state: Eigen | 0 | 1): Zombie {
    const theta = state === 'dead' ? 0 : state === 'plus' ? spawnState(0) : state === 'minus' ? spawnState(1)
      : spawnState(state as 0 | 1);
    const view = new ZombieView(this.nextId);
    const z: Zombie = {
      id: this.nextId++, x: p.x + (this.rng() - 0.5) * jitter, z: p.z + (this.rng() - 0.5) * jitter,
      theta, hp: 100, view, biteCd: 0, stun: 0, raised: false, changedAt: -99, facing: this.rng() * Math.PI * 2, speed: 0,
    };
    this.grid.collide(z, ZOMBIE_R);
    view.root.position.set(z.x, 0, z.z);
    if (eigen(theta) === 'dead') view.update(10, 'dead', 0, 0); // pre-placed corpses start on the floor
    this.scene.add(view.root);
    this.zombies.push(z);
    return z;
  }

  // ------------------------------------------------------------------ input
  private bindInput(): void {
    const on = <K extends keyof DocumentEventMap>(t: K, f: (e: DocumentEventMap[K]) => void) => {
      document.addEventListener(t, f as EventListener);
      this.disposers.push(() => document.removeEventListener(t, f as EventListener));
    };
    on('keydown', e => {
      if (this.paused || this.ended) return;
      if (e.repeat) return;
      this.keys.add(e.code);
      this.onKey(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    on('keyup', e => this.keys.delete(e.code));
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
      const sens = 0.0022 * (this.camera.fov / BASE_FOV);
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
    void this.renderer.domElement.requestPointerLock();
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
    if (f !== 'off' && this.batteryLock) { this.sfx.dry(); this.tipOnce('battery', 'Flashlight battery is recharging — it comes back faster while the light is off.'); return; }
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
    if (s.reloadT >= 0 || s.mag >= w.magSize || s.reserve <= 0) return;
    s.reloadT = 0;
    this.sfx.reload();
  }

  private interact(): void {
    for (const d of this.doors) {
      if (d.open) continue;
      const c = center(d.cell);
      if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) > 3.2) continue;
      if (!this.knownCode) { this.sfx.bad(); this.hud.tip('The door wants a code. It is on the terminal — read it under <b class="c-cyan">CYAN</b>.'); return; }
      if (this.term && sameCode(this.knownCode, this.term.q.code)) {
        d.open = true;
        this.grid.solid[d.cell.y * this.grid.w + d.cell.x] = 0;
        this.sfx.good();
        this.hud.tip('Door open. Get to the extraction beacon.');
      } else {
        this.stats.wrongCodes++;
        this.knownCode = null;
        this.sfx.bad();
        this.alarm(this.pos);
        this.hud.tip('<b>REJECTED.</b> You read that code off a scrambled screen — a cyan read of an amber-scrambled symbol is a coin flip. Wait for the re-encode and read it again.', 8);
      }
      return;
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
        while (this.acc >= STEP) { this.step(); this.acc -= STEP; if (this.ended) break; }
      }
      this.render(this.paused ? 0 : dt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private step(): void {
    const dt = STEP;
    this.time += dt;
    this.stats.time = this.time;
    this.stepPlayer(dt);
    this.stepWeapon(dt);
    this.stepLight(dt);
    this.stepSpawns(dt);
    this.stepZombies(dt);
    this.stepObjectives(dt);
    this.stepPickups(dt);
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
    const speed = (sprint ? 6.6 : 4.3) * (1 - 0.45 * this.adsT);
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

    // ADS
    const adsTarget = this.mouseR && this.swapT <= 0 && this.wstate[this.weapon]!.reloadT < 0 ? 1 : 0;
    this.adsT += Math.sign(adsTarget - this.adsT) * Math.min(Math.abs(adsTarget - this.adsT), dt / 0.16);
    this.swapT = Math.max(0, this.swapT - dt);

    // battery
    if (this.filter !== 'off') {
      this.battery = Math.max(0, this.battery - dt * 2.6);
      if (this.battery <= 0) { this.batteryLock = true; this.filter = 'off'; this.sfx.dry(); this.tipOnce('battery', 'Flashlight battery is empty — it recharges while off.'); }
    } else {
      this.battery = Math.min(100, this.battery + dt * 9);
      if (this.batteryLock && this.battery >= 25) this.batteryLock = false;
    }
  }

  private stepWeapon(dt: number): void {
    const w = WEAPONS[this.weapon]!, s = this.wstate[this.weapon]!;
    s.cooldown = Math.max(0, s.cooldown - dt);
    s.bloom = Math.max(0, s.bloom - dt * (w.auto ? 0.09 : 0.08));
    if (s.reloadT >= 0) {
      s.reloadT += dt;
      if (s.reloadT >= w.reload) {
        const need = Math.min(w.magSize - s.mag, s.reserve);
        s.mag += need; s.reserve -= need; s.reloadT = -1;
      }
      return;
    }
    if (!this.mouseL || this.swapT > 0) return;
    if (!w.auto && this.firedThisPress) return;
    if (s.cooldown > 0) return;
    if (s.mag <= 0) {
      if (!this.firedThisPress) this.sfx.dry();
      this.firedThisPress = true;
      if (s.reserve > 0) this.startReload();
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
    const moving = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 4.3);
    const base = w.hipSpread + (w.adsSpread - w.hipSpread) * this.adsT;
    return base + s.bloom + moving * 0.02 * (1 - this.adsT * 0.7) + (this.y > 0 ? 0.05 : 0);
  }

  /** Ray-cast through walls/floor and zombie hitboxes. */
  private castRay(o: THREE.Vector3, d: THREE.Vector3, max = 80): { t: number; zombie: Zombie | null; head: boolean } {
    const hl = Math.hypot(d.x, d.z);
    let tWall = max;
    if (hl > 1e-6) tWall = this.grid.rayDistance(o.x, o.z, d.x / hl, d.z / hl, max * hl) / hl;
    if (d.y < 0) tWall = Math.min(tWall, o.y / -d.y);
    let best = tWall, hitZ: Zombie | null = null, head = false;
    for (const z of this.zombies) {
      if (eigen(z.theta) === 'dead') continue;
      const tb = slab(o, d, z.x - 0.3, 0, z.z - 0.3, z.x + 0.3, 1.45, z.z + 0.3);
      const th = slab(o, d, z.x - 0.21, 1.45, z.z - 0.21, z.x + 0.21, 1.9, z.z + 0.21);
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
    // tracer from just below/right of the eye
    const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const start = o.clone().addScaledVector(d, 0.6).addScaledVector(right, 0.12 * (1 - this.adsT)).add(new THREE.Vector3(0, -0.1, 0));
    this.addTracer(start, end);
    this.addSpark(end, hit.zombie ? 0xaa1111 : 0xffcc66);

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
    // knockback
    z.x += d.x * 0.15; z.z += d.z * 0.15;
    this.hud.hitMarker(hit.head);
    hit.head ? this.sfx.headshot() : this.sfx.hit();
    if (z.hp <= 0) {
      kill(z);
      z.hp = 100;
      this.stats.kills++;
      this.sfx.collapse();
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

  private lightDir(): THREE.Vector3 { return this.aimDir(0); }

  private stepLight(dt: number): void {
    const basis: Basis | null = this.filter === 'off' ? null : this.filter;
    if (this.term) this.term.litT += dt;
    if (!basis) return;
    const o = this.eye();
    const fwd = this.lightDir();
    for (const z of this.zombies) {
      const dead = eigen(z.theta) === 'dead';
      if (!this.inCone(o, fwd, z.x, dead ? 0.3 : 1.1, z.z)) continue;
      if (!this.grid.lineOfSight(this.pos, z)) continue;
      const tr = lightTarget(z, basis, this.rng);
      this.onTransition(z, tr, 'light');
    }
    const t = this.term;
    if (t) {
      const dx = this.pos.x - t.pos.x, dz = this.pos.z - t.pos.z;
      const dd = Math.hypot(dx, dz) || 1;
      const face = { x: t.pos.x + (dx / dd) * 1.45, z: t.pos.z + (dz / dd) * 1.45 };
      if (this.inCone(o, fwd, t.pos.x, 1.6, t.pos.z) && (dd < 1.6 || this.grid.lineOfSight(this.pos, face))) {
        const r = lightTerminal(t.q, basis, this.rng);
        t.litT = 0;
        t.lastMode = { kind: basis === 'X' ? 'cyan' : 'amber', outcomes: r.outcomes, corrupt: t.reencodeT > 0 ? t.reencodeT : undefined };
        if (r.scrambledNow) {
          this.stats.scrambles++;
          t.reencodeT = this.level.reencodeSeconds;
          this.alarm(t.pos);
          if (this.level.kind === 'uplink') this.uplink = Math.max(0, this.uplink - (this.level.uplinkSeconds ?? 45) * 0.25);
          this.hud.tip(`<b class="c-amber">AMBER</b> asked the screen “0 or 1?” and the cyan code is gone. It re-encodes in ${this.level.reencodeSeconds}s — and the noise is drawing them in.`, 7);
        }
        if (basis === 'X') {
          t.readHold += dt;
          if (this.level.kind === 'code' && t.readHold >= 1.2 && !sameCode(this.knownCode, r.outcomes)) {
            this.knownCode = r.outcomes.slice();
            this.sfx.pickup();
            this.hud.tip(`Code read under cyan: ${codeHtml(r.outcomes)} — take it to the sealed door and press <b>[E]</b>.`, 6);
          }
          if (this.level.kind === 'uplink') {
            if (isIntact(t.q)) {
              this.uplink += dt;
              this.tipOnce('uplink', 'Transmitting. Keep the <b class="c-cyan">cyan</b> beam on the screen.');
            }
          }
        } else t.readHold = 0;
      } else t.readHold = 0;
    }
  }

  /** Bookkeeping + feedback for every qubit change. The physics already happened in rules.ts. */
  private onTransition(z: Zombie, tr: Transition, cause: 'light' | 'bullet' | 'contact'): void {
    if (tr.from === tr.to) {
      if (this.time - z.changedAt < 2.5) return;
      if (cause === 'light' && tr.basis === 'X' && (tr.to === 'plus' || tr.to === 'minus'))
        this.tipOnce('cyanSafe', 'Cyan does not disturb the shamblers — they already have a cyan answer, and asking again gets the same one.');
      if (cause === 'light' && tr.basis === 'Z' && tr.to === 'dead')
        this.tipOnce('amberCorpse', 'Amber on a corpse is safe: it already answered “dead”, and the same question gets the same answer.');
      return;
    }
    z.changedAt = this.time;
    const undecided = (e: Eigen) => e === 'plus' || e === 'minus' || e === 'other';
    if (undecided(tr.from) && tr.to === 'dead') {
      if (cause === 'light') this.stats.amberDropped++;
      if (cause === 'bullet') { this.stats.bulletsAsked++; this.tipOnce('bullet', 'Your bullet asked “dead or alive?” too — that one answered dead.'); }
      this.sfx.collapse();
      if (cause === 'light') this.tipOnce('amberDrop', '<b class="c-amber">AMBER</b> asks everything it touches: dead or alive? About half answer “dead” and drop.');
    } else if (undecided(tr.from) && tr.to === 'alive') {
      if (cause === 'light') this.stats.amberWoke++;
      if (cause === 'bullet') this.stats.bulletsAsked++;
      if (z.raised) this.stats.raisedCameBackAlive++;
      this.sfx.charge();
      if (cause === 'light') this.tipOnce('amberWake', 'The rest answered “alive” — solid now, and fast. Shoot them.');
      if (z.raised) this.tipOnce('raisedAlive', 'That corpse came back <b>alive</b>. “Dead” was only true until you asked it something else.', 7);
    } else if (tr.from === 'dead' && undecided(tr.to)) {
      this.stats.cyanRaised++;
      z.raised = true;
      z.stun = 1.2;
      this.sfx.revive();
      this.tipOnce('raise', 'It got up. <b class="c-cyan">CYAN</b> asked the corpse a different question, and that erased “dead”. Now it is a coin flip again.', 8);
    }
  }

  // ------------------------------------------------------------------ horde
  private alarm(at: Point): void {
    this.sfx.alarm();
    const sp = [...this.map.spawners].sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z));
    for (let i = 0; i < 6; i++) {
      const p = sp[i % Math.min(2, sp.length)]!;
      this.spawnZombie(p, 1.2, this.rng() < this.level.spawn.minus ? 1 : 0);
    }
  }

  private liveCount(): number {
    let n = 0;
    for (const z of this.zombies) if (eigen(z.theta) !== 'dead') n++;
    return n;
  }

  private stepSpawns(dt: number): void {
    const s = this.level.spawn;
    const rate = s.rate0 + (s.rate1 - s.rate0) * Math.min(1, this.time / s.ramp);
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (this.liveCount() >= s.cap) break;
      const far = this.map.spawners.filter(p => Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > 9);
      const pool = far.length ? far : this.map.spawners;
      const p = pool[Math.floor(this.rng() * pool.length)]!;
      this.spawnZombie(p, 1.4, this.rng() < s.minus ? 1 : 0);
    }
    // corpse budget: forget the oldest far-away corpses
    if (this.zombies.length > 140) {
      const idx = this.zombies.findIndex(z => eigen(z.theta) === 'dead' && Math.hypot(z.x - this.pos.x, z.z - this.pos.z) > 20);
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
      if (st === 'dead') { z.speed = 0; continue; }
      if (z.stun > 0) { z.stun -= dt; z.speed = 0; continue; }
      const dx = this.pos.x - z.x, dz = this.pos.z - z.z;
      const dist = Math.hypot(dx, dz);
      let mx: number, mz: number;
      if (dist < 7 && this.grid.lineOfSight(z, this.pos)) { mx = dx / dist; mz = dz / dist; }
      else {
        const f = flowDirection(this.grid, this.flow, cellOf(z));
        if (f) { mx = f.x; mz = f.z; } else { mx = dx / (dist || 1); mz = dz / (dist || 1); }
      }
      // separation
      for (const o of zs) {
        if (o === z || eigen(o.theta) === 'dead') continue;
        const ox = z.x - o.x, oz = z.z - o.z, d2 = ox * ox + oz * oz;
        if (d2 > 0.0001 && d2 < 0.5) { const d = Math.sqrt(d2); mx += (ox / d) * (0.7 - d) * 1.6; mz += (oz / d) * (0.7 - d) * 1.6; }
      }
      const ml = Math.hypot(mx, mz) || 1;
      const sp = st === 'alive' ? 3.1 : 1.25;
      z.speed = sp;
      if (dist > 0.75) { z.x += (mx / ml) * sp * dt; z.z += (mz / ml) * sp * dt; }
      this.grid.collide(z, ZOMBIE_R);
      const want = Math.atan2(dx, dz);
      let diff = want - z.facing; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      z.facing += diff * Math.min(1, dt * 6);

      // contact with the player
      if (dist < 0.9) {
        if (st !== 'alive') {
          const tr = contact(z, this.rng);
          this.onTransition(z, tr, 'contact');
          if (tr.bites) this.tipOnce('contact', 'It touched you — and touching asks “dead or alive?” too. This one answered alive.');
          else this.tipOnce('contactDead', 'It touched you and answered “dead”. Lucky.');
        }
        if (eigen(z.theta) === 'alive' && z.biteCd <= 0) {
          z.biteCd = 0.9;
          this.hp -= 14;
          this.stats.bites++;
          this.sfx.bite();
          this.hud.damage();
          // shove the player back a little
          this.pos.x -= (dx / (dist || 1)) * -0.25; this.pos.z -= (dz / (dist || 1)) * -0.25;
          this.grid.collide(this.pos, PLAYER_R);
        }
      }
      if (st === 'alive' && dist < 14 && this.rng() < dt * 0.08) this.sfx.groan();
    }
  }

  // ------------------------------------------------------------------ objectives
  private stepObjectives(dt: number): void {
    const t = this.term;
    if (t && t.reencodeT > 0) {
      t.reencodeT -= dt;
      if (t.reencodeT <= 0) { reencode(t.q); t.reencodeT = 0; this.hud.tip('The terminal re-encoded its code in <b class="c-cyan">cyan</b>. Read it with cyan this time.'); }
    }
    if (this.level.kind === 'uplink' && !this.exitActive && this.uplink >= (this.level.uplinkSeconds ?? 45)) {
      this.exitActive = true;
      this.beacon?.setActive(true);
      this.sfx.good();
      this.hud.tip('Uplink complete. The chopper is coming — reach the extraction beacon!', 7);
    }
    for (const d of this.doors) {
      if (d.open && d.openT < 1) { d.openT = Math.min(1, d.openT + dt * 1.2); d.mesh.position.y = 1.5 - d.openT * 3.1; }
    }
    const e = this.map.exits[0];
    if (e && this.exitActive && Math.hypot(e.x - this.pos.x, e.z - this.pos.z) < 1.6) this.end('win');
  }

  private stepPickups(dt: number): void {
    for (const p of this.pickups) {
      if (p.respawn > 0) { p.respawn -= dt; p.obj.visible = p.respawn <= 0; continue; }
      p.obj.rotation.y += dt * 1.5;
      if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) > 1.1) continue;
      if (p.kind === 'med') {
        if (this.hp >= 100) continue;
        this.hp = Math.min(100, this.hp + 45);
      } else {
        this.wstate[0]!.reserve += 60; this.wstate[1]!.reserve += 10;
      }
      this.sfx.pickup();
      p.respawn = 40; p.obj.visible = false;
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
    r === 'win' ? this.sfx.good() : this.sfx.bad();
    setTimeout(() => this.opts.onEnd(r, { ...this.stats }), r === 'dead' ? 900 : 300);
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
    // camera
    const sway = scoped ? 0.0022 : 0;
    this.camera.position.set(this.pos.x, EYE + this.y + Math.sin(this.bob * 2) * 0.03 * (1 - this.adsT), this.pos.z);
    this.camera.rotation.set(this.pitch + this.recoil + Math.sin(this.time * 1.3) * sway, this.yaw + Math.cos(this.time * 0.9) * sway, 0);
    const fov = BASE_FOV + (w.adsFov - BASE_FOV) * (w.scope ? (this.adsT > 0.92 ? 1 : this.adsT * 0.3) : this.adsT);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    // flashlight
    const col = this.filter === 'Z' ? COLORS.amber : COLORS.cyan;
    this.flashlight.color.setHex(col);
    const flicker = this.battery < 15 ? (Math.random() < 0.15 ? 0.3 : 1) : 1;
    this.flashlight.intensity = this.filter === 'off' ? 0 : 55 * flicker;
    this.flashlight.position.set(0.25 * (1 - this.adsT), -0.15 * (1 - this.adsT), 0);

    // zombies
    for (const z of this.zombies) {
      z.view.root.position.set(z.x, 0, z.z);
      z.view.root.rotation.y = z.facing;
      z.view.update(dt, eigen(z.theta), z.speed, this.time);
    }
    // terminal screen
    const t = this.term;
    if (t) {
      const progress = this.level.kind === 'uplink' ? this.uplink / (this.level.uplinkSeconds ?? 45) : -1;
      const mode: ScreenMode = t.litT < 0.25 ? t.lastMode : t.reencodeT > 0 ? { kind: 'reencode', seconds: t.reencodeT } : { kind: 'dark' };
      t.view.draw(mode, progress);
    }
    // fx
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]!;
      f.life -= dt || 0.016;
      const mat = (f.obj as THREE.Mesh).material as THREE.Material & { opacity: number };
      mat.opacity = Math.max(0, f.life / f.max) * (f.kind === 'tracer' ? 0.8 : 1);
      if (f.life <= 0) { this.scene.remove(f.obj); this.fx.splice(i, 1); }
    }
    this.beacon && (this.beacon.group.children[0]!.rotation.y += dt);

    // view-model
    for (let i = 0; i < this.guns.length; i++) this.guns[i]!.group.visible = i === this.weapon && !scoped;
    const g = this.guns[this.weapon]!.group;
    const hip = new THREE.Vector3(0.11, -0.1, -0.32), ads = new THREE.Vector3(0, w.scope ? -0.056 : -0.037, -0.22);
    const p = hip.lerp(ads, this.adsT);
    const moving = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 4.3) * (1 - this.adsT * 0.8);
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
    this.hud.update(this.hudState(scoped), dt);
  }

  private inspect(): string | null {
    if (this.adsT < 0.5) return null;
    const o = this.eye(), d = this.aimDir(0);
    const hit = this.castRay(o, d, 40);
    // corpses are not in castRay (bullets ignore them) — check them separately for the inspector
    let target = hit.zombie, best = hit.t;
    for (const z of this.zombies) {
      if (eigen(z.theta) !== 'dead') continue;
      const t = slab(o, d, z.x - 0.6, 0, z.z - 0.6, z.x + 0.6, 0.5, z.z + 0.6);
      if (t < best) { best = t; target = z; }
    }
    if (target) {
      const st = eigen(target.theta);
      const amber = '<b class="c-amber">AMBER (dead or alive?)</b>', cyan = '<b class="c-cyan">CYAN (◯ or ◇?)</b>';
      if (st === 'dead') return `${amber}: DEAD — certain<br>${cyan}: unknown — 50/50`;
      if (st === 'alive') return `${amber}: ALIVE — certain<br>${cyan}: unknown — 50/50`;
      if (st === 'plus' || st === 'minus') return `${cyan}: ${st === 'plus' ? '<span class="g-plus">◯</span>' : '<span class="g-minus">◇</span>'} — certain<br>${amber}: undecided — 50/50`;
    }
    if (this.term) {
      const t = this.term;
      const tt = slab(o, d, t.pos.x - 1, 0, t.pos.z - 1, t.pos.x + 1, 2.4, t.pos.z + 1);
      if (tt < hit.t + 0.01 && tt < 40) return t.reencodeT > 0 ? `Screen: scrambled — re-encoding ${Math.ceil(t.reencodeT)}s` : 'Screen: code stored in <b class="c-cyan">CYAN</b>';
    }
    return null;
  }

  private hudState(scoped: boolean): HudState {
    const w = WEAPONS[this.weapon]!, s = this.wstate[this.weapon]!;
    let objective = this.level.objective;
    let progress: HudState['progress'] = null;
    let prompt: string | null = null;
    if (this.level.kind === 'code') {
      const open = this.doors.some(d => d.open);
      objective = open ? 'Reach the extraction beacon' : this.knownCode ? 'Enter the code at the sealed door' : 'Read the code: hold CYAN on the terminal screen';
      for (const d of this.doors) {
        const c = center(d.cell);
        if (!d.open && Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < 3.2) prompt = this.knownCode ? `[E] Enter code ${codeHtml(this.knownCode)}` : '[E] Sealed — needs the terminal code';
      }
    } else if (this.level.kind === 'uplink') {
      const total = this.level.uplinkSeconds ?? 45;
      objective = this.exitActive ? 'Reach the extraction beacon' : 'Hold CYAN on the uplink terminal';
      if (!this.exitActive) progress = { value: this.uplink, total, label: `UPLINK ${Math.floor(this.uplink)} / ${total}s` };
    }
    const mm = Math.floor(this.time / 60), ss = Math.floor(this.time % 60);
    const spreadPx = Math.max(3, this.currentSpread() * (innerHeight / 2) / Math.tan((this.camera.fov * Math.PI) / 360));
    return {
      hp: this.hp, weapon: w.name, mag: s.mag, magSize: w.magSize, reserve: s.reserve,
      reloading: s.reloadT >= 0 ? s.reloadT / w.reload : -1, filter: this.filter, battery: this.battery,
      objective, timer: `${mm}:${String(ss).padStart(2, '0')}`, inspector: this.inspect(), spread: spreadPx,
      ads: this.adsT, scoped, prompt, code: this.level.kind === 'code' ? this.knownCode : null, progress, alive: this.liveCount(),
    };
  }

  private addTracer(a: THREE.Vector3, b: THREE.Vector3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }));
    this.scene.add(line);
    this.fx.push({ obj: line, life: 0.06, max: 0.06, kind: 'tracer' });
  }

  private addSpark(p: THREE.Vector3, color: number): void {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(p);
    this.scene.add(m);
    this.fx.push({ obj: m, life: 0.12, max: 0.12, kind: 'spark' });
  }

  // ------------------------------------------------------------------ teardown / debug
  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ended = true;
    for (const d of this.disposers) d();
    this.hud.destroy();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    delete (window as unknown as { __dr?: unknown }).__dr;
  }

  private installDebug(): void {
    const api = {
      step: (n = 1) => { for (let i = 0; i < n && !this.ended; i++) this.step(); this.render(STEP); return api.state(); },
      state: () => {
        const counts: Record<string, number> = { dead: 0, alive: 0, plus: 0, minus: 0, other: 0 };
        for (const z of this.zombies) counts[eigen(z.theta)]!++;
        return {
          hp: this.hp, pos: { ...this.pos }, yaw: this.yaw, pitch: this.pitch, filter: this.filter, battery: this.battery,
          weapon: WEAPONS[this.weapon]!.name, ...this.wstate[this.weapon]!, ads: this.adsT, fov: this.camera.fov,
          counts, knownCode: this.knownCode, code: this.term?.q.code ?? null, intact: this.term ? isIntact(this.term.q) : null,
          reencode: this.term?.reencodeT ?? 0, uplink: this.uplink, ended: this.ended, stats: { ...this.stats },
        };
      },
      key: (code: string, down: boolean) => { if (down) { this.keys.add(code); this.onKey(code); } else this.keys.delete(code); },
      mouse: (button: 0 | 2, down: boolean) => { if (button === 0) { this.mouseL = down; if (down) this.firedThisPress = false; } else this.mouseR = down; },
      look: (yaw: number, pitch: number) => { this.yaw = yaw; this.pitch = pitch; },
      lookAt: (x: number, y: number, z: number) => {
        const dx = x - this.pos.x, dy = y - EYE, dz = z - this.pos.z;
        this.yaw = Math.atan2(-dx, -dz); this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      },
      teleport: (x: number, z: number) => { this.pos.x = x; this.pos.z = z; },
      setFilter: (f: Filter) => this.setFilter(f),
      setHp: (v: number) => { this.hp = v; },
      spawn: (n: number, kind: 'dead' | 'plus' | 'minus', x: number, z: number) => { for (let i = 0; i < n; i++) this.spawnZombie({ x, z }, 0.1, kind); },
      clear: () => { for (const z of this.zombies) { this.scene.remove(z.view.root); z.view.dispose(); } this.zombies = []; },
      /** Apply one light/contact rule to every zombie, bypassing geometry — for statistics checks. */
      lightAll: (basis: Basis) => { for (const z of this.zombies) this.onTransition(z, lightTarget(z, basis, this.rng), 'light'); return api.state().counts; },
      contactAll: () => { for (const z of this.zombies) this.onTransition(z, contact(z, this.rng), 'contact'); return api.state().counts; },
      freeze: (on: boolean) => { this.level.spawn.cap = on ? 0 : 30; this.spawnAcc = 0; },
      terminal: () => this.term ? { pos: this.term.pos, symbols: this.term.q.symbols.map(s => eigen(s)) } : null,
    };
    (window as unknown as { __dr: typeof api }).__dr = api;
  }
}

/** Ray vs axis-aligned box; returns entry distance or Infinity. */
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
