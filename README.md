# DEAD RECKONING

**Quriosity 2026 · Track 1: Basis switching & measurement scrambling**

A browser FPS where your flashlight is a quantum measurement. Hordes of zombies shamble out of the dark, and every body is a qubit. The **amber** light asks *"dead or alive?"* (the Z basis). The **cyan** light asks a different question, *"◯ or ◇?"* (the X basis). Ask the wrong question and the answer you already had is gone: corpses get back up, and codes turn to noise.

▶ **Play:** https://incognius.github.io/dead-reckoning/ (desktop browser, mouse + keyboard)

## How to play

| Key | Action |
|---|---|
| `W A S D` / `Shift` / `Space` | move / sprint / jump |
| `LMB` / `RMB` | fire / aim down sights (the Marksman scopes) |
| `R` · `1` `2` / `Q` | reload · switch Carbine ⇄ Marksman |
| `Z` | **amber** light (measures in Z) |
| `X` | **cyan** light (measures in X) |
| `F` | light off · `E` use |

**Missions**
1. **Lights Out.** Learn the two lights. Amber drops about half of an undecided pack and wakes up the other half.
2. **Don't Look Back.** The extraction door's code is stored in cyan on a terminal at the end of a hall full of corpses. Cyan reads the code but raises the dead. Amber keeps the dead down but scrambles the code.
3. **Last Signal.** Hold cyan on an uplink for 45 s while the horde comes from every side and the corpses pile up around the terminal.

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
| amber cone (with line of sight) on a body or screen | Z measurement, every tick (repeating it changes nothing) |
| cyan cone on a body or screen | X measurement, every tick |
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

Add `?debug&level=2` to the URL for a scripting hook (`window.__dr`) that steps the simulation without pointer lock.

Built with TypeScript, three.js and Vite. All art is procedural and all sound is synthesized with WebAudio.
