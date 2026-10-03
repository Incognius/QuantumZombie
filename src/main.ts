import './style.css';
import { Game } from './engine/game';
import type { EndResult, Stats } from './engine/game';
import { Sfx } from './engine/audio';
import { Music } from './engine/music';
import { loadZombieModels } from './engine/zombieModels';
import type { ZombieModel } from './engine/zombieModels';
import { ENDING, MISSIONS } from './levels';
import type { Mission } from './levels';
import { FIELD_GUIDE } from './ui/hud';

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const app = document.getElementById('app')!;
const stage = document.createElement('div');
stage.className = 'stage';
const overlay = document.createElement('div');
overlay.className = 'overlay';
app.append(stage, overlay);

const sfx = new Sfx();
const music = new Music();
let models: ZombieModel[] = [];
const modelsReady = loadZombieModels(import.meta.env.BASE_URL).then(m => { models = m; });
let game: Game | null = null;

const store = {
  get(k: string, d: number): number { try { const v = localStorage.getItem(`dr.${k}`); return v === null ? d : Number(v); } catch { return d; } },
  set(k: string, v: number): void { try { localStorage.setItem(`dr.${k}`, String(v)); } catch { /* private mode */ } },
};
let unlocked = store.get('chapter', 0);
let sensitivity = store.get('sens', 1);
music.volume = store.get('music', 0.7);

function audioOn(): void {
  sfx.unlock();
  music.start(sfx.context);
}

function show(html: string, cls = ''): void {
  overlay.className = `overlay ${cls}`;
  overlay.innerHTML = html;
  overlay.style.display = 'flex';
}
function hide(): void { overlay.style.display = 'none'; overlay.innerHTML = ''; }
function on(sel: string, f: (el: HTMLElement) => void): void {
  overlay.querySelectorAll<HTMLElement>(sel).forEach(el => el.addEventListener('click', e => { e.stopPropagation(); audioOn(); sfx.click(); f(el); }));
}

// ------------------------------------------------------------------ title
function title(): void {
  destroyGame();
  music.setMode('menu');
  const cont = MISSIONS[Math.min(unlocked, MISSIONS.length - 1)]!;
  show(`
    <div class="title-screen">
      <div class="title-block">
        <div class="pre">THE HARLOW INCIDENT</div>
        <h1 class="logo"><span class="l1">DEAD</span><span class="l2">RECKONING</span></h1>
        <div class="sub">Nothing here is dead. Nothing here is alive.<br>Not until you look.</div>
      </div>
      <nav class="menu">
        ${unlocked > 0 ? `<button class="mi" data-continue><span>Continue</span><em>${cont.chapter} — ${cont.name}</em></button>` : ''}
        <button class="mi" data-new><span>${unlocked > 0 ? 'New game' : 'Begin'}</span><em>Prologue — The Basement</em></button>
        <button class="mi" data-chapters><span>Chapters</span></button>
        <button class="mi" data-guide><span>Field guide</span></button>
        <button class="mi" data-controls><span>Controls</span></button>
        <button class="mi" data-settings><span>Settings</span></button>
        <button class="mi" data-credits><span>Credits</span></button>
      </nav>
      <div class="corner">Quriosity 2026 · Track 1 — basis switching &amp; measurement</div>
    </div>`, 'menu-bg');
  on('[data-continue]', () => intro(cont));
  on('[data-new]', () => intro(MISSIONS[0]!));
  on('[data-chapters]', chapters);
  on('[data-guide]', () => page('Field guide', FIELD_GUIDE));
  on('[data-controls]', () => page('Controls', CONTROLS));
  on('[data-settings]', settings);
  on('[data-credits]', () => page('Credits', CREDITS));
}

const CONTROLS = `
  <table class="ctl">
    <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></td><td>Move</td><td><kbd>Shift</kbd></td><td>Sprint</td></tr>
    <tr><td><kbd>Mouse</kbd></td><td>Look</td><td><kbd>Space</kbd></td><td>Jump</td></tr>
    <tr><td><kbd>Left click</kbd></td><td>Fire</td><td><kbd>Right click</kbd></td><td>Aim / scope</td></tr>
    <tr><td><kbd>R</kbd></td><td>Reload</td><td><kbd>1</kbd> <kbd>2</kbd> <kbd>Q</kbd></td><td>Carbine / Marksman</td></tr>
    <tr><td><kbd class="k-amber">Z</kbd></td><td class="c-amber">Amber light</td><td><kbd class="k-cyan">X</kbd></td><td class="c-cyan">Cyan light</td></tr>
    <tr><td><kbd>F</kbd></td><td>Light off</td><td><kbd>E</kbd></td><td>Use / enter code</td></tr>
    <tr><td><kbd>Tab</kbd></td><td>Field guide</td><td><kbd>Esc</kbd></td><td>Pause</td></tr>
  </table>
  <p class="note">Ammunition is unlimited. Your flashlight battery recharges while the light is off.</p>`;

const CREDITS = `
  <div class="credits">
    <p><b>Design, code, sound</b> — made for Quriosity 2026 (ISAQC), Track 1.</p>
    <p><b>Zombie models</b> — Quaternius (quaternius.com) via Poly Pizza: “Zombie” (CC0), “Zombie” (CC0), “Zombie” (CC-BY 3.0).</p>
    <p><b>Music &amp; sound</b> — generated live with WebAudio.</p>
    <p><b>Physics</b> — every outcome you see is a real Born-rule measurement of a qubit, in the Z basis (amber) or the X basis (cyan).</p>
  </div>`;

function page(name: string, body: string): void {
  show(`<div class="page"><div class="page-head"><h2>${name}</h2><button class="back" data-back>Back</button></div>${body}</div>`, 'menu-bg');
  on('[data-back]', title);
}

function chapters(): void {
  show(`<div class="page"><div class="page-head"><h2>Chapters</h2><button class="back" data-back>Back</button></div>
    <div class="chapters">
      ${MISSIONS.map(m => `<button class="chap ${m.id > unlocked && !debug ? 'locked' : ''}" data-m="${m.id}">
        <span class="cn">${m.chapter}</span><span class="cname">${m.name}</span><span class="cplace">${m.place}</span></button>`).join('')}
    </div></div>`, 'menu-bg');
  on('[data-back]', title);
  on('[data-m]', el => {
    const m = MISSIONS[Number(el.dataset.m)]!;
    if (m.id <= unlocked || debug) intro(m);
  });
}

function settings(): void {
  show(`<div class="page"><div class="page-head"><h2>Settings</h2><button class="back" data-back>Back</button></div>
    <label class="set">Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.05" value="${sensitivity}" data-sens><span data-sv>${sensitivity.toFixed(2)}</span></label>
    <label class="set">Music volume <input type="range" min="0" max="1" step="0.05" value="${music.volume}" data-mus><span data-mv>${Math.round(music.volume * 100)}%</span></label>
    </div>`, 'menu-bg');
  on('[data-back]', title);
  const s = overlay.querySelector<HTMLInputElement>('[data-sens]')!, mu = overlay.querySelector<HTMLInputElement>('[data-mus]')!;
  s.oninput = () => { sensitivity = Number(s.value); store.set('sens', sensitivity); overlay.querySelector('[data-sv]')!.textContent = sensitivity.toFixed(2); };
  mu.oninput = () => { music.volume = Number(mu.value); store.set('music', music.volume); music.setMode('menu'); overlay.querySelector('[data-mv]')!.textContent = `${Math.round(music.volume * 100)}%`; };
}

// ------------------------------------------------------------------ story
function typewriter(lines: string[], el: HTMLElement, done: () => void): () => void {
  let i = 0, c = 0, timer = 0;
  const tick = () => {
    const line = lines[i];
    if (line === undefined) { done(); return; }
    c++;
    const html = lines.slice(0, i).map(l => `<p>${l}</p>`).join('') + `<p>${line.slice(0, c)}<span class="caret">▍</span></p>`;
    el.innerHTML = html;
    if (c >= line.length) { i++; c = 0; timer = window.setTimeout(tick, 900); } else timer = window.setTimeout(tick, 24);
  };
  tick();
  return () => { clearTimeout(timer); el.innerHTML = lines.map(l => `<p>${l}</p>`).join(''); done(); };
}

function intro(m: Mission): void {
  destroyGame();
  music.setMode('menu');
  show(`<div class="story">
      <div class="story-chapter">${m.chapter}</div>
      <h2 class="story-title">${m.name}</h2>
      <div class="story-place">${m.place}</div>
      <div class="story-text" data-text></div>
      <div class="concept"><h3><small>BEFORE YOU GO IN</small>${m.concept.title}</h3><ul>${m.concept.points.map(p => `<li>${p}</li>`).join('')}</ul></div>
      <div class="story-actions"><button class="primary" data-go>Enter</button><button class="ghost" data-skip>Skip text</button></div>
    </div>`, 'story-bg scroll');
  let finished = false;
  const skip = typewriter(m.intro, overlay.querySelector('[data-text]')!, () => { finished = true; overlay.querySelector('[data-skip]')?.remove(); });
  on('[data-skip]', () => { if (!finished) skip(); });
  on('[data-go]', () => { void start(m); });
}

async function start(m: Mission): Promise<void> {
  destroyGame();
  show('<div class="loading">Loading…</div>', 'story-bg');
  await modelsReady;
  hide();
  music.setMode('game');
  game = new Game({
    mission: m, container: stage, debug, sfx, music, models, sensitivity,
    onEnd: (r, s) => end(m, r, s),
    onPauseChange: p => (p ? pause(m) : hide()),
  });
  game.start();
  game.requestLock();
  stage.onclick = () => game?.requestLock();
}

function pause(m: Mission): void {
  show(`<div class="pause">
      <h2>PAUSED</h2>
      <div class="pause-sub">${m.chapter} · ${m.name}</div>
      <nav class="menu small">
        <button class="mi" data-resume><span>Resume</span></button>
        <button class="mi" data-guide><span>Field guide</span></button>
        <button class="mi" data-restart><span>Restart chapter</span></button>
        <button class="mi" data-menu><span>Quit to title</span></button>
      </nav>
      <div class="pause-guide" data-g></div>
    </div>`, 'dim');
  on('[data-resume]', () => { hide(); game?.requestLock(); });
  on('[data-guide]', () => { overlay.querySelector('[data-g]')!.innerHTML = FIELD_GUIDE; });
  on('[data-restart]', () => { void start(m); });
  on('[data-menu]', title);
}

function pct(a: number, b: number): string { return b ? ` (${Math.round((100 * a) / b)}%)` : ''; }

function end(m: Mission, r: EndResult, s: Stats): void {
  music.setMode('menu');
  if (r === 'win') { unlocked = Math.max(unlocked, m.id + 1); store.set('chapter', unlocked); }
  const next = MISSIONS.find(x => x.id === m.id + 1);
  const asked = s.amberDropped + s.amberWoke;
  const lines = [
    asked ? `Amber made <b>${asked}</b> undecided bodies choose: <b>${s.amberDropped}</b> dropped dead${pct(s.amberDropped, asked)}, <b>${s.amberWoke}</b> came alive${pct(s.amberWoke, asked)}.` : '',
    s.cyanRaised ? `Cyan raised <b>${s.cyanRaised}</b> corpse${s.cyanRaised === 1 ? '' : 's'}; <b>${s.raisedCameBackAlive}</b> later answered “alive”.` : 'You never raised a corpse with cyan.',
    s.scrambles ? `You scrambled a code screen <b>${s.scrambles}</b>× with amber.` : '',
    s.wrongCodes ? `<b>${s.wrongCodes}</b> wrong code${s.wrongCodes === 1 ? '' : 's'} entered.` : '',
  ].filter(Boolean);
  const mm = Math.floor(s.time / 60), ss = Math.floor(s.time % 60);
  if (r === 'win' && !next) { ending(); return; }
  show(`<div class="result ${r}">
      <div class="result-kicker">${r === 'win' ? 'CHAPTER COMPLETE' : 'YOU DIED'}</div>
      <h2>${m.name}</h2>
      ${r === 'win' && m.outro ? `<p class="outro">${m.outro}</p>` : ''}
      <div class="stats">
        <div><span>${mm}:${String(ss).padStart(2, '0')}</span>time</div>
        <div><span>${s.kills}</span>kills</div>
        <div><span>${s.shots ? Math.round((100 * s.hits) / s.shots) : 0}%</span>accuracy</div>
        <div><span>${s.bites}</span>bites</div>
      </div>
      <div class="debrief">${lines.map(x => `<p>${x}</p>`).join('')}</div>
      <nav class="menu small row">
        ${r === 'win' && next ? '<button class="mi primary" data-next><span>Continue</span></button>' : ''}
        <button class="mi ${r === 'dead' ? 'primary' : ''}" data-retry><span>${r === 'dead' ? 'Try again' : 'Replay'}</span></button>
        <button class="mi" data-menu><span>Title</span></button>
      </nav>
    </div>`, r === 'dead' ? 'dead-bg' : 'story-bg');
  on('[data-next]', () => next && intro(next));
  on('[data-retry]', () => { void start(m); });
  on('[data-menu]', title);
}

function ending(): void {
  destroyGame();
  show(`<div class="story">
      <div class="story-chapter">EPILOGUE</div>
      <h2 class="story-title">Lift-off</h2>
      <div class="story-text" data-text></div>
      <div class="story-actions"><button class="primary" data-menu>Title</button></div>
    </div>`, 'story-bg');
  typewriter(ENDING, overlay.querySelector('[data-text]')!, () => {});
  on('[data-menu]', title);
}

function destroyGame(): void {
  game?.dispose();
  game = null;
  stage.onclick = null;
}

// first interaction unlocks audio
window.addEventListener('pointerdown', audioOn, { once: true });
window.addEventListener('keydown', audioOn, { once: true });

title();
if (debug) {
  const n = params.get('m');
  if (n !== null) void start(MISSIONS[Number(n)]!);
  (window as unknown as { __start: (id: number) => Promise<void> }).__start = (id: number) => start(MISSIONS[id]!);
}
