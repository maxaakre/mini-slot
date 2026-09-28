import { Container, Graphics, Text } from 'pixi.js';
import type { PresentOptions, PresenterPort } from '../game/ports';
import { PAYLINES, SCATTER_MIN_COUNT } from '../math/config';
import { isBigWin, type Position, type SpinOutcome } from '../math/engine';
import type { ParticlePool } from './ParticlePool';
import { BOARD_HEIGHT, BOARD_WIDTH, type ReelSet } from './ReelSet';
import { DISPLAY_FONT } from './textStyle';
import { ease, type TweenHandle, type Tweens } from './tween';

const LINE_COLORS = [0xffd23a, 0x3ad6ff, 0xff4fa3, 0x7fffd0, 0xffa53a, 0xc59bff, 0x7fb3ff, 0xff7b7b, 0xb4ff7f, 0xffffff];

export class WinPresenter implements PresenterPort {
  readonly view = new Container();
  private readonly lines = new Graphics();
  private readonly banner: Text;
  private handles: TweenHandle[] = [];

  constructor(
    private readonly reels: ReelSet,
    private readonly particles: ParticlePool,
    private readonly tweens: Tweens,
  ) {
    this.banner = new Text({
      text: 'BIG WIN',
      style: {
        ...DISPLAY_FONT,
        fontSize: 96,
        fill: 0xffe066,
        stroke: { color: 0x5a2a00, width: 10 },
        dropShadow: { color: 0x000000, blur: 12, distance: 0, alpha: 0.8 },
      },
    });
    this.banner.anchor.set(0.5);
    this.banner.position.set(BOARD_WIDTH / 2, BOARD_HEIGHT / 2);
    this.banner.visible = false;
    this.view.addChild(this.lines, this.banner);
  }

  async present(outcome: SpinOutcome, options: PresentOptions): Promise<void> {
    if (outcome.totalWin === 0 && outcome.freeSpinsAwarded === 0) return;

    const positions: Position[] = outcome.lineWins.flatMap((w) => w.positions);
    if (outcome.scatterPositions.length >= SCATTER_MIN_COUNT) positions.push(...outcome.scatterPositions);
    this.reels.highlight(positions);
    this.drawLines(outcome);

    const big = isBigWin(outcome.totalWin, options.bet);
    if (!options.reducedMotion) {
      const perCell = big ? 18 : 6;
      for (const [reel, row] of positions) {
        const { x, y } = this.reels.cellCenter(reel, row);
        this.particles.burst(x, y, perCell, big ? 0xffe066 : 0xffffff);
      }
    }

    const duration = options.turbo ? 700 : big ? 2600 : 1400;
    const counter = this.tweens.add({
      duration: duration * 0.8,
      ease: ease.outCubic,
      onUpdate: (t) => options.onCount(Math.round(outcome.totalWin * t)),
    });
    this.handles.push(counter);
    if (big) this.handles.push(this.showBanner(duration));

    const hold = this.tweens.wait(duration);
    this.handles.push(hold);
    await hold.done;

    this.skip();
    this.lines.clear();
  }

  /** Jumps every running animation to its end. */
  skip(): void {
    const handles = this.handles;
    this.handles = [];
    for (const handle of handles) handle.finish();
  }

  private showBanner(duration: number): TweenHandle {
    this.banner.visible = true;
    const handle = this.tweens.add({
      duration,
      onUpdate: (t) => {
        // Pop in, hold, fade out.
        const pop = Math.min(1, t * 6);
        this.banner.scale.set(0.3 + 0.7 * ease.outBack(pop));
        this.banner.alpha = t > 0.85 ? (1 - t) / 0.15 : 1;
      },
    });
    handle.done.then(() => (this.banner.visible = false));
    return handle;
  }

  private drawLines(outcome: SpinOutcome): void {
    this.lines.clear();
    for (const win of outcome.lineWins) {
      const rows = PAYLINES[win.line]!;
      rows.forEach((row, reel) => {
        const { x, y } = this.reels.cellCenter(reel, row);
        if (reel === 0) this.lines.moveTo(x - 60, y);
        this.lines.lineTo(x, y);
        if (reel === rows.length - 1) this.lines.lineTo(x + 60, y);
      });
      this.lines.stroke({ width: 6, color: LINE_COLORS[win.line % LINE_COLORS.length]!, alpha: 0.85, cap: 'round', join: 'round' });
    }
  }
}
