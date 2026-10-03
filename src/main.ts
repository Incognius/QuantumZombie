import './style.css';
import { Game } from './engine/game';
import type { EndResult, Stats } from './engine/game';
import { Sfx } from './engine/audio';
import { LEVELS } from './levels';
import type { LevelDef } from './levels';

const debug = new URLSearchParams(location.search).has('debug');
const app = document.getElementById('app')!;
const stage = document.createElement('div');
stage.className = 'stage';
const overlay = document.createElement('div');
overlay.className = 'overlay';
app.append(stage, overlay);

const sfx = new Sfx();
let game: Game | null = null;
let unlocked = loadProgress();

function loadProgress(): number {
  try { return Math.max(1, Number(localStorage.getItem('dr.unlocked')) || 1); } catch { return 1; }
}
function saveProgress(n: number): void {
  unlocked = Math.max(unlocked, n);
  try { localStorage.setItem('dr.unlocked', String(unlocked)); } catch { /* private mode */ }
}

function show(html: string): HTMLElement {
  overlay.innerHTML = `<div class="panel">${html}</div>`;
  overlay.style.display = 'flex';
  return overlay;
}
function hide(): void { overlay.style.display = 'none'; overlay.innerHTML = ''; }
function on(sel: string, f: () => void): void {
  overlay.querySelectorAll<HTMLElement>(sel).forEach(el => el.addEventListener('click', e => { e.stopPropagation(); sfx.unlock(); sfx.click(); f(); }));
}

const CONTROLS = `
  <div class="controls">
    <div><kbd>W A S D</kbd> move · <kbd>Shift</kbd> sprint · <kbd>Space</kbd> jump</div>
    <div><kbd>LMB</kbd> fire · <kbd>RMB</kbd> aim / scope · <kbd>R</kbd> reload · <kbd>1</kbd><kbd>2</kbd>/<kbd>Q</kbd> weapons</div>
    <div><kbd class="k-amber">Z</kbd> amber light · <kbd class="k-cyan">X</kbd> cyan light · <kbd>F</kbd> light off · <kbd>E</kbd> use</div>
  </div>`;

function title(): void {
  destroyGame();
  show(`
    <h1 class="logo">DEAD <span>RECKONING</span></h1>
    <p class="tag">Your flashlight asks questions. The dead have to answer.</p>
    <div class="rules">
      <div class="rule amber"><b>AMBER [Z]</b> asks: <i>dead or alive?</i><br>Every body it touches must answer — and keeps that answer while you keep asking the same thing.</div>
      <div class="rule cyan"><b>CYAN [X]</b> asks a <i>different</i> question: <span class="g-plus">◯</span> or <span class="g-minus">◇</span>?<br>Answering it wipes out the answer to amber. Corpses included.</div>
    </div>
    <div class="levels">
      ${LEVELS.map(l => `<button class="level ${l.id > unlocked ? 'locked' : ''}" data-level="${l.id}">
        <span class="num">0${l.id}</span><span class="name">${l.name}</span><span class="obj">${l.objective}</span></button>`).join('')}
    </div>
    ${CONTROLS}
    <p class="foot">Quriosity 2026 · Track 1: basis switching &amp; measurement scrambling · every outcome is a real Born-rule measurement</p>`);
  overlay.querySelectorAll<HTMLElement>('[data-level]').forEach(b => b.addEventListener('click', () => {
    sfx.unlock(); sfx.click();
    const l = LEVELS.find(x => x.id === Number(b.dataset.level))!;
    if (l.id > unlocked && !debug) return;
    briefing(l);
  }));
}

function briefing(l: LevelDef): void {
  destroyGame();
  show(`
    <div class="kicker">MISSION 0${l.id}</div>
    <h2>${l.name}</h2>
    ${l.briefing.map(s => `<p class="brief">${s}</p>`).join('')}
    <div class="objective-line">OBJECTIVE · ${l.objective}</div>
    ${CONTROLS}
    <button class="primary" data-go>DEPLOY</button> <button data-back>Back</button>`);
  on('[data-back]', title);
  on('[data-go]', () => start(l));
}

function start(l: LevelDef): void {
  destroyGame();
  hide();
  game = new Game({
    level: l, container: stage, debug, sfx,
    onEnd: (r, s) => end(l, r, s),
    onPauseChange: p => (p ? pause(l) : hide()),
  });
  game.start();
  game.requestLock();
  if (!debug) {
    // first click on the canvas (if the browser refused the lock) grabs the mouse
    stage.addEventListener('click', () => game?.requestLock());
  }
}

function pause(l: LevelDef): void {
  show(`<h2>PAUSED</h2>${CONTROLS}
    <button class="primary" data-resume>Resume</button> <button data-restart>Restart</button> <button data-menu>Menu</button>`);
  on('[data-resume]', () => { hide(); game?.requestLock(); });
  on('[data-restart]', () => start(l));
  on('[data-menu]', title);
}

const FIELD_NOTES: Record<number, string> = {
  1: '“Dead or alive?” and “◯ or ◇?” are two different questions. A body can hold a sure answer to only one of them at a time.',
  2: 'Reading a cyan code under amber doesn’t just fail — it overwrites the code. The look itself is the damage.',
  3: 'The uplink only works while nothing asks it the wrong question. Every amber sweep is a measurement you can’t take back.',
};

function pct(a: number, b: number): string { return b ? ` (${Math.round((100 * a) / b)}%)` : ''; }

function end(l: LevelDef, r: EndResult, s: Stats): void {
  if (r === 'win') saveProgress(l.id + 1);
  const next = LEVELS.find(x => x.id === l.id + 1);
  const asked = s.amberDropped + s.amberWoke;
  const lines = [
    asked ? `Amber questioned <b>${asked}</b> undecided bodies: <b>${s.amberDropped}</b> answered dead${pct(s.amberDropped, asked)}, <b>${s.amberWoke}</b> alive${pct(s.amberWoke, asked)}.` : '',
    s.cyanRaised ? `Cyan raised <b>${s.cyanRaised}</b> corpse${s.cyanRaised === 1 ? '' : 's'}. <b>${s.raisedCameBackAlive}</b> later answered “alive”.` : 'You never raised a corpse with cyan. Clean.',
    s.bulletsAsked ? `<b>${s.bulletsAsked}</b> bullets hit undecided bodies — each hit asked “dead or alive?” too.` : '',
    s.scrambles ? `You scrambled the terminal <b>${s.scrambles}</b> time${s.scrambles === 1 ? '' : 's'} with amber.` : '',
    s.wrongCodes ? `<b>${s.wrongCodes}</b> wrong code${s.wrongCodes === 1 ? '' : 's'} entered — read off a scrambled screen.` : '',
  ].filter(Boolean);
  const mm = Math.floor(s.time / 60), ss = Math.floor(s.time % 60);
  show(`
    <div class="kicker">${r === 'win' ? 'EXTRACTED' : 'YOU DIED'}</div>
    <h2>${l.name}</h2>
    <div class="stats">
      <div><span>${mm}:${String(ss).padStart(2, '0')}</span>time</div>
      <div><span>${s.kills}</span>kills</div>
      <div><span>${s.shots ? Math.round((100 * s.hits) / s.shots) : 0}%</span>accuracy</div>
      <div><span>${s.headshots}</span>headshots</div>
      <div><span>${s.bites}</span>bites taken</div>
    </div>
    <div class="debrief">${lines.map(x => `<p>${x}</p>`).join('')}</div>
    <p class="fieldnote">${FIELD_NOTES[l.id] ?? ''}</p>
    ${r === 'win' && next ? '<button class="primary" data-next>Next mission</button>' : ''}
    ${r === 'win' && !next ? '<p class="brief">You made it out. Every collapse you saw was a real coin flip, weighted by the Born rule.</p>' : ''}
    <button ${r === 'dead' ? 'class="primary"' : ''} data-retry>Retry</button> <button data-menu>Menu</button>`);
  on('[data-next]', () => next && briefing(next));
  on('[data-retry]', () => start(l));
  on('[data-menu]', title);
}

function destroyGame(): void {
  game?.dispose();
  game = null;
}

title();
if (debug) {
  const n = Number(new URLSearchParams(location.search).get('level'));
  const l = LEVELS.find(x => x.id === n);
  if (l) start(l);
  (window as unknown as { __start: (id: number) => void }).__start = (id: number) => start(LEVELS.find(x => x.id === id)!);
}
