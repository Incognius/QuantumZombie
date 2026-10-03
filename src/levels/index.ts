// The campaign: escape the city from your basement to the medevac helicopter.
// Map legend: # wall · P start · S spawner · C corpse (DEAD) · U / V undecided (◯ / ◇) · R runner (ALIVE)
//   1-3 terminals (index 0-2) · D doors (index by reading order) · L amber floodlight · K cyan floodlight
//   E exit · M medkit · a-f markers (invisible, used by objectives)
import type { Basis } from '../quantum/qubit';

export interface StepCtx {
  filter: 'Z' | 'X' | 'off';
  read(i: number): boolean;
  door(i: number): boolean;
  lamp(i: number): boolean;
  near(marker: string, r: number): boolean;
  zone(marker: string, r: number): { dead: number; alive: number; undecided: number };
  raised: number;
  uplink: number;
  stats: { kills: number; shots: number };
}

export interface Step {
  goal: string | ((c: StepCtx) => string);
  radio?: string;
  done: (c: StepCtx) => boolean;
  /** This step is "reach the exit": the exit lights up and reaching it completes the step. */
  exit?: boolean;
  /** Where the minimap points: t0 terminal, d0 door, l0 lamp, m:a marker (exit steps point at the exit). */
  target?: string;
}

export interface Concept { title: string; points: string[] }

export interface TerminalDef { label: string; symbols: number; uplink?: number }
export interface DoorDef { label: string; needs: number[] }
export interface LampDef { basis: Basis; label: string; on?: boolean; poweredByDoor?: number }

export interface Mission {
  id: number;
  chapter: string;
  name: string;
  place: string;
  intro: string[];
  concept: Concept;
  outro: string;
  map: string[];
  steps: Step[];
  terminals: TerminalDef[];
  doors: DoorDef[];
  lamps: LampDef[];
  spawn: { rate0: number; rate1: number; ramp: number; minus: number; cap: number };
  reencodeSeconds: number;
  exitKind: 'stairs' | 'car' | 'van' | 'hangar' | 'heli';
  /** Undecided bodies stand still (tutorial). */
  calm?: boolean;
  seed: number;
}

const decided = (c: StepCtx, m: string, r: number) => c.zone(m, r).undecided === 0;

export const MISSIONS: Mission[] = [
  {
    id: 0,
    chapter: 'PROLOGUE',
    name: 'The Basement',
    place: '14 Maple Street · 21:52',
    intro: [
      'October 3rd. 21:14. The Harlow Quantum Facility loses containment.',
      'By ten o\'clock the dead in this city are not dead. Not alive either. Something in between — until something looks at them.',
      'You wake up in your basement. The power is out. Your radio crackles.',
    ],
    concept: { title: 'Two questions', points: [
      'Every body tonight is a <b>qubit</b>: until something asks, it is not dead and not alive — it <b>flickers</b>.',
      '<b class="c-amber">AMBER [Z]</b> asks <i>“dead or alive?”</i>. A flickering body must answer: about half drop <b>dead</b>, half turn <b>alive</b> (solid, red eyes — shoot those). Ask again and you get the same answer.',
      '<b class="c-cyan">CYAN [X]</b> asks a <i>different</i> question. It is the only light that reads door codes. But a corpse it touches loses its “dead” answer and <b>gets back up</b>.',
      'One answer erases the other. That is the whole game.',
    ] },
    outro: 'VARGA: Good. You understand it now. Amber keeps the dead down. Cyan reads the codes — and wakes the dead. Get out of the house. I\'ll guide you to the evacuation point.',
    map: [
      '############################',
      '#.....#.........#....1.....#',
      '#..P..#....U....#..........#',
      '#..........a.........C.....#',
      '#.....#.........#....b.....#',
      '#..M..#.........#..........#',
      '#######################D####',
      '#######################..E.#',
      '############################',
    ],
    terminals: [{ label: 'BASEMENT LOCK', symbols: 3 }],
    doors: [{ label: 'Basement door', needs: [0] }],
    lamps: [],
    steps: [
      {
        goal: 'Turn on your flashlight with the AMBER filter — press [Z]',
        radio: 'VARGA: Can you hear me? This is Dr. Ilse Varga, Harlow Facility. Listen. Your flashlight is the only thing that will keep you alive tonight. Press Z.',
        done: c => c.filter === 'Z',
      },
      {
        goal: 'Something is standing in the laundry room. Shine AMBER on it.',
        radio: 'VARGA: See how it flickers? It is neither dead nor alive. Amber asks it one question — DEAD or ALIVE? — and it has to answer.',
        done: c => decided(c, 'a', 5),
        target: 'm:a',
      },
      {
        goal: c => (c.zone('a', 6).alive > 0 ? 'It answered ALIVE — red eyes. Shoot it! [Left click] · aim [Right click]' : 'It answered DEAD. It will stay down — as long as you only ask it with amber.'),
        radio: 'VARGA: Whatever it answered, it keeps — as long as you keep asking the same question. Red eyes mean alive. Shoot those.',
        done: c => c.zone('a', 60).alive === 0,
        target: 'm:a',
      },
      {
        goal: 'The basement door is locked. Switch to CYAN [X] and shine it on the lock terminal to read the code.',
        radio: 'VARGA: The locks use cyan codes. Only the cyan filter can read them. Amber would scramble them — never point amber at a screen.',
        done: c => c.read(0),
        target: 't0',
      },
      {
        goal: c => (c.raised > 0 ? 'Done.' : 'There is a body by the terminal. Sweep your CYAN light across it.'),
        radio: 'VARGA: Now the part that matters. Cyan asks a DIFFERENT question. A corpse has no answer to it… so it forgets it was ever dead.',
        done: c => c.raised > 0,
        target: 'm:b',
      },
      {
        goal: 'It got back up — undecided again. Make it answer: switch to AMBER [Z] and shine it on the body.',
        radio: 'VARGA: Cyan wiped its answer. Ask it again with amber. Half the time they stay down. Half the time…',
        done: c => decided(c, 'b', 6),
        target: 'm:b',
      },
      {
        goal: c => (c.zone('b', 7).alive > 0 ? 'ALIVE. Kill it.' : 'It stayed down. Lucky.'),
        done: c => c.zone('b', 60).alive === 0,
      },
      {
        goal: 'Walk to the basement door and press [E] to enter the code.',
        done: c => c.door(0),
        target: 'd0',
      },
      { goal: 'Go upstairs.', exit: true, done: () => false },
    ],
    spawn: { rate0: 0, rate1: 0, ramp: 1, minus: 0, cap: 0 },
    reencodeSeconds: 8,
    exitKind: 'stairs',
    calm: true,
    seed: 11,
  },
  {
    id: 1,
    chapter: 'CHAPTER I',
    name: 'Maple Street',
    place: 'Your street · 22:06',
    intro: [
      'Upstairs, the house is empty. Through the window: shapes in the street, swaying under dead streetlights.',
      'Your car is locked in the Hendersons\' garage across the road. They kept the spare key — and an alarm panel with the door code.',
    ],
    concept: { title: 'Floodlights', points: [
      'A floodlight is the same question as your flashlight — asked of <b>everyone under it at once</b>, for as long as it is on.',
      'An <b class="c-amber">amber floodlight</b> makes a whole crowd decide: roughly half fall dead on the spot, the rest come at you alive.',
      'Bodies that are already dead stay dead under amber. Flip a switch with <b>[E]</b>.',
    ] },
    outro: 'VARGA: You\'re on the road. St. Lucy\'s Hospital is on your way out — the evac lift is there, and it needs a two-part code. Drive.',
    map: [
      '######################################',
      '#.....#.....................#........#',
      '#..P..#.....................#..C..1..#',
      '#.....#........U...U........#........#',
      '#..........a.......U...........C..C..#',
      '#.....#.......U.....U.......#........#',
      '#..M..#.........L...........##########',
      '#######.....U.......U.......#........#',
      '#S..........U....U.........D....E....#',
      '#...................S.......#........#',
      '######################################',
    ],
    terminals: [{ label: 'HENDERSON ALARM', symbols: 3 }],
    doors: [{ label: 'Garage door', needs: [0] }],
    lamps: [{ basis: 'Z', label: 'Streetlight (amber)' }],
    steps: [
      { goal: 'Leave the house.', radio: 'VARGA: Your whole street is full of them. Don\'t waste bullets on every one.', done: c => c.near('a', 3), target: 'm:a' },
      {
        goal: 'Flip the streetlight switch [E] — it is an AMBER floodlight.',
        radio: 'VARGA: Those streetlights were refitted with my amber lamps. Switch one on and every body under it has to answer at once.',
        done: c => c.lamp(0),
        target: 'l0',
      },
      { goal: 'Deal with the ones that answered ALIVE.', done: c => c.zone('a', 30).alive === 0 },
      {
        goal: 'The garage code is on the Hendersons\' alarm panel. Read it with CYAN. They didn\'t make it — mind the bodies.',
        radio: 'VARGA: Get close before you switch to cyan. Every body your beam touches gets a second chance.',
        done: c => c.read(0),
        target: 't0',
      },
      { goal: 'Open the garage [E].', done: c => c.door(0), target: 'd0' },
      { goal: 'Get in the car.', exit: true, done: () => false },
    ],
    spawn: { rate0: 0.05, rate1: 0.16, ramp: 180, minus: 0, cap: 6 },
    reencodeSeconds: 12,
    exitKind: 'car',
    seed: 101,
  },
  {
    id: 2,
    chapter: 'CHAPTER II',
    name: "St. Lucy's",
    place: "St. Lucy's Hospital · 22:31",
    intro: [
      'You abandon the car at the ambulance bay. The hospital lobby is dark. Gurneys everywhere.',
      'The evac lift needs a four-symbol code. Half of it is on the Ward A nurse station. The other half is in the morgue.',
    ],
    concept: { title: 'Codes are fragile', points: [
      'Door codes are stored in <b class="c-cyan">cyan</b>. Reading them with cyan is safe and exact.',
      'Shine <b class="c-amber">amber</b> on a code screen and every symbol is forced to answer the wrong question — the code is <b>destroyed</b>. The terminal re-encodes after a few seconds, and the alarm draws them in.',
      'The lift needs <b>two halves</b>. The morgue half sits behind twelve corpses: walk in under amber, switch to cyan only at the screen.',
    ] },
    outro: 'VARGA: The lift goes down to the ambulance tunnel. There\'s a supply van running to Harlow Airport — the last helicopter leaves from the roof.',
    map: [
      '#############################################',
      '#.......###########.......#C...C...C...C...C.#',
      '#...1...#.........#...U...#.................2#',
      '#.......#....U....#.......#C...C...C...C...C.#',
      '###.#####....V....###.#######.###############',
      '#...........................................#',
      '#.P.....a...U...U......L........U......U....#',
      '#..M.......................................S#',
      '#############.##############D#################',
      '############.S.############...E...############',
      '############################.....#############',
      '#############################################',
    ],
    terminals: [{ label: 'WARD A · LIFT 1/2', symbols: 2 }, { label: 'MORGUE · LIFT 2/2', symbols: 2 }],
    doors: [{ label: 'Evac lift', needs: [0, 1] }],
    lamps: [{ basis: 'Z', label: 'Corridor lights (amber)' }],
    steps: [
      { goal: 'Read the first half of the lift code at the Ward A nurse station (CYAN).', radio: 'VARGA: Ward A is just off the lobby. Watch the patients.', done: c => c.read(0), target: 't0' },
      {
        goal: 'Read the second half in the morgue (CYAN). Every drawer is full.',
        radio: 'VARGA: The morgue. Twelve bodies between you and that screen. Walk in under amber — it keeps them down — and only switch to cyan right in front of the terminal.',
        done: c => c.read(1),
        target: 't1',
      },
      { goal: 'Enter the full code at the evac lift [E].', done: c => c.door(0), target: 'd0' },
      { goal: 'Take the lift to the ambulance tunnel.', exit: true, done: () => false },
    ],
    spawn: { rate0: 0.06, rate1: 0.2, ramp: 180, minus: 0.3, cap: 8 },
    reencodeSeconds: 12,
    exitKind: 'van',
    seed: 202,
  },
  {
    id: 3,
    chapter: 'CHAPTER III',
    name: 'Harlow International',
    place: 'Harlow Airport · 23:12',
    intro: [
      'The van dies at the departures curb. The terminal is dark and full of travellers who never left.',
      'Security gate first. Then the baggage hall. Then across the tarmac to the hangar stairs and up to the roof.',
    ],
    concept: { title: 'Cyan floodlights', points: [
      'Floodlights can be cyan too. A <b class="c-cyan">cyan floodlight</b> asks every corpse under it the other question — and raises them all.',
      'An <b class="c-amber">amber floodlight</b> next to it asks them again: about half go back down.',
      'Switches work both ways — <b>[E]</b> to turn a light off.',
    ] },
    outro: 'VARGA: You made the hangar. Get up to the roof — the medevac is circling, but it won\'t land without a signal.',
    map: [
      '##################################################',
      '#.........#.......#..C....C....C....C....C...2...#',
      '#..U...U..#...1...#..............................#',
      '#....L....#.......#....C....C....C....C....C.....#',
      '#..U...U..####.####..............................#',
      '#.P....a...........D.............................#',
      '#..M.....U.........#..............C....C.........#',
      '#S.................##########################D####',
      '######################.....C.......C........K...#',
      '######################S.......K.......C.........#',
      '######################...C..........L.....C..E..#',
      '######################.......C.........K........#',
      '##################################################',
    ],
    terminals: [{ label: 'SECURITY OFFICE', symbols: 3 }, { label: 'GATE 7 DESK', symbols: 3 }],
    doors: [{ label: 'Security gate', needs: [0] }, { label: 'Tarmac doors', needs: [1] }],
    lamps: [
      { basis: 'Z', label: 'Check-in lights (amber)' },
      { basis: 'X', label: 'Runway lights (CYAN)', poweredByDoor: 1 },
      { basis: 'X', label: 'Runway lights (CYAN)', poweredByDoor: 1 },
      { basis: 'Z', label: 'Apron floodlight (amber)' },
      { basis: 'X', label: 'Runway lights (CYAN)', poweredByDoor: 1 },
    ],
    steps: [
      { goal: 'Read the security gate code in the security office (CYAN).', radio: 'VARGA: Check-in hall is crawling. There\'s an amber light bank in the middle — use it.', done: c => c.read(0), target: 't0' },
      { goal: 'Open the security gate [E].', done: c => c.door(0), target: 'd0' },
      { goal: 'Read the tarmac door code at the Gate 7 desk (CYAN). The baggage hall is full of bodies.', done: c => c.read(1), target: 't1' },
      {
        goal: 'Open the tarmac doors [E].',
        radio: 'VARGA: Wait — opening those doors restores power to the runway. The runway lights are CYAN. Be ready.',
        done: c => c.door(1),
        target: 'd1',
      },
      {
        goal: 'The runway lights are raising the dead! Switch them off [E] or turn on the amber apron floodlight — then reach the hangar.',
        radio: 'VARGA: Every body on that tarmac is getting up. Amber floodlight, now!',
        exit: true,
        done: () => false,
      },
    ],
    spawn: { rate0: 0.07, rate1: 0.22, ramp: 180, minus: 0.3, cap: 9 },
    reencodeSeconds: 12,
    exitKind: 'hangar',
    seed: 303,
  },
  {
    id: 4,
    chapter: 'CHAPTER IV',
    name: 'Medevac',
    place: 'Hangar roof · 23:47',
    intro: [
      'The roof. Wind, rain, and the sound of rotors somewhere above the clouds.',
      'The pilot will only land on a clean signal: the radio beacon has to broadcast for 35 seconds under your cyan light. Anything that asks it in amber corrupts the signal.',
      'They\'re coming up the stairwells.',
    ],
    concept: { title: 'Holding a signal', points: [
      'The beacon only transmits while your <b class="c-cyan">cyan</b> beam is on it <b>and</b> its signal is intact.',
      'Any <b class="c-amber">amber</b> on the beacon corrupts it and costs you progress.',
      'The corpses around it will rise under your beam. Shoot what turns red; use the amber roof lights on the crowd — not on the beacon.',
    ] },
    outro: '',
    map: [
      '##############################',
      '#S..........#####..........S.#',
      '#............................#',
      '#....L.......C...C.......L...#',
      '#.........C.........C........#',
      '#..............1.............#',
      '#.........C.........C........#',
      '#............C..C............#',
      '#............P...............#',
      '#....L..................L....#',
      '#..........................E.#',
      '#S..........................S#',
      '##############################',
    ],
    terminals: [{ label: 'RADIO BEACON', symbols: 4, uplink: 35 }],
    doors: [],
    lamps: [
      { basis: 'Z', label: 'Roof floodlight (amber)' },
      { basis: 'Z', label: 'Roof floodlight (amber)' },
      { basis: 'Z', label: 'Roof floodlight (amber)' },
      { basis: 'Z', label: 'Roof floodlight (amber)' },
    ],
    steps: [
      {
        goal: c => `Call the medevac: hold CYAN on the radio beacon (${Math.floor(c.uplink)} / 35 s)`,
        radio: 'VARGA: This is it. Keep the cyan beam on the beacon. The bodies around it will get up — the roof floodlights are amber, use them, but keep them off the beacon.',
        done: c => c.uplink >= 35,
        target: 't0',
      },
      { goal: 'The helicopter is landing — GET ON BOARD!', radio: 'PILOT: Medevac Seven, on the pad! Move, move!', exit: true, done: () => false },
    ],
    spawn: { rate0: 0.12, rate1: 0.35, ramp: 90, minus: 0.5, cap: 11 },
    reencodeSeconds: 8,
    exitKind: 'heli',
    seed: 404,
  },
];

export const ENDING = [
  'The helicopter lifts off. Below you, the city flickers — amber, cyan, amber.',
  'Every one of those bodies was a coin toss that nobody had tossed yet. You learned to choose which question to ask.',
  'Dr. Varga\'s voice, one last time: "Measurement is not looking. Measurement is deciding. Remember that."',
];
