import { Container, Sprite, type Texture } from 'pixi.js';

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

const GRAVITY = 0.0012; // px per ms²

/**
 * Fixed-size particle pool. All sprites are created up front and reused,
 * so a big win never triggers allocations or GC pauses mid-animation.
 * When the pool is empty, new particles are simply skipped.
 */
export class ParticlePool {
  readonly view = new Container();
  private readonly free: Sprite[] = [];
  private readonly live: Particle[] = [];

  constructor(texture: Texture, readonly capacity = 400) {
    for (let i = 0; i < capacity; i++) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      sprite.blendMode = 'add';
      this.view.addChild(sprite);
      this.free.push(sprite);
    }
  }

  burst(x: number, y: number, count: number, tint: number): void {
    for (let i = 0; i < count; i++) {
      const sprite = this.free.pop();
      if (!sprite) return;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.15 + Math.random() * 0.45;
      sprite.position.set(x, y);
      sprite.tint = tint;
      sprite.alpha = 1;
      sprite.scale.set(0.6 + Math.random() * 0.8);
      sprite.visible = true;
      const maxLife = 600 + Math.random() * 700;
      this.live.push({
        sprite,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.35,
        life: maxLife,
        maxLife,
      });
    }
  }

  update(deltaMs: number): void {
    // Iterate backwards so swap-remove is safe.
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      p.life -= deltaMs;
      if (p.life <= 0) {
        p.sprite.visible = false;
        this.free.push(p.sprite);
        this.live[i] = this.live[this.live.length - 1]!;
        this.live.pop();
        continue;
      }
      p.vy += GRAVITY * deltaMs;
      p.sprite.x += p.vx * deltaMs;
      p.sprite.y += p.vy * deltaMs;
      p.sprite.alpha = p.life / p.maxLife;
    }
  }

  get stats(): { live: number; free: number } {
    return { live: this.live.length, free: this.free.length };
  }
}
