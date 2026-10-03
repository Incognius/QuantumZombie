// Tiny WebAudio synth: every sound is generated, nothing to download.
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }

  private env(gain: number, attack: number, decay: number): GainNode | null {
    if (!this.ctx || !this.master || this.muted) return null;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master);
    return g;
  }

  private noise(gain: number, decay: number, freq: number, q = 0.7): void {
    const g = this.env(gain, 0.002, decay);
    if (!g || !this.ctx || !this.noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
    src.connect(f); f.connect(g);
    src.start(); src.stop(this.ctx.currentTime + decay + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, gain: number, decay: number, attack = 0.005): void {
    const g = this.env(gain, attack, decay);
    if (!g || !this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = type;
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
    o.connect(g); o.start(); o.stop(t + attack + decay + 0.05);
  }

  shot(): void { this.noise(0.9, 0.16, 2600); this.tone('square', 160, 50, 0.25, 0.08); }
  rifle(): void { this.noise(1.0, 0.45, 1800); this.tone('sawtooth', 120, 35, 0.4, 0.25); }
  dry(): void { this.tone('square', 900, 700, 0.08, 0.03); }
  reload(): void { this.tone('square', 500, 300, 0.12, 0.05); setTimeout(() => this.tone('square', 700, 900, 0.12, 0.05), 350); }
  bolt(): void { this.tone('square', 380, 260, 0.12, 0.06); }
  click(): void { this.tone('triangle', 1400, 1100, 0.15, 0.04); }
  hit(): void { this.tone('triangle', 900, 400, 0.18, 0.06); }
  headshot(): void { this.tone('triangle', 1600, 900, 0.22, 0.09); }
  collapse(): void { this.noise(0.35, 0.3, 400); }
  bite(): void { this.noise(0.7, 0.18, 700, 4); this.tone('sawtooth', 90, 60, 0.3, 0.2); }
  groan(): void { this.tone('sawtooth', 70 + Math.random() * 30, 50, 0.12, 0.7, 0.15); }
  revive(): void { this.tone('sine', 220, 660, 0.25, 0.6, 0.05); this.tone('sine', 330, 990, 0.12, 0.6, 0.05); }
  charge(): void { this.tone('sawtooth', 110, 220, 0.2, 0.35, 0.02); }
  alarm(): void { for (let i = 0; i < 4; i++) setTimeout(() => this.tone('square', 880, 660, 0.18, 0.22), i * 260); }
  good(): void { this.tone('sine', 523, 523, 0.2, 0.15); setTimeout(() => this.tone('sine', 784, 784, 0.2, 0.3), 140); }
  bad(): void { this.tone('square', 220, 110, 0.25, 0.4); }
  pickup(): void { this.tone('sine', 660, 990, 0.2, 0.12); }
}
