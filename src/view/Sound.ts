/**
 * Win sounds, synthesized with the Web Audio API. No audio files to load,
 * and every note is scheduled on the audio clock, so timing stays tight.
 *
 * Browsers only allow audio after a user gesture, so the context is
 * created on the first click or key press.
 */

const MASTER_VOLUME = 0.5;

/** Note frequencies in Hz, C major only: bright and happy. */
const N = { G5: 783.99, C6: 1046.5, E6: 1318.51, G6: 1567.98, C7: 2093.0 };

/** [note, start in beats, length in beats]. One beat = BEAT seconds. */
type Melody = [freq: number, at: number, length: number][];
const BEAT = 0.075;

/** A quick upward "ta-da". */
const SMALL_WIN: Melody = [
  [N.C6, 0, 1],
  [N.E6, 1, 1],
  [N.G6, 2, 1],
  [N.C7, 3, 4],
];

/** A bouncy "da-da-da-DAA, da-da-DAAA" that ends on a big held chord. */
const BIG_WIN: Melody = [
  [N.G5, 0, 1],
  [N.C6, 1, 1],
  [N.E6, 2, 1],
  [N.G6, 3, 3],
  [N.E6, 6, 1],
  [N.G6, 7, 1],
  [N.C7, 8, 12],
];
/** Held under the last note of the big win. */
const BIG_CHORD = [N.C6, N.E6, N.G6];
const BIG_CHORD_AT = 8;

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Sounds of the current win, so skip can cut them all at once. */
  private bus: GainNode | null = null;
  private muted: boolean;

  constructor(muted = false) {
    this.muted = muted;
    const unlock = () => {
      const ctx = this.context();
      if (ctx?.state === 'suspended') void ctx.resume();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stop();
  }

  /** A jingle, then coin clinks spread over `durationMs`. */
  playWin(big: boolean, durationMs: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.stop();
    const bus = ctx.createGain();
    bus.connect(this.master!);
    this.bus = bus;

    const now = ctx.currentTime;
    for (const [freq, at, length] of big ? BIG_WIN : SMALL_WIN) {
      this.bell(bus, freq, now + at * BEAT, length * BEAT + 0.25, 0.22);
    }
    if (big) {
      const chordAt = now + BIG_CHORD_AT * BEAT;
      for (const freq of BIG_CHORD) this.bell(bus, freq, chordAt, 1.4, 0.08, true);
    }

    const seconds = durationMs / 1000;
    const clinks = Math.round(seconds * (big ? 14 : 6));
    for (let i = 0; i < clinks; i++) this.coin(bus, now + 0.1 + Math.random() * seconds * 0.8);
  }

  /** Fades out whatever the current win is still playing. */
  stop(): void {
    const bus = this.bus;
    if (!bus || !this.ctx) return;
    this.bus = null;
    const now = this.ctx.currentTime;
    bus.gain.setValueAtTime(bus.gain.value, now);
    bus.gain.linearRampToValueAtTime(0, now + 0.08);
    setTimeout(() => bus.disconnect(), 200);
  }

  /** The context, only when it can play right now. */
  private ready(): AudioContext | null {
    if (this.muted || this.ctx?.state !== 'running') return null;
    return this.ctx;
  }

  private context(): AudioContext | null {
    if (!this.ctx && typeof AudioContext !== 'undefined') {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_VOLUME;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /**
   * A bright, happy note: a triangle plus a softer sine an octave up for
   * sparkle. `wobble` adds a light vibrato, for held notes.
   */
  private bell(dest: AudioNode, freq: number, at: number, length: number, volume: number, wobble = false): void {
    const main = this.tone(dest, freq, at, length, 'triangle', volume);
    const shimmer = this.tone(dest, freq * 2, at, length * 0.6, 'sine', volume * 0.35);
    if (!wobble) return;
    const ctx = this.ctx!;
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 6;
    depth.gain.value = 12; // cents
    lfo.connect(depth);
    depth.connect(main.detune);
    depth.connect(shimmer.detune);
    lfo.start(at);
    lfo.stop(at + length + 0.05);
  }

  /** Two quick high blips: a coin hitting a pile. */
  private coin(dest: AudioNode, at: number): void {
    const detune = 1 + (Math.random() - 0.5) * 0.06;
    this.tone(dest, 2637 * detune, at, 0.12, 'sine', 0.08);
    this.tone(dest, 3520 * detune, at + 0.05, 0.2, 'sine', 0.06);
  }

  private tone(
    dest: AudioNode,
    freq: number,
    at: number,
    length: number,
    type: OscillatorType,
    volume: number,
  ): OscillatorNode {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    // Fast attack, exponential decay: a plucked, bell-like note.
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(volume, at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(env).connect(dest);
    osc.start(at);
    osc.stop(at + length + 0.05);
    return osc;
  }
}
