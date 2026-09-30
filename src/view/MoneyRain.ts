import { Container, Sprite, type Texture } from 'pixi.js';

interface Drop {
  sprite: Sprite;
  vx: number;
  vy: number;
  spin: number;
  /** Phase of the flip (coins) or flutter (bills). */
  phase: number;
  isBill: boolean;
}

export interface MoneyTextures {
  coin: Texture;
  bill: Texture;
}

/** Share of drops that are bills instead of coins. */
const BILL_SHARE = 0.3;

/**
 * Coins and bills falling over the whole screen on a win.
 * Pooled like `ParticlePool`: every sprite exists up front, so heavy rain
 * never allocates. When the pool is empty, new drops are skipped.
 */
export class MoneyRain {
  readonly view = new Container();
  private readonly free: Sprite[] = [];
  private readonly live: Drop[] = [];
  private width = 0;
  private height = 0;
  private scale = 1;
  /** Drops still to spawn in the current rain. */
  private pending = 0;
  /** Drops per ms. */
  private rate = 0;
  private carry = 0;

  constructor(
    private readonly textures: MoneyTextures,
    readonly capacity = 160,
  ) {
    for (let i = 0; i < capacity; i++) {
      const sprite = new Sprite(textures.coin);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.view.addChild(sprite);
      this.free.push(sprite);
    }
  }

  /** Screen size, and the board scale so drops match the symbols' size. */
  resize(width: number, height: number, scale: number): void {
    this.width = width;
    this.height = height;
    this.scale = scale;
  }

  /** Spawns `count` drops spread over `durationMs`. */
  start(count: number, durationMs: number): void {
    this.pending = count;
    this.rate = count / Math.max(1, durationMs);
    this.carry = 0;
  }

  /** Stops spawning. Drops already in the air fall out on their own. */
  stop(): void {
    this.pending = 0;
  }

  update(deltaMs: number): void {
    if (this.pending > 0) {
      this.carry += this.rate * deltaMs;
      while (this.carry >= 1 && this.pending > 0) {
        this.carry -= 1;
        this.pending -= 1;
        this.spawn();
      }
    }

    // Iterate backwards so swap-remove is safe.
    for (let i = this.live.length - 1; i >= 0; i--) {
      const drop = this.live[i]!;
      const { sprite } = drop;
      if (sprite.y > this.height + 80 * this.scale) {
        sprite.visible = false;
        this.free.push(sprite);
        this.live[i] = this.live[this.live.length - 1]!;
        this.live.pop();
        continue;
      }
      drop.phase += deltaMs * 0.012;
      sprite.x += (drop.vx + (drop.isBill ? Math.sin(drop.phase) * 0.12 : 0)) * this.scale * deltaMs;
      sprite.y += drop.vy * this.scale * deltaMs;
      sprite.rotation += drop.spin * deltaMs;
      // Squash one axis to fake a 3D flip (coins) or a flutter (bills).
      const base = sprite.scale.y;
      sprite.scale.x = base * (drop.isBill ? 1 : Math.cos(drop.phase));
    }
  }

  get stats(): { live: number; free: number } {
    return { live: this.live.length, free: this.free.length };
  }

  private spawn(): void {
    const sprite = this.free.pop();
    if (!sprite) return;
    const isBill = Math.random() < BILL_SHARE;
    sprite.texture = isBill ? this.textures.bill : this.textures.coin;
    const size = this.scale * (0.7 + Math.random() * 0.5);
    sprite.scale.set(size);
    sprite.position.set(Math.random() * this.width, -60 * this.scale);
    sprite.rotation = Math.random() * Math.PI * 2;
    sprite.visible = true;
    this.live.push({
      sprite,
      vx: (Math.random() - 0.5) * 0.08,
      // Bills fall slower than coins, like paper.
      vy: isBill ? 0.25 + Math.random() * 0.15 : 0.45 + Math.random() * 0.3,
      spin: (Math.random() - 0.5) * (isBill ? 0.004 : 0.008),
      phase: Math.random() * Math.PI * 2,
      isBill,
    });
  }
}
