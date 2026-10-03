// Generative horror score: drone + dissonant pad + wind + music-box (menu) + heartbeat + stingers.
// `tension` (0..1) is driven by how many hostile bodies are near the player.
export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private padGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private timers: number[] = [];
  private mode: 'off' | 'menu' | 'game' = 'off';
  private tension = 0;
  private heartbeatT = 0;
  private lowHp = false;
  volume = 0.7;

  start(ctx: AudioContext | null): void {
    if (!ctx || this.ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    this.out.connect(comp); comp.connect(ctx.destination);

    // drone: detuned saws through a slow-moving lowpass
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass'; this.droneFilter.frequency.value = 180; this.droneFilter.Q.value = 6;
    const droneGain = ctx.createGain(); droneGain.gain.value = 0.16;
    this.droneFilter.connect(droneGain); droneGain.connect(this.out);
    for (const f of [41.2, 41.7, 61.7, 82.0]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      o.connect(this.droneFilter); o.start();
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 70;
    lfo.connect(lfoGain); lfoGain.connect(this.droneFilter.frequency); lfo.start();

    // dissonant pad: minor second + tritone cluster, slow tremolo
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0.0;
    this.padGain.connect(this.out);
    for (const f of [220, 233.1, 311.1, 329.6]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.05;
      const trem = ctx.createOscillator(); trem.frequency.value = 0.1 + Math.random() * 0.25;
      const tg = ctx.createGain(); tg.gain.value = 0.045;
      trem.connect(tg); tg.connect(g.gain); trem.start();
      o.connect(g); g.connect(this.padGain); o.start();
    }

    // wind: band-passed noise with a wandering centre
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 1.2;
    const wl = ctx.createOscillator(); wl.frequency.value = 0.05;
    const wlg = ctx.createGain(); wlg.gain.value = 300;
    wl.connect(wlg); wlg.connect(bp.frequency); wl.start();
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.05;
    noise.connect(bp); bp.connect(this.windGain); this.windGain.connect(this.out); noise.start();

    this.schedule();
  }

  private schedule(): void {
    const loop = (fn: () => void, min: number, max: number) => {
      const tick = () => { fn(); this.timers.push(window.setTimeout(tick, min + Math.random() * (max - min))); };
      this.timers.push(window.setTimeout(tick, min));
    };
    // music box (menu only): sparse notes from a harmonic minor scale, slightly out of tune
    const scale = [440, 466.2, 554.4, 587.3, 659.3, 698.5, 830.6, 880];
    loop(() => { if (this.mode === 'menu') this.bell(scale[Math.floor(Math.random() * scale.length)]! * (Math.random() < 0.3 ? 0.5 : 1) * (1 + (Math.random() - 0.5) * 0.012)); }, 650, 1500);
    // stingers (in game): metallic screech or a low boom
    loop(() => { if (this.mode === 'game' && Math.random() < 0.6) (Math.random() < 0.5 ? this.screech() : this.boom()); }, 16000, 34000);
  }

  setMode(m: 'off' | 'menu' | 'game'): void {
    this.mode = m;
    if (!this.ctx || !this.out) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.linearRampToValueAtTime(m === 'off' ? 0 : this.volume, t + 1.5);
    this.padGain!.gain.linearRampToValueAtTime(m === 'menu' ? 0.5 : 0.25, t + 2);
  }

  /** Called every frame in game. */
  update(dt: number, tension: number, hp: number): void {
    if (!this.ctx || this.mode !== 'game') return;
    this.tension += (tension - this.tension) * Math.min(1, dt * 1.5);
    const t = this.ctx.currentTime;
    this.droneFilter!.frequency.setTargetAtTime(160 + this.tension * 900, t, 0.3);
    this.padGain!.gain.setTargetAtTime(0.2 + this.tension * 0.6, t, 0.5);
    this.windGain!.gain.setTargetAtTime(0.05 + this.tension * 0.04, t, 0.5);
    this.lowHp = hp < 40;
    const bpm = this.lowHp ? 120 : 60 + this.tension * 70;
    this.heartbeatT -= dt;
    if ((this.tension > 0.25 || this.lowHp) && this.heartbeatT <= 0) {
      this.heartbeatT = 60 / bpm;
      this.thump(0); window.setTimeout(() => this.thump(1), 140);
    }
  }

  private env(gain: number, a: number, d: number): GainNode | null {
    if (!this.ctx || !this.out) return null;
    const g = this.ctx.createGain(); const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    g.connect(this.out);
    return g;
  }

  private bell(f: number): void {
    const g = this.env(0.09, 0.005, 2.4); if (!g || !this.ctx) return;
    for (const [mul, amp] of [[1, 1], [2.76, 0.35], [5.4, 0.12]] as const) {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mul;
      const og = this.ctx.createGain(); og.gain.value = amp;
      o.connect(og); og.connect(g); o.start(); o.stop(this.ctx.currentTime + 2.5);
    }
  }

  private thump(second: 0 | 1): void {
    const g = this.env(second ? 0.35 : 0.55, 0.005, 0.22); if (!g || !this.ctx) return;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    o.connect(g); o.start(); o.stop(t + 0.3);
  }

  screech(): void {
    const g = this.env(0.09, 0.4, 2.2); if (!g || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(1400 + Math.random() * 800, t);
    o.frequency.linearRampToValueAtTime(900 + Math.random() * 400, t + 2.6);
    const mod = this.ctx.createOscillator(); mod.frequency.value = 37;
    const mg = this.ctx.createGain(); mg.gain.value = 120;
    mod.connect(mg); mg.connect(o.frequency);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 8;
    o.connect(bp); bp.connect(g); o.start(); mod.start(); o.stop(t + 2.8); mod.stop(t + 2.8);
  }

  boom(): void {
    const g = this.env(0.6, 0.01, 2.5); if (!g || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(28, t + 2.4);
    o.connect(g); o.start(); o.stop(t + 2.6);
  }

  /** Jump-scare hit when something wakes up right next to you. */
  stab(): void {
    if (!this.ctx) return;
    const g = this.env(0.35, 0.005, 0.9); if (!g) return;
    const t = this.ctx.currentTime;
    for (const f of [311, 329.6, 466, 622]) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      o.connect(g); o.start(); o.stop(t + 1);
    }
  }
}
