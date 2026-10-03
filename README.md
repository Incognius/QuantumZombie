# Dead Reckoning

Horror FPS for **Quriosity 2026 · Track 1: basis switching & measurement scrambling**.
Your flashlight is a projective measurement: amber measures in Z, cyan measures in X.

**Play:** https://incognius.github.io/QuantumZombie/ (desktop, mouse + keyboard)

```bash
npm install
npm run dev      # local server
npm test         # physics + map tests
npm run build    # static bundle in dist/
```

---

## 1. Physics engine

### State
Each zombie and each code symbol is one qubit restricted to the X–Z great circle:

|ψ⟩ = cos(θ/2)|0⟩ + sin(θ/2)|1⟩, θ ∈ [0, 2π)

The game only prepares and measures in Z and X, so real amplitudes are exact; θ is stored instead of a 2-vector. `src/quantum/qubit.ts` holds the whole model in about 70 lines.

| θ | ket | in game |
|---|---|---|
| 0 | \|0⟩ | DEAD (on the floor) |
| π | \|1⟩ | ALIVE (solid, red eyes, fast) |
| π/2 | \|+⟩ | UNDECIDED, cyan answer ◯ (teal, flickering) |
| 3π/2 | \|−⟩ | UNDECIDED, cyan answer ◇ (violet, flickering) |

### Measurement
- **Born rule:** for a measurement axis φ (Z: φ = 0, X: φ = π/2), P(+) = cos²((θ − φ)/2).
- **Collapse:** the state is projected to θ = φ or θ = φ + π.
- **Randomness:** a seeded mulberry32 RNG (`src/quantum/random.ts`).
- **Repeats are idempotent:** measuring the same basis again returns the same outcome with probability 1. That's why a beam can measure every tick without changing the physics.

### The only writers of state
Every qubit write goes through `src/game/rules.ts`. The engine decides *when* an interaction happens; the rule file decides *what* it does.

| Event | Operation |
|---|---|
| Amber flashlight cone / amber floodlight (with line of sight) | Z measurement |
| Cyan flashlight cone / cyan floodlight | X measurement |
| Bullet hits a body | Z measurement; damage only if the outcome is ALIVE |
| Undecided body touches the player | Z measurement; ALIVE bites |
| ALIVE body reaches 0 HP | classical kill, reset to \|0⟩ |
| Spawner | prepares \|+⟩ or \|−⟩ |
| Code terminal | stores bits as \|+⟩/\|−⟩; re-encodes (fresh preparation) after being scrambled |

### Consequences the player runs into
- **Amber on a fresh horde:** 50 % drop dead, 50 % turn alive.
- **Amber on corpses:** nothing changes.
- **Cyan on fresh bodies:** nothing changes.
- **Cyan on a corpse:** |0⟩ → |±⟩, so it stands up. The next Z interaction makes it ALIVE half the time.
- **Amber on a code screen:** each symbol collapses to |0⟩/|1⟩ and the stored X information is gone. A cyan re-read is correct per symbol with probability ½.

### Not modelled
- **Decoherence:** a body left in the dark keeps its state.
- **The kill:** it is an irreversible classical reset, not a unitary.
- **Multiple bases at once:** only one flashlight basis can be active.

### Verification (`tests/physics.test.ts`)
- χ² test of the Born rule at five angles in both bases, 20 000 samples each.
- Idempotence of repeated measurements.
- Amber on |+⟩ gives ≈ 50 % dead.
- Cyan leaves |±⟩ unchanged.
- Cyan then contact on |0⟩ gives ≈ 50 % alive.
- Terminal scramble: 50 % per-symbol re-read accuracy.
- Every map is fully reachable and matches its mission definition.

---

## 2. Gameplay mechanics

### Loop
1. **Orientation.** A mandatory interactive lesson. You measure a specimen and a code panel yourself, then sign off the field guide.
2. **Chapters.** Each one opens with a story intro and a one-card briefing of the concept that chapter adds.
3. **Missions.** Each mission is a list of objectives. Each objective has a completion test, a radio line and a minimap target.

### Tools
| Key | Tool | Physics |
|---|---|---|
| `Z` | amber flashlight | Z measurement in a 21° cone, 18 m range, line of sight |
| `X` | cyan flashlight | X measurement, same cone |
| `F` | light off | battery recharges only while off |
| `E` | doors, floodlight switches | doors check the codes you have read; floodlights measure in a 7.5 m radius every tick |
| `LMB` / `RMB` | Carbine, scoped Marksman; aim down sights | each hit is a Z measurement; unlimited ammo, magazines and reloads |
| `Tab` | field guide | — |

The aim-down-sights inspector shows only what has been measured, e.g. "dead: certain · cyan: 50/50". Every state change comes from a known preparation or measurement, so the display never leaks hidden state.

### Campaign
| Chapter | Setting | New idea |
|---|---|---|
| Prologue | basement | guided steps: decide, shoot, read a code, raise a corpse, re-decide it |
| I | Maple Street | amber floodlight collapses a whole crowd |
| II | St. Lucy's Hospital | two-part code; one half sits in a morgue full of corpses |
| III | Harlow Airport | opening the tarmac doors powers **cyan runway lights** that raise every corpse; counter with amber |
| IV | hangar roof | hold cyan on the beacon for 35 s while its signal is intact, then board the helicopter |

### Horde
- **Pathing:** one BFS flow field from the player, rebuilt every 0.25 s and shared by all agents. Close-range chasing uses direct pursuit with line of sight.
- **Speed:** ALIVE bodies run at 3.0 m/s; UNDECIDED bodies shamble at 1.1 m/s.
- **Spawning:** spawners ramp their rate over time, capped per chapter. A scrambled terminal triggers an alarm burst.

---

## 3. Architecture

```
src/
  quantum/   qubit.ts      state, Born rule, collapse, eigenstate classification
             random.ts     seeded RNG
  game/      rules.ts      the only code that writes qubit state
             grid.ts       ASCII map → tile grid, circle collision, DDA line of sight, BFS flow field
  levels/    index.ts      campaign data: maps, objectives (completion tests), radio lines, concept cards
  engine/    game.ts       fixed-step 60 Hz simulation + three.js render loop, objectives, lights, horde, minimap
             zombieModels.ts  glTF loading, skinned clones, state-driven animation (death clip reversed to rise)
             models.ts     procedural props: terminals, doors, floodlights, weapons, helicopter, decals
             audio.ts      synthesized SFX (WebAudio)
             music.ts      generative score; tension follows nearby hostile bodies
  ui/        hud.ts        DOM HUD, radio subtitles, field guide
             lesson.ts     mandatory orientation using the real rule functions
  main.ts    menus, story screens, chapter flow, settings, progress (localStorage)
tests/       physics.test.ts
```

### Design rules
- **Pure core.** `quantum/` and `game/` import nothing from three.js or the DOM, so the physics is unit-tested in isolation.
- **Separate render loop.** The simulation runs at a fixed 60 Hz step; rendering interpolates nothing and reads state only.
- **Data-driven missions.** A chapter is a map plus a list of `{ goal, done(ctx), target, radio }`. Adding a chapter requires no engine changes.
- **Debug harness.** `?debug&m=<0-4>` exposes `window.__dr` (step, teleport, lookAt, setFilter, state) for scripted playthroughs without pointer lock.

### Stack
TypeScript, three.js 0.186, Vite, Vitest. No backend. Deployed as a static build on the `gh-pages` branch.

### Credits
- **Zombie models:** Quaternius via Poly Pizza. [Zombie](https://poly.pizza/m/VlXjG0N8Eg) (CC0), [Zombie](https://poly.pizza/m/JoBvxIUpZP) (CC0), [Zombie](https://poly.pizza/m/22K0aSZkHV) (CC-BY 3.0).
- **Everything else:** procedural or synthesized in code.
