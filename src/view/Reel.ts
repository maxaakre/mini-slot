import { Container, Sprite, type Texture } from 'pixi.js';
import { ROWS, type SymbolId } from '../math/config';
import { SYMBOL_SIZE } from './symbolTextures';
import { ease, type TweenHandle, type Tweens } from './tween';

/** Visible rows plus one hidden row above, which is where symbols wrap in. */
const COUNT = ROWS + 1;
const MAX_SPEED = 0.028; // symbols per ms
const ACCELERATION = 0.00025; // symbols per ms²
const SLAM_DURATION = 140;

export interface StopTiming {
  delay: number;
  duration: number;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Vertical centre of a row, in reel coordinates. Row -1 is the hidden wrap row. */
export const rowCenterY = (row: number) => row * SYMBOL_SIZE + SYMBOL_SIZE / 2;

/**
 * One reel column. `position` is a float in symbol units. Each sprite's
 * slot is `(position + index) mod COUNT`, so the same few sprites scroll
 * forever — nothing is created or destroyed while spinning.
 *
 * To land on a server result, the stop tween always travels at least one
 * full cycle. Every sprite then wraps at least once, and on its wrap it
 * gets the texture for the row it will end on.
 */
export class Reel {
  readonly view = new Container();
  private readonly sprites: Sprite[] = [];
  private readonly cycles: number[] = [];
  private readonly rowSprites: Sprite[] = [];
  private position = 0;
  private velocity = 0;
  private phase: 'idle' | 'spinning' | 'stopping' = 'idle';
  private target: readonly SymbolId[];
  private finalPosition = 0;
  private slammed = false;
  private delayHandle: TweenHandle | null = null;
  private stopHandle: TweenHandle | null = null;

  constructor(
    private readonly textures: Record<SymbolId, Texture>,
    private readonly tweens: Tweens,
    /** Used only for the blurry filler symbols while spinning. */
    private readonly strip: readonly SymbolId[],
    initial: readonly SymbolId[],
  ) {
    this.target = initial;
    for (let i = 0; i < COUNT; i++) {
      const sprite = new Sprite(this.randomTexture());
      sprite.anchor.set(0.5);
      sprite.x = SYMBOL_SIZE / 2;
      this.sprites.push(sprite);
      this.cycles.push(0);
      this.view.addChild(sprite);
    }
    this.settle();
  }

  get isIdle(): boolean {
    return this.phase === 'idle';
  }

  /** Sprite currently showing a given row. Valid when the reel is idle. */
  spriteAt(row: number): Sprite {
    const sprite = this.rowSprites[row];
    if (!sprite) throw new Error(`No sprite for row ${row}`);
    return sprite;
  }

  startSpin(): void {
    this.phase = 'spinning';
    this.slammed = false;
    this.velocity = 0;
  }

  /** Lands on `target` (top to bottom). Resolves when the reel is at rest. */
  async stop(target: readonly SymbolId[], timing: StopTiming): Promise<void> {
    this.target = target;

    this.delayHandle = this.tweens.wait(this.slammed ? 0 : timing.delay);
    await this.delayHandle.done;
    this.delayHandle = null;

    this.phase = 'stopping';
    const start = this.position;
    this.finalPosition = Math.ceil(start) + COUNT;
    this.stopHandle = this.tweens.add({
      duration: this.slammed ? SLAM_DURATION : timing.duration,
      ease: ease.outBack,
      onUpdate: (t) => {
        this.position = start + (this.finalPosition - start) * t;
      },
    });
    await this.stopHandle.done;
    this.stopHandle = null;

    this.settle();
    this.phase = 'idle';
  }

  /** Player hit stop: skip the remaining delay and land quickly. */
  slam(): void {
    this.slammed = true;
    this.delayHandle?.finish();
    this.stopHandle?.finish();
  }

  update(deltaMs: number): void {
    if (this.phase === 'spinning') {
      this.velocity = Math.min(MAX_SPEED, this.velocity + ACCELERATION * deltaMs);
      this.position += this.velocity * deltaMs;
    }
    if (this.phase !== 'idle') this.layout();
  }

  private layout(): void {
    this.sprites.forEach((sprite, i) => {
      const p = this.position + i;
      const cycle = Math.floor(p / COUNT);
      if (cycle !== this.cycles[i]) {
        this.cycles[i] = cycle;
        sprite.texture = this.textureOnWrap(i);
      }
      const slot = p - cycle * COUNT;
      sprite.y = rowCenterY(slot - 1);
    });
  }

  private textureOnWrap(index: number): Texture {
    if (this.phase === 'stopping') {
      const symbol = this.targetSymbol(this.finalRow(index));
      if (symbol !== undefined) return this.textures[symbol];
    }
    return this.randomTexture();
  }

  private finalRow(index: number): number {
    return mod(this.finalPosition + index, COUNT) - 1;
  }

  /** Target symbol for a visible row; undefined for the hidden wrap row. */
  private targetSymbol(row: number): SymbolId | undefined {
    return row >= 0 ? this.target[row] : undefined;
  }

  /**
   * Snaps to the exact final layout. Also makes a slam (which may skip some
   * wraps) always end on the right symbols.
   */
  private settle(): void {
    // Keep the float small so it never loses precision over a long session.
    this.finalPosition = mod(this.finalPosition, COUNT);
    this.position = this.finalPosition;
    this.sprites.forEach((sprite, i) => {
      const row = this.finalRow(i);
      const symbol = this.targetSymbol(row);
      if (symbol !== undefined) {
        sprite.texture = this.textures[symbol];
        this.rowSprites[row] = sprite;
      }
      this.cycles[i] = Math.floor((this.position + i) / COUNT);
      sprite.y = rowCenterY(row);
    });
  }

  private randomTexture(): Texture {
    // Visual only: filler symbols never affect the outcome.
    const symbol = this.strip[Math.floor(Math.random() * this.strip.length)]!;
    return this.textures[symbol];
  }
}
