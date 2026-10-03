// Tile world: ASCII map → grid, wall collision, line of sight, horde flow field.
export const TILE = 2; // metres per tile

export interface Cell { x: number; y: number }
export interface Point { x: number; z: number }

export interface ParsedMap {
  w: number;
  h: number;
  solid: Uint8Array; // 1 = wall, closed door or terminal
  start: Point;
  spawners: Point[];
  corpses: Point[];
  plus: Point[];
  minus: Point[];
  runners: Point[];
  terminals: Point[]; // index = digit - 1
  doors: Cell[];      // reading order
  lamps: { pos: Point; basis: 'Z' | 'X' }[]; // reading order
  exits: Point[];
  medkits: Point[];
  markers: Record<string, Point>;
}

export const center = (c: Cell): Point => ({ x: (c.x + 0.5) * TILE, z: (c.y + 0.5) * TILE });
export const cellOf = (p: Point): Cell => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.z / TILE) });

export function parseMap(rows: readonly string[]): ParsedMap {
  const h = rows.length;
  const w = Math.max(...rows.map(r => r.length));
  const solid = new Uint8Array(w * h);
  const m: ParsedMap = {
    w, h, solid, start: { x: TILE, z: TILE }, spawners: [], corpses: [], plus: [], minus: [], runners: [],
    terminals: [], doors: [], lamps: [], exits: [], medkits: [], markers: {},
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y]![x] ?? '#';
      const p = center({ x, y });
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (ch === '#' || ch === ' ' || edge) { solid[y * w + x] = 1; continue; }
      if (ch >= '1' && ch <= '9') { m.terminals[Number(ch) - 1] = p; solid[y * w + x] = 1; continue; }
      if (ch >= 'a' && ch <= 'z') { m.markers[ch] = p; continue; }
      switch (ch) {
        case 'P': m.start = p; break;
        case 'S': m.spawners.push(p); break;
        case 'C': m.corpses.push(p); break;
        case 'U': m.plus.push(p); break;
        case 'V': m.minus.push(p); break;
        case 'R': m.runners.push(p); break;
        case 'D': m.doors.push({ x, y }); solid[y * w + x] = 1; break;
        case 'L': m.lamps.push({ pos: p, basis: 'Z' }); break;
        case 'K': m.lamps.push({ pos: p, basis: 'X' }); break;
        case 'E': m.exits.push(p); break;
        case 'M': m.medkits.push(p); break;
      }
    }
  }
  return m;
}

export class Grid {
  constructor(public readonly w: number, public readonly h: number, public readonly solid: Uint8Array) {}

  isSolid(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return true;
    return this.solid[cy * this.w + cx] === 1;
  }

  /** Push a circle out of every solid tile it overlaps. Mutates and returns p. */
  collide(p: Point, r: number): Point {
    for (let pass = 0; pass < 2; pass++) {
      const cx0 = Math.floor((p.x - r) / TILE), cx1 = Math.floor((p.x + r) / TILE);
      const cy0 = Math.floor((p.z - r) / TILE), cy1 = Math.floor((p.z + r) / TILE);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (!this.isSolid(cx, cy)) continue;
          const nx = Math.max(cx * TILE, Math.min(p.x, (cx + 1) * TILE));
          const nz = Math.max(cy * TILE, Math.min(p.z, (cy + 1) * TILE));
          let dx = p.x - nx, dz = p.z - nz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 < 1e-10) { // centre inside the tile: push out along the shallowest axis
            const l = p.x - cx * TILE, rr = (cx + 1) * TILE - p.x, t = p.z - cy * TILE, b = (cy + 1) * TILE - p.z;
            const mn = Math.min(l, rr, t, b);
            if (mn === l) p.x = cx * TILE - r; else if (mn === rr) p.x = (cx + 1) * TILE + r;
            else if (mn === t) p.z = cy * TILE - r; else p.z = (cy + 1) * TILE + r;
            continue;
          }
          const d = Math.sqrt(d2);
          dx /= d; dz /= d;
          p.x = nx + dx * r; p.z = nz + dz * r;
        }
      }
    }
    return p;
  }

  /** Distance along the ray (dx,dz normalised) until the first solid tile (Amanatides–Woo DDA). */
  rayDistance(ox: number, oz: number, dx: number, dz: number, maxDist: number): number {
    let cx = Math.floor(ox / TILE), cy = Math.floor(oz / TILE);
    if (this.isSolid(cx, cy)) return 0;
    const stepX = dx > 0 ? 1 : -1, stepY = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
    const tDeltaY = dz !== 0 ? Math.abs(TILE / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (cx + 1) * TILE - ox : ox - cx * TILE) / Math.abs(dx)) : Infinity;
    let tMaxY = dz !== 0 ? ((dz > 0 ? (cy + 1) * TILE - oz : oz - cy * TILE) / Math.abs(dz)) : Infinity;
    for (;;) {
      let t: number;
      if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; cx += stepX; }
      else { t = tMaxY; tMaxY += tDeltaY; cy += stepY; }
      if (t > maxDist) return maxDist;
      if (this.isSolid(cx, cy)) return t;
    }
  }

  lineOfSight(a: Point, b: Point): boolean {
    const dx = b.x - a.x, dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return true;
    return this.rayDistance(a.x, a.z, dx / d, dz / d, d) >= d - 1e-6;
  }
}

// ---------------------------------------------------------------- flow field
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/** BFS distance (in tiles) from the target cell to every reachable floor cell; -1 = unreachable. */
export function flowField(grid: Grid, target: Cell): Int32Array {
  const dist = new Int32Array(grid.w * grid.h).fill(-1);
  if (grid.isSolid(target.x, target.y)) return dist;
  const queue = new Int32Array(grid.w * grid.h);
  let head = 0, tail = 0;
  dist[target.y * grid.w + target.x] = 0;
  queue[tail++] = target.y * grid.w + target.x;
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % grid.w, y = (i / grid.w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + N8[k]![0], ny = y + N8[k]![1];
      if (grid.isSolid(nx, ny)) continue;
      const j = ny * grid.w + nx;
      if (dist[j] !== -1) continue;
      dist[j] = dist[i]! + 1;
      queue[tail++] = j;
    }
  }
  return dist;
}

/** Steering direction for an agent standing in `c`: towards the lowest-distance neighbour (no corner cutting). */
export function flowDirection(grid: Grid, dist: Int32Array, c: Cell): Point | null {
  const here = dist[c.y * grid.w + c.x] ?? -1;
  if (here <= 0) return null;
  let best = here, bx = 0, by = 0;
  for (const [ox, oy] of N8) {
    const nx = c.x + ox, ny = c.y + oy;
    if (grid.isSolid(nx, ny)) continue;
    if (ox !== 0 && oy !== 0 && (grid.isSolid(c.x + ox, c.y) || grid.isSolid(c.x, c.y + oy))) continue;
    const d = dist[ny * grid.w + nx]!;
    if (d >= 0 && d < best) { best = d; bx = ox; by = oy; }
  }
  if (bx === 0 && by === 0) return null;
  const l = Math.hypot(bx, by);
  return { x: bx / l, z: by / l };
}
