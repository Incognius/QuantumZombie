# Dead Reckoning

A first-person horror shooter where your flashlight is a quantum measurement.

Made for **Quriosity 2026** (ISAQC, Infinium 2026), option **01 · Basis Switching**.

**Team papaLima:** Navanshu Gupta, Ponnambalam V, Samyak Soni, Satvik Shrivastava

**Play in the browser:** https://rawcdn.githack.com/Incognius/QuantumZombie/be3d01ed0233354718491a454b3b646485c0d5bf/play/index.html
(the host shows a one-time notice; click *Open the page*. Desktop browser, mouse and keyboard.)

---

## Contents

1. [The game in one paragraph](#the-game-in-one-paragraph)
2. [What we learned in the first three hours](#what-we-learned-in-the-first-three-hours)
3. [How that idea became the heart of the game](#how-that-idea-became-the-heart-of-the-game)
4. [Methodology](#methodology)
5. [Architecture](#architecture)
6. [How to run it](#how-to-run-it)
7. [Controls](#controls)
8. [Credits](#credits)

---

## The game in one paragraph

An outbreak has filled a town with bodies that are neither dead nor alive until something checks. You carry a flashlight with two filters. The **amber** filter asks "dead or alive?" and forces an answer. The **cyan** filter asks a different question that dead/alive can't answer. Shine amber on a fresh crowd and half of them drop, while the other half get up and run at you. Shine cyan on a corpse and it stands back up, undecided again. Doors are locked with codes that are stored in the cyan basis, so if you sweep amber over a code screen, the code is gone. The whole game is about choosing which question to ask, and when.

---

## What we learned in the first three hours

None of us had worked with quantum states before this event, so we spent the start of the sprint on the basics: reading, working examples on paper, and arguing until we all agreed. These are the points that stuck.

**1. A qubit has more than one "question" you can ask it.**
A measurement is always made *in a basis*. The Z basis asks "0 or 1?". The X basis asks "+ or −?", where |+⟩ and |−⟩ are equal mixes of |0⟩ and |1⟩ that differ only in sign. The basis you choose is a decision you make, not something the qubit decides for you.

**2. Certain in one basis means a coin flip in the other.**
|+⟩ gives "+" in X every time, but in Z it gives 0 or 1 with 50/50 odds. |0⟩ is certain in Z and a coin flip in X. We had expected that knowing a state well meant knowing everything about it. It doesn't, and that was the first real surprise.

**3. Measuring changes the state.**
After a Z measurement the qubit *is* |0⟩ or |1⟩. Whatever X information it held is gone. If you then measure in X you get a fresh 50/50, not the original answer. This is what the brief calls measurement scrambling, and it took us a while to stop thinking of measurement as "just looking".

**4. Asking the same question twice gives the same answer.**
Measure Z, then Z again, and the second result matches the first with probability 1. Only switching bases brings the randomness back. This mattered a lot for the game later: it meant a light could keep measuring every frame without doing anything strange.

**5. The Born rule is simple enough to code by hand.**
Because we only prepare and measure in Z and X, every state we need sits on one circle:

|ψ⟩ = cos(θ/2)|0⟩ + sin(θ/2)|1⟩

The chance of the "+" outcome along a measurement axis φ is cos²((θ − φ)/2), with φ = 0 for Z and φ = π/2 for X. That is one line of code, and it is exact for everything the game does. We didn't need a simulator library.

**6. It's like the BB84 eavesdropper.**
Reading about quantum key distribution gave us the clearest picture: someone who measures in the wrong basis destroys the message and can't tell they did. We kept that idea for the code terminals.

---

## How that idea became the heart of the game

By the end of those three hours we had one sentence: **"what you check is what you change."** We wanted a game where you couldn't win by ignoring that sentence.

A flashlight was the natural fit. In horror games a light is how you look at things, and looking is exactly the action that is no longer innocent here. So:

| Physics | In the game |
|---|---|
| Z measurement | amber light: forces dead or alive |
| X measurement | cyan light: forces one of two "undecided" answers |
| \|0⟩ | a corpse on the floor |
| \|1⟩ | a running zombie with red eyes |
| \|+⟩, \|−⟩ | flickering, undecided shamblers (teal or violet) |
| measurement scrambling | an amber sweep wipes a code stored in the X basis |
| repeated measurement is stable | holding the light on a crowd does nothing after the first tick |

Every lesson from the first three hours turned into something the player runs into:

- **Lesson 2 became the core gamble.** Amber on a fresh horde is a 50/50 for each body. You thin the crowd, but you also wake up half of it.
- **Lesson 3 became the main trap.** Cyan on a corpse doesn't do nothing. It puts the corpse back into superposition, and the next amber check or bite can make it alive again. Chapter III builds a level around this: cyan runway lights raise every body on the tarmac.
- **Lesson 4 kept the light fair.** The beam measures every tick, but repeating the same basis changes nothing, so the physics stays honest no matter how long you hold it.
- **Lesson 6 became the doors.** Codes live in the X basis. Read them with cyan and they stay intact. Sweep amber across the screen and each symbol is now only right half the time.
- **Even the gun follows the rules.** A bullet needs to know whether it hit something alive, so every hit is a Z measurement. Shooting an undecided body can bring it to life.

We also put a hard rule in the code: **only one file is allowed to change a qubit** (`src/game/rules.ts`). The engine decides *when* something interacts; that file decides *what* the physics does. This kept us from slipping in "game logic" that quietly broke the quantum rules.

---

## Methodology

**Learn first, design second.** We didn't touch the engine until we could predict, on paper, what every light would do to every kind of body.

**Make the physics the only source of truth.** States are real numbers (θ), measurements use the Born rule, and randomness comes from a seeded generator so a bug can be replayed exactly.

**Test the physics separately from the game.** The quantum core has no graphics code in it, so we test it on its own:

- χ² test of the Born rule at five angles in both bases (20,000 samples each)
- repeated measurements give the same answer
- amber on |+⟩ gives about 50% dead
- cyan leaves |±⟩ unchanged
- cyan, then contact, on a corpse gives about 50% alive
- an amber-scrambled terminal re-reads correctly about 50% per symbol
- every map is fully reachable and matches its mission data

**Teach before testing the player.** A short orientation has you measure a specimen and a code panel yourself before the first chapter. Each chapter then opens with one card explaining the single new idea it adds.

**Never show hidden state.** The aim-down-sights inspector only shows what is actually known from measurements, for example "dead: certain · cyan: 50/50". It can't tell you something the physics hasn't revealed.

**What we deliberately left out:** decoherence (a body left in the dark keeps its state), measuring in two bases at once, and anything outside the X–Z circle. Killing a running zombie is a classical, irreversible reset to |0⟩, not a quantum operation.

---

## Architecture

TypeScript, three.js, Vite and Vitest. No backend; the build is a static site.

```
src/
  quantum/
    qubit.ts         state on the X–Z circle, Born rule, collapse, eigenstate labels
    random.ts        seeded RNG (mulberry32)
  game/
    rules.ts         the only code allowed to write qubit state
    grid.ts          ASCII map to tile grid, collision, line of sight, BFS flow field
  levels/
    index.ts         chapters: maps, objectives, radio lines, concept cards
  engine/
    game.ts          fixed 60 Hz simulation + three.js rendering, lights, horde, minimap
    zombieModels.ts  glTF loading, skinned clones, animation driven by qubit state
    models.ts        procedural props: terminals, doors, floodlights, weapons, helicopter
    audio.ts         synthesized sound effects (WebAudio)
    music.ts         generative score whose tension follows nearby hostile bodies
  ui/
    hud.ts           HUD, radio subtitles, field guide
    lesson.ts        the orientation, built on the real rule functions
  main.ts            menus, story screens, chapter flow, settings, saved progress
tests/
  physics.test.ts
play/                prebuilt copy of the game used by the hosted link
```

**How a frame works**

1. The engine finds every body and terminal inside the flashlight cone (21°, 18 m) that is in line of sight, plus anything inside an active floodlight.
2. For each one it calls a function in `rules.ts` with the current basis.
3. `rules.ts` applies the Born rule, collapses θ and returns what changed.
4. The renderer reads the new state and picks the model, colour and animation. A rising corpse plays its death animation in reverse.

**Design rules**

- `quantum/` and `game/` import nothing from three.js or the browser.
- Missions are data: a map plus a list of objectives, each with a completion check, a radio line and a minimap target. A new chapter needs no engine changes.
- The horde shares one flow field from the player, rebuilt every 0.25 s. Running zombies move at 3.0 m/s and undecided ones at 1.1 m/s.
- `?debug&m=<0-4>` exposes `window.__dr` for scripted playthroughs without pointer lock.

---

## How to run it

**Just play:** open the link at the top in Chrome, Edge or Firefox on a desktop.

**Run locally** (needs Node 22):

```bash
git clone https://github.com/Incognius/QuantumZombie.git
cd QuantumZombie
npm install
npm run dev
```

Then open the address it prints (usually http://127.0.0.1:5173).

**Other commands**

```bash
npm test          # physics and map tests
npm run build     # typecheck + static build into dist/
npx vite build --base=./ --outDir play --emptyOutDir   # refresh the hosted copy in play/
```

**Offline:** serve the `play/` folder with any static server, for example `npx serve play`. Opening `index.html` straight from disk won't work, because browsers block loading the 3D models over `file://`.

---

## Controls

| Key | Action |
|---|---|
| Mouse | look (click the game to lock the mouse, `Esc` to release) |
| `W A S D` | move |
| `Left Shift` | sprint |
| `Space` | jump |
| `Z` | amber flashlight on/off (Z measurement) |
| `X` | cyan flashlight on/off (X measurement) |
| `F` | light off; the battery only recharges while it's off |
| Left click | fire (each hit is a Z measurement) |
| Right click | aim down sights and inspect what is known about a body |
| `R` | reload |
| `1` / `2` / `Q` | carbine / scoped marksman rifle / swap |
| `E` | doors, floodlight switches |
| `Tab` | field guide |

**Campaign:** Prologue (basement), I · Maple Street, II · St. Lucy's Hospital, III · Harlow Airport, IV · the hangar roof.

---

## Credits

- Zombie models by Quaternius via Poly Pizza: [Zombie](https://poly.pizza/m/VlXjG0N8Eg) (CC0), [Zombie](https://poly.pizza/m/JoBvxIUpZP) (CC0), [Zombie](https://poly.pizza/m/22K0aSZkHV) (CC-BY 3.0).
- Everything else (props, sound and music) is procedural or synthesized in code.
