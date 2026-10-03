// The complete rule set: every interaction in the game that touches a qubit goes
// through one of these functions. Nothing else is allowed to write `theta`.
import { DEAD, eigen, measure, prepare, wrap } from '../quantum/qubit';
import type { Basis, Eigen, RandomSource } from '../quantum/qubit';

export interface QTarget { theta: number }

export interface Transition {
  from: Eigen;
  to: Eigen;
  basis: Basis;
  outcome: 0 | 1;
  certain: boolean;
}

function apply(t: QTarget, basis: Basis, random: RandomSource): Transition {
  const from = eigen(t.theta);
  const m = measure(t.theta, basis, random);
  t.theta = m.theta;
  return { from, to: eigen(m.theta), basis, outcome: m.outcome, certain: m.certain };
}

/** A flashlight cone (with line of sight) is a projective measurement in its basis. */
export const lightTarget = (t: QTarget, basis: Basis, random: RandomSource): Transition => apply(t, basis, random);

/** A bullet needs to know whether it hit something alive: that is a Z measurement. */
export function bulletHit(t: QTarget, random: RandomSource): Transition & { damage: boolean } {
  const tr = apply(t, 'Z', random);
  return { ...tr, damage: tr.to === 'alive' };
}

/** A bite needs the zombie to be alive: contact is a Z measurement too. */
export function contact(t: QTarget, random: RandomSource): Transition & { bites: boolean } {
  const tr = apply(t, 'Z', random);
  return { ...tr, bites: tr.to === 'alive' };
}

/** Destroying an ALIVE body is a classical, irreversible event: it leaves a corpse, |0⟩. */
export function kill(t: QTarget): void { t.theta = DEAD; }

export const spawnState = (outcome: 0 | 1): number => prepare('X', outcome);

// ---------------------------------------------------------------- terminals
// A terminal stores its code in qubits prepared in the X basis: + or −.
export interface TerminalQ { symbols: number[]; code: (0 | 1)[] }

export function makeTerminal(code: (0 | 1)[]): TerminalQ {
  return { code: [...code], symbols: code.map(o => prepare('X', o)) };
}

export function isIntact(t: TerminalQ): boolean {
  return t.symbols.every((s, i) => eigen(s) === (t.code[i] === 0 ? 'plus' : 'minus'));
}

export interface TerminalReadout { basis: Basis; outcomes: (0 | 1)[]; scrambledNow: boolean }

/** Shining a light on the screen measures every symbol in that light's basis. */
export function lightTerminal(t: TerminalQ, basis: Basis, random: RandomSource): TerminalReadout {
  const wasIntact = isIntact(t);
  const outcomes = t.symbols.map((s, i) => {
    const m = measure(s, basis, random);
    t.symbols[i] = m.theta;
    return m.outcome;
  });
  return { basis, outcomes, scrambledNow: wasIntact && !isIntact(t) };
}

/** The terminal re-encodes its stored code into fresh qubits (a new preparation). */
export function reencode(t: TerminalQ): void {
  t.symbols = t.code.map(o => prepare('X', o));
}

export const sameCode = (a: readonly (0 | 1)[] | null, b: readonly (0 | 1)[]): boolean =>
  !!a && a.length === b.length && a.every((v, i) => v === b[i]);

export { wrap };
