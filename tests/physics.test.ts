import { describe, expect, it } from 'vitest';
import { ALIVE, DEAD, MINUS, PLUS, amplitudes, eigen, measure, probPositive } from '../src/quantum/qubit';
import { seededRandom } from '../src/quantum/random';
import { bulletHit, contact, isIntact, kill, lightTarget, lightTerminal, makeTerminal, reencode } from '../src/game/rules';
import { Grid, cellOf, flowField, parseMap } from '../src/game/grid';
import { MISSIONS } from '../src/levels';

const N = 20000;
const within = (x: number, p: number, n = N) => Math.abs(x / n - p) < 4 * Math.sqrt((p * (1 - p)) / n) + 1e-9;

describe('Born rule', () => {
  it('amplitudes are normalised and probabilities match cos²((θ−φ)/2)', () => {
    for (let th = 0; th < 2 * Math.PI; th += 0.1) {
      const [a, b] = amplitudes(th);
      expect(a * a + b * b).toBeCloseTo(1, 12);
      expect(probPositive(th, 'Z')).toBeCloseTo(a * a, 12);
      expect(probPositive(th, 'X')).toBeCloseTo(((a + b) / Math.SQRT2) ** 2, 12);
    }
  });

  it('sampled outcome frequencies pass χ² at several angles', () => {
    const rng = seededRandom(7);
    for (const th of [0.3, 1.1, PLUS, 2.5, 4.0]) {
      for (const basis of ['Z', 'X'] as const) {
        const p = probPositive(th, basis);
        let zeros = 0;
        for (let i = 0; i < N; i++) if (measure(th, basis, rng).outcome === 0) zeros++;
        const e0 = N * p, e1 = N * (1 - p);
        const chi = (e0 > 0 ? (zeros - e0) ** 2 / e0 : 0) + (e1 > 0 ? (N - zeros - e1) ** 2 / e1 : 0);
        expect(chi).toBeLessThan(10.83); // p = 0.001, 1 dof
      }
    }
  });

  it('eigenstates give certain outcomes and measurement collapses onto the axis', () => {
    const rng = seededRandom(1);
    expect(measure(DEAD, 'Z', rng)).toMatchObject({ outcome: 0, certain: true });
    expect(measure(ALIVE, 'Z', rng)).toMatchObject({ outcome: 1, certain: true });
    expect(measure(PLUS, 'X', rng)).toMatchObject({ outcome: 0, certain: true });
    expect(measure(MINUS, 'X', rng)).toMatchObject({ outcome: 1, certain: true });
    for (let i = 0; i < 100; i++) expect(['plus', 'minus']).toContain(eigen(measure(DEAD, 'X', rng).theta));
  });
});

describe('game rules', () => {
  it('repeated same-basis light never changes the answer', () => {
    const rng = seededRandom(3);
    for (let i = 0; i < 2000; i++) {
      const z = { theta: PLUS };
      const first = lightTarget(z, 'Z', rng).to;
      for (let k = 0; k < 20; k++) expect(lightTarget(z, 'Z', rng).to).toBe(first);
    }
  });

  it('amber on a fresh (+) horde drops about half', () => {
    const rng = seededRandom(4);
    let dead = 0;
    for (let i = 0; i < N; i++) if (lightTarget({ theta: PLUS }, 'Z', rng).to === 'dead') dead++;
    expect(within(dead, 0.5)).toBe(true);
  });

  it('cyan leaves fresh (+/−) zombies untouched', () => {
    const rng = seededRandom(5);
    for (let i = 0; i < 1000; i++) {
      const p = { theta: PLUS }, m = { theta: MINUS };
      expect(lightTarget(p, 'X', rng).to).toBe('plus');
      expect(lightTarget(m, 'X', rng).to).toBe('minus');
    }
  });

  it('amber on a corpse is safe; cyan on a corpse revives it to a coin flip', () => {
    const rng = seededRandom(6);
    let alive = 0;
    for (let i = 0; i < N; i++) {
      const z = { theta: DEAD };
      expect(lightTarget(z, 'Z', rng).to).toBe('dead');
      expect(['plus', 'minus']).toContain(lightTarget(z, 'X', rng).to);
      if (contact(z, rng).bites) alive++;
    }
    expect(within(alive, 0.5)).toBe(true);
  });

  it('bullets and bites are Z measurements; kills leave |0⟩', () => {
    const rng = seededRandom(8);
    let dmg = 0;
    for (let i = 0; i < N; i++) if (bulletHit({ theta: MINUS }, rng).damage) dmg++;
    expect(within(dmg, 0.5)).toBe(true);
    expect(bulletHit({ theta: DEAD }, rng).damage).toBe(false);
    expect(contact({ theta: ALIVE }, rng).bites).toBe(true);
    const z = { theta: ALIVE };
    kill(z);
    expect(eigen(z.theta)).toBe('dead');
  });

  it('amber destroys a cyan-coded terminal; each symbol re-reads correctly half the time', () => {
    const rng = seededRandom(9);
    const code: (0 | 1)[] = [0, 1, 1, 0];
    let correct = 0, total = 0;
    for (let i = 0; i < 5000; i++) {
      const t = makeTerminal(code);
      expect(lightTerminal(t, 'X', rng).outcomes).toEqual(code); // cyan read is exact and harmless
      expect(isIntact(t)).toBe(true);
      expect(lightTerminal(t, 'Z', rng).scrambledNow).toBe(true);
      const reread = lightTerminal(t, 'X', rng).outcomes;
      reread.forEach((o, k) => { total++; if (o === code[k]) correct++; });
      reencode(t);
      expect(isIntact(t)).toBe(true);
    }
    expect(within(correct, 0.5, total)).toBe(true);
  });
});

describe('missions', () => {
  for (const ms of MISSIONS) {
    it(`${ms.name}: map matches its definition and everything is reachable`, () => {
      const m = parseMap(ms.map);
      const open = m.solid.slice();
      for (const d of m.doors) open[d.y * m.w + d.x] = 0;
      const grid = new Grid(m.w, m.h, open);
      const dist = flowField(grid, cellOf(m.start));
      for (let i = 0; i < open.length; i++) if (!open[i]) expect(dist[i], `${ms.name} tile ${i % m.w},${(i / m.w) | 0}`).toBeGreaterThanOrEqual(0);
      expect(m.exits.length).toBe(1);
      expect(m.terminals.filter(Boolean).length).toBe(ms.terminals.length);
      expect(m.doors.length).toBe(ms.doors.length);
      expect(m.lamps.length).toBe(ms.lamps.length);
      m.lamps.forEach((l, i) => expect(l.basis, `${ms.name} lamp ${i}`).toBe(ms.lamps[i]!.basis));
      // every terminal has an open face to read it from
      for (const t of m.terminals) {
        const c = cellOf(t);
        expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => dist[(c.y + dy!) * m.w + c.x + dx!]! >= 0), `${ms.name} terminal face`).toBe(true);
      }
      for (const k of ['a', 'b']) if (JSON.stringify(ms.steps.map(s => s.done.toString())).includes(`'${k}'`)) expect(m.markers[k], `${ms.name} marker ${k}`).toBeTruthy();
      if (ms.spawn.cap > 0) expect(m.spawners.length).toBeGreaterThan(0);
    });
  }
});
