// DOM overlay HUD. Updated once per rendered frame; writes only when something changed.
export type Filter = 'Z' | 'X' | 'off';

export interface HudState {
  hp: number;
  weapon: string;
  mag: number;
  reloading: number; // 0..1 progress, or -1
  filter: Filter;
  battery: number;
  chapter: string;
  objective: string;
  inspector: string | null;
  spread: number;
  ads: number;
  scoped: boolean;
  prompt: string | null;
  codes: { label: string; html: string }[];
  progress: { value: number; total: number; label: string } | null;
  danger: number; // 0..1, hostile pressure (screen edge pulse)
}

const glyph = (o: 0 | 1) => (o === 0 ? '<span class="g-plus">◯</span>' : '<span class="g-minus">◇</span>');
export const codeHtml = (c: readonly (0 | 1)[]) => c.map(glyph).join('');

export const FIELD_GUIDE = `
  <div class="guide">
    <div class="guide-col">
      <h4>THE BODIES</h4>
      <div class="gl"><span class="sw sw-dead"></span><b>DEAD</b> — on the floor. Harmless while it stays that way.</div>
      <div class="gl"><span class="sw sw-und"></span><b>UNDECIDED</b> — flickering, see-through. Not dead, not alive. Slow.</div>
      <div class="gl"><span class="sw sw-alive"></span><b>ALIVE</b> — solid, red eyes, fast. <b>Shoot these.</b></div>
    </div>
    <div class="guide-col">
      <h4>YOUR LIGHT</h4>
      <div class="gl"><span class="kb k-amber">Z</span><b class="c-amber">AMBER</b> asks <i>“dead or alive?”</i> Undecided bodies answer: about half drop dead, half turn alive. The dead stay dead.</div>
      <div class="gl"><span class="kb k-cyan">X</span><b class="c-cyan">CYAN</b> asks a different question. It is the only way to read door codes — but a corpse it touches <b>forgets it was dead</b> and gets up undecided.</div>
    </div>
    <div class="guide-col">
      <h4>RULES OF THUMB</h4>
      <div class="gl">Walk through the dead under <b class="c-amber">amber</b>.</div>
      <div class="gl">Use <b class="c-cyan">cyan</b> only on screens, up close, aimed away from bodies.</div>
      <div class="gl">Never shine <b class="c-amber">amber</b> on a code screen — it scrambles the code.</div>
      <div class="gl">Bullets and bites also ask “dead or alive?”.</div>
    </div>
  </div>`;

export class Hud {
  readonly root = document.createElement('div');
  private els: Record<string, HTMLElement> = {};
  private cache: Record<string, string> = {};
  private tipTimer = 0;
  private radioTimer = 0;
  private radioFull = '';
  private radioShown = 0;

  constructor(parent: HTMLElement) {
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="grain"></div>
      <div class="vignette-static"></div>
      <div class="danger" data-k="danger"></div>
      <div class="vignette" data-k="vignette"></div>
      <div class="scope" data-k="scope"><div class="scope-h"></div><div class="scope-v"></div><div class="scope-dot"></div></div>
      <div class="crosshair" data-k="cross"><i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><i class="ch-c"></i></div>
      <div class="hitmarker" data-k="hit"></div>
      <div class="objective-panel">
        <div class="chapter" data-k="chapter"></div>
        <div class="obj-label">OBJECTIVE</div>
        <div class="objective" data-k="objective"></div>
        <div class="progress" data-k="progress"><div class="bar"><div data-k="progressFill"></div></div><span data-k="progressLabel"></span></div>
        <div class="codes" data-k="codes"></div>
      </div>
      <div class="tip" data-k="tip"></div>
      <div class="radio" data-k="radio"></div>
      <div class="inspector" data-k="inspector"></div>
      <div class="prompt" data-k="prompt"></div>
      <div class="guide-wrap" data-k="guide">${FIELD_GUIDE}<div class="guide-foot">hold TAB</div></div>
      <div class="bl">
        <div class="hp"><svg viewBox="0 0 24 24" class="ic"><path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z"/></svg><span data-k="hpNum"></span><div class="bar"><div data-k="hpFill"></div></div></div>
        <div class="light"><span class="badge" data-k="filter"></span><div class="bar battery"><div data-k="battFill"></div></div></div>
      </div>
      <div class="br">
        <div class="weapon" data-k="weapon"></div>
        <div class="ammo"><span data-k="mag"></span><span class="res">/ ∞</span></div>
        <div class="reload" data-k="reload"><div data-k="reloadFill"></div></div>
      </div>`;
    this.root.querySelectorAll<HTMLElement>('[data-k]').forEach(e => { this.els[e.dataset.k!] = e; });
    parent.appendChild(this.root);
  }

  private set(k: string, html: string): void {
    if (this.cache[k] === html) return;
    this.cache[k] = html;
    this.els[k]!.innerHTML = html;
  }
  private style(k: string, prop: string, v: string): void {
    const key = `${k}.${prop}`;
    if (this.cache[key] === v) return;
    this.cache[key] = v;
    this.els[k]!.style.setProperty(prop, v);
  }

  update(s: HudState, dt: number): void {
    this.set('chapter', s.chapter);
    this.set('objective', s.objective);
    this.set('hpNum', String(Math.max(0, Math.ceil(s.hp))));
    this.style('hpFill', 'width', `${Math.max(0, s.hp)}%`);
    this.style('hpFill', 'background', s.hp > 50 ? '#c9d6cf' : s.hp > 25 ? '#ffb347' : '#ff3b3b');
    this.set('filter', s.filter === 'Z' ? 'AMBER · DEAD OR ALIVE?' : s.filter === 'X' ? 'CYAN · READS CODES' : 'LIGHT OFF');
    this.els.filter!.className = `badge f-${s.filter}`;
    this.style('battFill', 'width', `${s.battery}%`);
    this.set('weapon', s.weapon);
    this.set('mag', String(s.mag));
    this.style('reload', 'opacity', s.reloading >= 0 ? '1' : '0');
    this.style('reloadFill', 'width', `${Math.max(0, s.reloading) * 100}%`);
    this.set('inspector', s.inspector ?? '');
    this.style('inspector', 'opacity', s.inspector ? '1' : '0');
    this.set('prompt', s.prompt ?? '');
    this.style('prompt', 'opacity', s.prompt ? '1' : '0');
    this.set('codes', s.codes.map(c => `<div><span>${c.label}</span>${c.html}</div>`).join(''));
    if (s.progress) {
      this.style('progress', 'display', 'flex');
      this.style('progressFill', 'width', `${Math.min(100, (s.progress.value / s.progress.total) * 100)}%`);
      this.set('progressLabel', s.progress.label);
    } else this.style('progress', 'display', 'none');
    this.style('scope', 'display', s.scoped ? 'block' : 'none');
    this.style('cross', 'display', s.scoped ? 'none' : 'block');
    this.style('cross', '--gap', `${s.spread.toFixed(1)}px`);
    this.style('cross', 'opacity', s.ads > 0.6 ? '0.55' : '1');
    this.style('danger', 'opacity', s.danger.toFixed(2));
    this.tipTimer -= dt;
    if (this.tipTimer <= 0) this.style('tip', 'opacity', '0');
    // radio typewriter
    if (this.radioShown < this.radioFull.length) {
      this.radioShown = Math.min(this.radioFull.length, this.radioShown + dt * 55);
      const n = Math.floor(this.radioShown);
      const txt = this.radioFull.slice(0, n);
      const i = txt.indexOf(':');
      this.set('radio', i > 0 && i < 14 ? `<b>${txt.slice(0, i)}</b>${txt.slice(i)}` : txt);
    }
    this.radioTimer -= dt;
    this.style('radio', 'opacity', this.radioTimer > 0 ? '1' : '0');
  }

  tip(html: string, seconds = 5): void {
    this.cache.tip = '';
    this.set('tip', html);
    this.style('tip', 'opacity', '1');
    this.tipTimer = seconds;
  }

  radio(text: string): void {
    this.radioFull = text;
    this.radioShown = 0;
    this.radioTimer = 4 + text.length / 22;
  }

  guide(show: boolean): void { this.style('guide', 'opacity', show ? '1' : '0'); }

  damage(): void {
    const v = this.els.vignette!;
    v.classList.remove('hurt'); void v.offsetWidth; v.classList.add('hurt');
  }

  hitMarker(head: boolean): void {
    const h = this.els.hit!;
    h.className = 'hitmarker'; void h.offsetWidth; h.className = `hitmarker on${head ? ' head' : ''}`;
  }

  destroy(): void { this.root.remove(); }
}
