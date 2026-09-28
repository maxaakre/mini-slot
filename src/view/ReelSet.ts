import { Container, Graphics, type Sprite, type Texture } from 'pixi.js';
import { REELS, ROWS, Sym, type ReelSet as Strips, type SymbolId } from '../math/config';
import type { Grid, Position } from '../math/engine';
import type { ReelsPort } from '../game/ports';
import { Reel, rowCenterY } from './Reel';
import { SYMBOL_SIZE } from './symbolTextures';
import { ease, type TweenHandle, type Tweens } from './tween';

export const REEL_GAP = 10;
export const BOARD_WIDTH = REELS * SYMBOL_SIZE + (REELS - 1) * REEL_GAP;
export const BOARD_HEIGHT = ROWS * SYMBOL_SIZE;

/** Extra wait on the remaining reels when a bonus is one scatter away. */
const ANTICIPATION_MS = 900;

/** Left edge of a reel, in board coordinates. */
const reelX = (reel: number) => reel * (SYMBOL_SIZE + REEL_GAP);

export class ReelSet implements ReelsPort {
  readonly view = new Container();
  private readonly reels: Reel[];
  private readonly frame = new Graphics();
  private pulses: TweenHandle[] = [];

  constructor(
    textures: Record<SymbolId, Texture>,
    private readonly tweens: Tweens,
    strips: Strips,
    initial: Grid,
  ) {
    this.drawFrame(false);
    this.view.addChild(this.frame);

    const reelLayer = new Container();
    this.reels = strips.map((strip, i) => {
      const reel = new Reel(textures, tweens, strip, initial[i]!);
      reel.view.x = reelX(i);
      reelLayer.addChild(reel.view);
      return reel;
    });

    // One mask for the whole board hides the wrapping row above and below.
    const mask = new Graphics().rect(0, 0, BOARD_WIDTH, BOARD_HEIGHT).fill(0xffffff);
    reelLayer.mask = mask;
    this.view.addChild(reelLayer, mask);
  }

  /** Gold frame during free spins, so the mode change is obvious. */
  setFreeSpins(on: boolean): void {
    this.drawFrame(on);
  }

  private drawFrame(freeSpins: boolean): void {
    this.frame
      .clear()
      .roundRect(-16, -16, BOARD_WIDTH + 32, BOARD_HEIGHT + 32, 24)
      .fill({ color: freeSpins ? 0x1a1206 : 0x0b0f1a, alpha: 0.9 })
      .stroke({ width: freeSpins ? 5 : 3, color: freeSpins ? 0xffd23a : 0x3a4a6b });
  }

  update(deltaMs: number): void {
    for (const reel of this.reels) reel.update(deltaMs);
  }

  startSpin(): void {
    this.clearHighlight();
    for (const reel of this.reels) reel.startSpin();
  }

  /** Staggered stop. Adds suspense on the last reels when a bonus is close. */
  async stopOn(grid: Grid, { turbo }: { turbo: boolean }): Promise<void> {
    let delay = 0;
    let scatters = 0;
    const stops = this.reels.map((reel, i) => {
      const column = grid[i]!;
      const anticipate = !turbo && scatters >= 2;
      delay += i === 0 ? 0 : turbo ? 40 : anticipate ? ANTICIPATION_MS : 160;
      scatters += column.filter((s) => s === Sym.SCATTER).length;
      return reel.stop(column, { delay, duration: turbo ? 260 : 520 });
    });
    await Promise.all(stops);
  }

  slam(): void {
    for (const reel of this.reels) reel.slam();
  }

  /** Centre of a cell, in board coordinates. */
  cellCenter(reel: number, row: number): { x: number; y: number } {
    return { x: reelX(reel) + SYMBOL_SIZE / 2, y: rowCenterY(row) };
  }

  /** Dims every cell except the winners, and pulses the winners. */
  highlight(positions: readonly Position[]): void {
    const winners = new Set(positions.map(([reel, row]) => `${reel}:${row}`));
    this.forEachCell((sprite, reel, row) => {
      sprite.alpha = winners.has(`${reel}:${row}`) ? 1 : 0.3;
    });
    for (const [reel, row] of positions) {
      const sprite = this.reels[reel]!.spriteAt(row);
      const pulse = this.tweens.add({
        duration: 700,
        ease: ease.linear,
        onUpdate: (t) => sprite.scale.set(1 + 0.12 * Math.sin(t * Math.PI)),
      });
      this.pulses.push(pulse);
    }
  }

  clearHighlight(): void {
    // Finish pulses first, so none keeps scaling a sprite into the next spin.
    const pulses = this.pulses;
    this.pulses = [];
    for (const pulse of pulses) pulse.finish();
    this.forEachCell((sprite) => {
      sprite.alpha = 1;
      sprite.scale.set(1);
    });
  }

  private forEachCell(fn: (sprite: Sprite, reel: number, row: number) => void): void {
    this.reels.forEach((reel, r) => {
      if (!reel.isIdle) return;
      for (let row = 0; row < ROWS; row++) fn(reel.spriteAt(row), r, row);
    });
  }
}
