// DOM overlay HUD. Updated once per rendered frame; writes only when text changes.
export type Filter = 'Z' | 'X' | 'off';

export interface HudState {
  hp: number;
  weapon: string;
  mag: number;
  magSize: number;
  reserve: number;
  reloading: number; // 0..1 progress, or -1
  filter: Filter;
  battery: number;
  objective: string;
  timer: string;
  inspector: string | null;
  spread: number; // crosshair gap in px
  ads: number; // 0..1
  scoped: boolean;
  prompt: string | null;
  code: (0 | 1)[] | null;
  progress: { value: number; total: number; label: string } | null;
  alive: number;
}

const glyph = (o: 0 | 1) => (o === 0 ? '<span class="g-plus">◯</span>' : '<span class="g-minus">◇</span>');
export const codeHtml = (c: readonly (0 | 1)[]) => c.map(glyph).join(' ');

export class Hud {
  readonly root = document.createElement('div');
  private els: Record<string, HTMLElement> = {};
  private cache: Record<string, string> = {};
  private tipTimer = 0;

  constructor(parent: HTMLElement) {
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="vignette" data-k="vignette"></div>
      <div class="scope" data-k="scope"><div class="scope-h"></div><div class="scope-v"></div><div class="scope-dot"></div></div>
      <div class="crosshair" data-k="cross"><i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><i class="ch-c"></i></div>
      <div class="hitmarker" data-k="hit"></div>
      <div class="top">
        <div class="objective" data-k="objective"></div>
        <div class="timer" data-k="timer"></div>
        <div class="progress" data-k="progress"><div class="bar"><div data-k="progressFill"></div></div><span data-k="progressLabel"></span></div>
      </div>
      <div class="tip" data-k="tip"></div>
      <div class="inspector" data-k="inspector"></div>
      <div class="prompt" data-k="prompt"></div>
      <div class="bl">
        <div class="hp"><span class="lbl">HP</span><span data-k="hpNum"></span><div class="bar"><div data-k="hpFill"></div></div></div>
        <div class="light"><span class="badge" data-k="filter"></span><div class="bar battery"><div data-k="battFill"></div></div>
          <span class="keys">[Z] amber · [X] cyan · [F] off</span></div>
        <div class="code" data-k="code"></div>
      </div>
      <div class="br">
        <div class="weapon" data-k="weapon"></div>
        <div class="ammo"><span data-k="mag"></span><span class="res" data-k="reserve"></span></div>
        <div class="reload" data-k="reload"><div data-k="reloadFill"></div></div>
        <div class="alive" data-k="alive"></div>
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
    this.set('objective', s.objective);
    this.set('timer', s.timer);
    this.set('hpNum', String(Math.max(0, Math.ceil(s.hp))));
    this.style('hpFill', 'width', `${Math.max(0, s.hp)}%`);
    this.style('hpFill', 'background', s.hp > 50 ? '#7cff9a' : s.hp > 25 ? '#ffc94a' : '#ff4a4a');
    const fName = s.filter === 'Z' ? 'AMBER · Z' : s.filter === 'X' ? 'CYAN · X' : 'LIGHT OFF';
    this.set('filter', fName);
    this.els.filter!.className = `badge f-${s.filter}`;
    this.style('battFill', 'width', `${s.battery}%`);
    this.set('weapon', s.weapon);
    this.set('mag', String(s.mag));
    this.set('reserve', `/ ${s.reserve}`);
    this.style('reload', 'opacity', s.reloading >= 0 ? '1' : '0');
    this.style('reloadFill', 'width', `${Math.max(0, s.reloading) * 100}%`);
    this.set('alive', `${s.alive} hostile`);
    this.set('inspector', s.inspector ?? '');
    this.style('inspector', 'opacity', s.inspector ? '1' : '0');
    this.set('prompt', s.prompt ?? '');
    this.style('prompt', 'opacity', s.prompt ? '1' : '0');
    this.set('code', s.code ? `CODE ${codeHtml(s.code)}` : '');
    if (s.progress) {
      this.style('progress', 'display', 'flex');
      this.style('progressFill', 'width', `${Math.min(100, (s.progress.value / s.progress.total) * 100)}%`);
      this.set('progressLabel', s.progress.label);
    } else this.style('progress', 'display', 'none');
    this.style('scope', 'display', s.scoped ? 'block' : 'none');
    this.style('cross', 'display', s.scoped ? 'none' : 'block');
    this.style('cross', '--gap', `${s.spread.toFixed(1)}px`);
    this.style('cross', 'opacity', s.ads > 0.6 ? '0.55' : '1');
    this.tipTimer -= dt;
    if (this.tipTimer <= 0) this.style('tip', 'opacity', '0');
  }

  tip(html: string, seconds = 5): void {
    this.cache.tip = '';
    this.set('tip', html);
    this.style('tip', 'opacity', '1');
    this.tipTimer = seconds;
  }

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
