/**
 * Tiny tween runner driven by the Pixi ticker. Enough for this game, and it
 * keeps every animation on one clock so "skip" and "turbo" work everywhere.
 */

export type Easing = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  /** Overshoots and settles back — the classic reel "bounce". */
  outBack: (t: number) => {
    const c1 = 1.2;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
} satisfies Record<string, Easing>;

export interface TweenOptions {
  duration: number;
  ease?: Easing;
  delay?: number;
  onUpdate: (progress: number) => void;
}

export interface TweenHandle {
  /** Resolves when the tween completes or is finished early. */
  readonly done: Promise<void>;
  /** Jumps to the end state and resolves. */
  finish(): void;
}

interface ActiveTween {
  elapsed: number;
  options: Required<TweenOptions>;
  resolve: () => void;
}

export class Tweens {
  private readonly active = new Set<ActiveTween>();

  add(options: TweenOptions): TweenHandle {
    let tween!: ActiveTween;
    const done = new Promise<void>((resolve) => {
      tween = {
        elapsed: 0,
        options: { ease: ease.linear, delay: 0, ...options },
        resolve,
      };
    });
    this.active.add(tween);
    return { done, finish: () => this.complete(tween) };
  }

  /** A pause on the same clock as every animation. */
  wait(ms: number): TweenHandle {
    return this.add({ duration: ms, onUpdate: () => {} });
  }

  update(deltaMs: number): void {
    for (const tween of this.active) {
      tween.elapsed += deltaMs;
      const { delay, duration, ease: easing, onUpdate } = tween.options;
      const t = tween.elapsed - delay;
      if (t < 0) continue;
      if (t >= duration) {
        this.complete(tween);
      } else {
        onUpdate(easing(t / duration));
      }
    }
  }

  finishAll(): void {
    for (const tween of [...this.active]) this.complete(tween);
  }

  get count(): number {
    return this.active.size;
  }

  private complete(tween: ActiveTween): void {
    if (!this.active.delete(tween)) return;
    tween.options.onUpdate(tween.options.ease(1));
    tween.resolve();
  }
}
