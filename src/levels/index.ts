// Legend: # wall · P start · S spawner · C corpse (DEAD) · U undecided (+) · V undecided (−)
//         T terminal · D code door · E extraction · M medkit · A ammo
export type LevelKind = 'extract' | 'code' | 'uplink';

export interface LevelDef {
  id: number;
  name: string;
  kind: LevelKind;
  briefing: string[];
  objective: string;
  map: string[];
  /** Spawns per second at t = 0 and after `ramp` seconds; fraction of spawns prepared in − instead of +. */
  spawn: { rate0: number; rate1: number; ramp: number; minus: number; cap: number };
  code?: (0 | 1)[];
  uplinkSeconds?: number;
  reencodeSeconds: number;
  seed: number;
}

export const LEVELS: LevelDef[] = [
  {
    id: 1,
    name: 'Lights Out',
    kind: 'extract',
    briefing: [
      'Power is out across the depot. Something is shuffling in the dark.',
      'Your flashlight has two filters. AMBER [Z] asks anything it touches: dead or alive?',
      'CYAN [X] asks a different question. Reach the extraction beacon.',
    ],
    objective: 'Reach the extraction beacon',
    map: [
      '##########################################',
      '#......#.................................#',
      '#..P...#.....U..U.........#######.....S..#',
      '#......#...U...U..U.......#.....#........#',
      '#..........U..U...........#..A..#........#',
      '#......#.....U...U........#.....#........#',
      '#..M...#..................###.###........#',
      '#......#########.....######.......U...U..#',
      '########.......#.....#..........U....U...#',
      '#S.............#.....#...............E...#',
      '#..............................S.........#',
      '##########################################',
    ],
    spawn: { rate0: 0.15, rate1: 0.45, ramp: 120, minus: 0, cap: 22 },
    reencodeSeconds: 20,
    seed: 101,
  },
  {
    id: 2,
    name: "Don't Look Back",
    kind: 'code',
    briefing: [
      'The extraction room is sealed. Its code sits on a terminal at the end of the morgue hall.',
      'The code is written in CYAN. Read it under AMBER and it is gone.',
      'The hall is full of the dead. Keep them that way.',
    ],
    objective: 'Read the code at the terminal (hold CYAN on its screen)',
    map: [
      '##############################################',
      '####.....E.....###############################',
      '####...........###############################',
      '####...M.......#########.......S.......#######',
      '#######.D.#####.......................A.######',
      '#.............#.C..C..C..#####..C..C..C.....##',
      '#...P...........................................T#',
      '#.............#.C..C..C..#####..C..C..C..C..C.##',
      '#....A........#.......................C.....###',
      '#.............######...........S.......#######',
      '####.S.##############################',
      '#####################################',
    ],
    spawn: { rate0: 0.2, rate1: 0.6, ramp: 150, minus: 0, cap: 26 },
    code: [0, 1, 1, 0],
    reencodeSeconds: 20,
    seed: 202,
  },
  {
    id: 3,
    name: 'Last Signal',
    kind: 'uplink',
    briefing: [
      'The uplink terminal must broadcast for 45 seconds to call the chopper.',
      'It only transmits while you hold CYAN on it. AMBER on the screen corrupts the upload.',
      'They are coming from every side. The dead will pile up around you.',
    ],
    objective: 'Hold CYAN on the uplink terminal',
    map: [
      '##################################',
      '#S..........#########..........S.#',
      '#...........#.......#............#',
      '#....##.....#...A...#.....##.....#',
      '#....##..........................#',
      '#...........C...........C........#',
      '#######.........C.C.........######',
      '#.M..............T...............#',
      '#######.........C...C.......######',
      '#...........C.........C..........#',
      '#....##.....................##...#',
      '#....##.....#...P...#.......##...#',
      '#...........#.......#............#',
      '#S..........#########......E...S.#',
      '##################################',
    ],
    spawn: { rate0: 0.35, rate1: 1.1, ramp: 90, minus: 0.5, cap: 34 },
    code: [1, 0, 0, 1],
    uplinkSeconds: 45,
    reencodeSeconds: 10,
    seed: 303,
  },
];
