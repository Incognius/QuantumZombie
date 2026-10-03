# DEAD RECKONING

**Quriosity 2026 · Track 1: Basis switching & measurement scrambling**

A story-driven horror FPS in the browser. Your flashlight is a quantum measurement. On the night of the Harlow Incident, the dead in your city are neither dead nor alive until something looks at them. The **amber** filter asks every body *"dead or alive?"* (a Z-basis measurement). The **cyan** filter asks a different question, and it's the only light that can read the cyan-coded door locks (an X-basis measurement). But a corpse touched by cyan forgets it was ever dead.

▶ **Play:** https://incognius.github.io/dead-reckoning/ (desktop browser, mouse + keyboard)

## The story: five chapters out of the city

| | Chapter | Puzzle |
|---|---|---|
| Prologue | **The Basement** (home) | Guided tutorial. Dr. Varga talks you through every rule over the radio, one step at a time. |
| I | **Maple Street** | An amber streetlight makes a whole crowd decide at once. The garage code is in a house full of corpses. |
| II | **St. Lucy's Hospital** | The evac lift needs a two-part code. Half of it is in Ward A, half in a morgue packed with bodies. |
| III | **Harlow International** | Security gate, baggage hall, tarmac. Opening the tarmac doors powers up the **cyan runway lights**, which raise every corpse outside. Switch them off or counter them with the amber floodlight. |
| IV | **Medevac** | Hold cyan on the radio beacon for 35 s while the bodies around it get up, then board the helicopter. |

## How to play

| Key | Action |
|---|---|
| `W A S D` / `Shift` / `Space` | move / sprint / jump |
| `LMB` / `RMB` | fire / aim down sights (the Marksman scopes) |
| `R` · `1` `2` / `Q` | reload · switch Carbine ⇄ Marksman (ammo is unlimited) |
| `Z` / `X` / `F` | **amber** light / **cyan** light / light off |
| `E` | use: enter a code, flip a floodlight |
| `Tab` | field guide · `Esc` pause |

**The three kinds of bodies:**
- **DEAD:** lying on the floor.
- **UNDECIDED:** flickering, see-through, and slow.
- **ALIVE:** solid, with red eyes. Shoot these.

**Rules of thumb:**
- Walk through the dead under amber.
- Use cyan only on code screens, up close, aimed away from bodies.
- Never point amber at a code screen.

## The physics (exact)

Every zombie and every terminal symbol is one qubit. The game only ever prepares and measures in Z and X, so the state always lies on the X–Z great circle: |ψ⟩ = cos(θ/2)|0⟩ + sin(θ/2)|1⟩ with real amplitudes. That is exact here, not an approximation ([src/quantum/qubit.ts](src/quantum/qubit.ts)).

| In the game | State |
|---|---|
| corpse on the floor | \|0⟩ (Z = DEAD) |
| solid, red eyes, sprinting | \|1⟩ (Z = ALIVE) |
| translucent teal / violet shambler | \|+⟩ / \|−⟩ (X answer ◯ / ◇) |

Measurement follows the Born rule: P = cos²((θ − φ)/2), where φ = 0 for Z and π/2 for X. The state then collapses onto the outcome. Every interaction that touches a qubit goes through one rule file, [src/game/rules.ts](src/game/rules.ts):

| Event | What it is physically |
|---|---|
| amber cone or amber floodlight (with line of sight) on a body or screen | Z measurement, every tick (repeating it changes nothing) |
| cyan cone or cyan floodlight on a body or screen | X measurement, every tick |
| bullet hits a body | Z measurement: damage only if the answer is ALIVE |
| shambler touches you | Z measurement: ALIVE bites, DEAD drops |
| ALIVE body's HP reaches 0 | classical kill → reset to \|0⟩ |
| terminal re-encodes | fresh preparation of the stored code in X |

What the player discovers by playing:
- Amber on fresh (|+⟩) zombies: **50 % drop, 50 % turn ALIVE**.
- Amber on corpses: nothing happens. Repeating a measurement gives the same answer.
- Cyan on fresh zombies: nothing happens. They are already X eigenstates.
- **Cyan on a corpse:** |0⟩ → |±⟩, so it stands up undecided. The next Z question (your light, your bullet, its teeth) makes it ALIVE half the time.
- **Amber on a cyan-coded screen:** every symbol collapses to 0/1 and the code is destroyed. A cyan re-read gives each symbol correct only 50 % of the time, so entering it at the door gets **REJECTED**.
- The aim-down-sights inspector shows only what you have learned, e.g. *"AMBER: DEAD (certain) · CYAN: unknown (50/50)"*. Every state change is a known measurement or preparation, so it never leaks hidden information.

**Honest simplifications:** no decoherence (an unobserved body keeps its state in the dark); a kill is a classical reset, not a unitary; only one light basis can be active at a time.

**Verified:** `npm test` runs χ² tests of the Born rule at several angles plus every rule above over 20 000 samples, and checks that every level is reachable. In-browser runs against the live game logic matched too: 400 fresh zombies under amber split 214 dead / 186 alive; 400 corpses under cyan split 209 ◯ / 191 ◇; on contact 190 came back alive.

## What we learned in the first 3 hours → how it became the game

> *Draft. Edit into your own words before submitting.*

- **"Measuring doesn't just read, it *writes*."** We expected a wrong-basis measurement to give a useless answer. It actually overwrites the state. That became the core rule: cyan on a corpse resurrects it.
- **"Asking the same question twice is free."** Repeated Z on |0⟩ is always |0⟩. So amber on corpses is safe, and checking your work isn't punished; only switching questions is.
- **"|0⟩ is 50/50 in X, and |+⟩ is 50/50 in Z."** Neither basis is "the real one". That's why the HUD inspector shows one answer as certain and the other as 50/50, never both.
- **"A display is a measurement."** We first drew the code on the terminal screen all the time. Then we realised that showing it means something already measured it. Now the screen is dark until your light reads it, and the light's basis decides what you see.
- **"Bullets and bites are questions too."** Anything that depends on alive vs dead is a Z measurement, so shooting a shambler can make it drop dead without any damage.

## Run locally

```bash
npm install
npm run dev     # http://127.0.0.1:5173
npm test        # physics + level tests
npm run build
```

Add `?debug&m=2` to the URL (chapter index 0–4) for a scripting hook (`window.__dr`) that steps the simulation without pointer lock.

Built with TypeScript, three.js and Vite. The horror score and all sound effects are generated live with WebAudio.

## Credits

- Zombie models by **Quaternius** (quaternius.com), via Poly Pizza: [Zombie](https://poly.pizza/m/VlXjG0N8Eg) (CC0), [Zombie](https://poly.pizza/m/JoBvxIUpZP) (CC0), [Zombie](https://poly.pizza/m/22K0aSZkHV) (CC-BY 3.0).
- Everything else (level art, weapons, terminals, music, sound) is procedural.
