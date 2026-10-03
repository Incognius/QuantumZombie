// Mandatory orientation before the first chapter: the player runs the real measurement
// rules on one specimen and one code panel, then signs off the field guide.
import { eigen, measure, PLUS } from '../quantum/qubit';
import type { Basis, Eigen } from '../quantum/qubit';
import { isIntact, lightTerminal, makeTerminal } from '../game/rules';
import { codeHtml } from './hud';

interface Task { text: string; done: boolean }

export function runLesson(root: HTMLElement, onDone: () => void, onSound: (k: 'click' | 'revive' | 'collapse' | 'charge' | 'good' | 'bad') => void): () => void {
  let theta = PLUS;
  let history: { basis: Basis; result: Eigen }[] = [];
  let raisedThenAsked = false;
  let sawRaise = false;
  const term = makeTerminal([0, 1, 1]);
  let codeRead: (0 | 1)[] | null = null;
  let scrambled = false;
  let rereadWrong = false;
  let panel = 'SHINE CYAN TO READ';
  let stage = 0;

  const tasks: Task[][] = [
    [
      { text: 'Press <b class="c-amber">Z</b> (amber) on the flickering specimen. It has to answer: dead or alive.', done: false },
      { text: 'Press <b class="c-amber">Z</b> two more times. Same question → same answer, every time.', done: false },
      { text: 'Press <b>R</b> for a fresh specimen and ask again until you have seen <b>both</b> answers. Fresh specimens are a coin flip.', done: false },
    ],
    [
      { text: 'Get a <b>dead</b> specimen (R, then Z until it drops).', done: false },
      { text: 'Now press <b class="c-cyan">X</b> (cyan) on the corpse. Cyan asks a different question — watch what happens to “dead”.', done: false },
      { text: 'Ask it with <b class="c-amber">Z</b> again. “Dead” is gone: it is a coin flip again.', done: false },
    ],
    [
      { text: 'Press <b class="c-cyan">C</b> to read the door code with cyan. Cyan reads codes exactly.', done: false },
      { text: 'Press <b class="c-amber">A</b> to shine amber on the code panel.', done: false },
      { text: 'Press <b class="c-cyan">C</b> again. The code you get now is noise — amber destroyed it.', done: false },
    ],
  ];
  const titles = ['1 · The amber question', '2 · The cyan question', '3 · Codes'];

  const ask = (b: Basis) => {
    const before = eigen(theta);
    const m = measure(theta, b, Math.random);
    theta = m.theta;
    const after = eigen(theta);
    history.push({ basis: b, result: after });
    if (before === 'dead' && b === 'X') { sawRaise = true; onSound('revive'); }
    else if (after === 'dead' && before !== 'dead') onSound('collapse');
    else if (after === 'alive' && before !== 'alive') onSound('charge');
    else onSound('click');
    if (sawRaise && b === 'Z' && (before === 'plus' || before === 'minus')) raisedThenAsked = true;
    check();
  };

  const check = () => {
    const t = tasks;
    const zs = history.filter(h => h.basis === 'Z');
    t[0]![0]!.done ||= zs.length > 0;
    const last3 = history.slice(-3);
    t[0]![1]!.done ||= last3.length === 3 && last3.every(h => h.basis === 'Z' && h.result === last3[0]!.result);
    t[0]![2]!.done ||= seen.dead && seen.alive;
    t[1]![0]!.done ||= eigen(theta) === 'dead';
    t[1]![1]!.done ||= sawRaise;
    t[1]![2]!.done ||= raisedThenAsked;
    t[2]![0]!.done ||= !!codeRead;
    t[2]![1]!.done ||= scrambled;
    t[2]![2]!.done ||= rereadWrong;
    render();
  };

  const seen = { dead: false, alive: false };
  const track = () => { const e = eigen(theta); if (e === 'dead') seen.dead = true; if (e === 'alive') seen.alive = true; };

  const specimenHtml = () => {
    const e = eigen(theta);
    const label = e === 'dead' ? 'DEAD' : e === 'alive' ? 'ALIVE' : `UNDECIDED · cyan answer ${e === 'plus' ? '◯' : '◇'}`;
    const sub = e === 'dead' ? 'Amber: certain. Cyan: 50/50.' : e === 'alive' ? 'Amber: certain. Cyan: 50/50.' : 'Cyan: certain. Amber: 50/50.';
    return `<div class="specimen s-${e}"><svg viewBox="0 0 100 140"><g class="fig">
        <circle cx="50" cy="22" r="13"/><rect x="36" y="38" width="28" height="46" rx="6"/>
        <rect x="18" y="40" width="12" height="44" rx="5" class="arm l"/><rect x="70" y="40" width="12" height="44" rx="5" class="arm r"/>
        <rect x="38" y="84" width="10" height="46" rx="4"/><rect x="52" y="84" width="10" height="46" rx="4"/>
        <circle cx="45" cy="21" r="2.6" class="eye"/><circle cx="55" cy="21" r="2.6" class="eye"/></g></svg>
      <div class="sp-label">${label}</div><div class="sp-sub">${sub}</div></div>`;
  };

  const render = () => {
    const isGuide = stage === 3;
    const all = tasks[stage] ?? [];
    const stageDone = all.every(t => t.done);
    root.innerHTML = isGuide ? guideHtml() : `
      <div class="lesson">
        <div class="lesson-head"><span class="kicker">ORIENTATION · HARLOW FACILITY</span><h2>${titles[stage]}</h2></div>
        <div class="lesson-body">
          <div class="lesson-stage">
            ${stage < 2 ? specimenHtml() : `<div class="codepanel ${scrambled && !isIntact(term) ? 'bad' : ''}"><div class="cp-label">DOOR CODE · stored in cyan</div><div class="cp-screen">${panel}</div></div>`}
            <div class="lesson-keys">
              ${stage < 2 ? '<button data-k="Z" class="lk amber">Z · amber</button><button data-k="X" class="lk cyan">X · cyan</button><button data-k="R" class="lk">R · fresh specimen</button>'
                : '<button data-k="C" class="lk cyan">C · cyan on panel</button><button data-k="A" class="lk amber">A · amber on panel</button>'}
            </div>
            <div class="lesson-log">${stage < 2 ? history.slice(-8).map(h => `<span class="${h.basis === 'Z' ? 'c-amber' : 'c-cyan'}">${h.basis}→${h.result === 'plus' ? '◯' : h.result === 'minus' ? '◇' : h.result}</span>`).join(' ') : ''}</div>
          </div>
          <ol class="tasks">${all.map(t => `<li class="${t.done ? 'done' : ''}">${t.text}</li>`).join('')}</ol>
        </div>
        <div class="lesson-foot">${stageDone ? '<button class="primary" data-next>Next</button>' : '<span class="muted">Complete every step to continue.</span>'}</div>
      </div>`;
    root.querySelectorAll<HTMLElement>('[data-k]').forEach(b => b.onclick = () => key(b.dataset.k!));
    root.querySelector<HTMLElement>('[data-next]')?.addEventListener('click', next);
    root.querySelector<HTMLInputElement>('[data-ack]')?.addEventListener('change', e => {
      root.querySelector<HTMLButtonElement>('[data-begin]')!.disabled = !(e.target as HTMLInputElement).checked;
    });
    root.querySelector<HTMLElement>('[data-begin]')?.addEventListener('click', () => { onSound('good'); cleanup(); onDone(); });
  };

  const next = () => {
    onSound('good');
    stage++;
    if (stage === 1) { theta = PLUS; history = []; }
    render();
  };

  const key = (k: string) => {
    if (stage < 2) {
      if (k === 'Z' || k === 'X') { const b: Basis = k; ask(b); track(); check(); }
      if (k === 'R') { theta = PLUS; onSound('click'); render(); }
    } else if (stage === 2) {
      if (k === 'C') {
        const r = lightTerminal(term, 'X', Math.random);
        panel = codeHtml(r.outcomes);
        if (scrambled) rereadWrong = true; // after amber, any read is noise (even if it matches by luck)
        else codeRead = r.outcomes;
        onSound('click');
      }
      if (k === 'A') {
        const r = lightTerminal(term, 'Z', Math.random);
        panel = `<span class="c-amber">${r.outcomes.join(' ')}</span>`;
        if (r.scrambledNow || !isIntact(term)) scrambled = true;
        onSound('bad');
      }
      check();
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || stage >= 3) return;
    const k = e.key.toUpperCase();
    if (['Z', 'X', 'R', 'C', 'A'].includes(k)) key(k);
  };
  document.addEventListener('keydown', onKeyDown);
  const cleanup = () => document.removeEventListener('keydown', onKeyDown);

  const guideHtml = () => `
    <div class="lesson guide-final">
      <div class="lesson-head"><span class="kicker">FIELD GUIDE · READ BEFORE DEPLOYMENT</span><h2>What every key does</h2></div>
      <table class="fg">
        <tr><td><kbd class="k-amber">Z</kbd></td><td><b class="c-amber">Amber light.</b> Asks everything in the beam “dead or alive?”. Flickering bodies must answer — about half drop dead, half turn alive. Corpses stay dead. <b>Never point it at a code screen</b>: it destroys the code.</td></tr>
        <tr><td><kbd class="k-cyan">X</kbd></td><td><b class="c-cyan">Cyan light.</b> Asks the other question. The only way to read door codes and hold the radio beacon. Any corpse it touches loses “dead” and stands up flickering.</td></tr>
        <tr><td><kbd>F</kbd></td><td>Light off. The battery only recharges while the light is off.</td></tr>
        <tr><td><kbd>E</kbd></td><td>Use: enter a code at a door you have read, flip a floodlight switch.</td></tr>
        <tr><td><kbd>LMB</kbd> <kbd>RMB</kbd></td><td>Fire / aim. Aiming at a body shows what you already know about it. A bullet also asks “dead or alive?”. Shoot what has <b style="color:#ff2a2a">red eyes</b>. Ammo is unlimited; <kbd>R</kbd> reloads.</td></tr>
        <tr><td><kbd>1</kbd> <kbd>2</kbd></td><td>Carbine / scoped Marksman.</td></tr>
        <tr><td><kbd>W A S D</kbd></td><td>Move · <kbd>Shift</kbd> sprint · <kbd>Space</kbd> jump · <kbd>Tab</kbd> this guide in-game · <kbd>Esc</kbd> pause.</td></tr>
        <tr><td>Map</td><td>Top-right minimap: green diamond = current objective, red = alive, teal/violet = undecided.</td></tr>
      </table>
      <label class="ack"><input type="checkbox" data-ack> I understand: amber decides bodies, cyan reads codes and wakes the dead.</label>
      <div class="lesson-foot"><button class="primary" data-begin disabled>Begin the Prologue</button></div>
    </div>`;

  render();
  return cleanup;
}
