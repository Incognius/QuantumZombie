// One qubit restricted to the X–Z great circle of the Bloch sphere.
// The game only ever prepares Z/X eigenstates and measures in Z or X, so real
// amplitudes are exact: |ψ⟩ = cos(θ/2)|0⟩ + sin(θ/2)|1⟩, θ ∈ [0, 2π).
//   θ = 0    → |0⟩  (DEAD)      θ = π     → |1⟩  (ALIVE)
//   θ = π/2  → |+⟩              θ = 3π/2  → |−⟩
// θ and θ + 2π differ only by a global sign, so θ is kept modulo 2π.

export type Basis = 'Z' | 'X';
export type RandomSource = () => number;

const TAU = Math.PI * 2;
export const AXIS: Readonly<Record<Basis, number>> = { Z: 0, X: Math.PI / 2 };
export const DEAD = 0;
export const ALIVE = Math.PI;
export const PLUS = Math.PI / 2;
export const MINUS = (3 * Math.PI) / 2;

const EPS = 1e-9;

export function wrap(theta: number): number {
  const t = theta % TAU;
  return t < 0 ? t + TAU : t;
}

export function amplitudes(theta: number): [number, number] {
  return [Math.cos(theta / 2), Math.sin(theta / 2)];
}

/** Born rule: probability of the "+axis" outcome (Z: dead, X: +) = cos²((θ − φ)/2). */
export function probPositive(theta: number, basis: Basis): number {
  const c = Math.cos((theta - AXIS[basis]) / 2);
  return Math.min(1, Math.max(0, c * c));
}

export interface Measurement {
  /** 0 = positive end of the axis (Z: DEAD, X: +), 1 = negative end (Z: ALIVE, X: −). */
  outcome: 0 | 1;
  /** Post-measurement state (projected onto the outcome's eigenstate). */
  theta: number;
  /** True when the outcome was certain, i.e. the state was already an eigenstate. */
  certain: boolean;
}

export function measure(theta: number, basis: Basis, random: RandomSource): Measurement {
  const p = probPositive(theta, basis);
  const certain = p >= 1 - EPS || p <= EPS;
  const outcome: 0 | 1 = p >= 1 - EPS ? 0 : p <= EPS ? 1 : random() < p ? 0 : 1;
  const phi = AXIS[basis];
  return { outcome, theta: wrap(outcome === 0 ? phi : phi + Math.PI), certain };
}

export function prepare(basis: Basis, outcome: 0 | 1): number {
  return wrap(AXIS[basis] + (outcome === 0 ? 0 : Math.PI));
}

/** Which eigenstate (if any) the qubit is in. Used for rendering and the ADS inspector. */
export type Eigen = 'dead' | 'alive' | 'plus' | 'minus' | 'other';
export function eigen(theta: number): Eigen {
  const t = wrap(theta);
  const near = (a: number) => Math.abs(Math.atan2(Math.sin(t - a), Math.cos(t - a))) < 1e-6;
  if (near(DEAD)) return 'dead';
  if (near(ALIVE)) return 'alive';
  if (near(PLUS)) return 'plus';
  if (near(MINUS)) return 'minus';
  return 'other';
}
