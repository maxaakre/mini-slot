import { Application, Container } from 'pixi.js';
import { GameController } from './game/GameController';
import { BASE_STRIPS } from './math/config';
import { gridFromStops } from './math/engine';
import { MockServer } from './server/mockServer';
import { Hud } from './ui/hud';
import { mountPerfOverlay } from './ui/perfOverlay';
import { ParticlePool } from './view/ParticlePool';
import { BOARD_HEIGHT, BOARD_WIDTH, ReelSet } from './view/ReelSet';
import { createParticleTexture, createSymbolTextures } from './view/symbolTextures';
import { Tweens } from './view/tween';
import { WinPresenter } from './view/WinPresenter';
import './styles.css';

/**
 * Debug knobs, all via the URL:
 *   ?seed=42      replay the exact same session
 *   ?fail=0.3     lose 30% of server responses (retries kick in)
 *   ?latency=800  slower server
 *   ?balance=500  start balance in cents
 *   ?perf         show the perf overlay (or press P)
 *   ?debug        expose window.__debug in production builds
 */
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? Math.floor(Math.random() * 1e9));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Largest frame step we simulate, so a background tab does not jump. */
const MAX_DELTA_MS = 50;
const BOARD_PADDING = 48;

async function start(): Promise<void> {
  const stage = document.getElementById('stage')!;

  const app = new Application();
  await app.init({
    resizeTo: stage,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    // Retina is sharp enough at 2x; 3x phones would pay 2.25x the pixels for little gain.
    resolution: Math.min(window.devicePixelRatio, 2),
  });
  stage.appendChild(app.canvas);

  const server = new MockServer({
    seed,
    balance: Number(params.get('balance') ?? 100_000),
    latencyMs: Number(params.get('latency') ?? 250),
    failureRate: Number(params.get('fail') ?? 0),
  });

  const tweens = new Tweens();
  const textures = createSymbolTextures(app.renderer);
  const initialGrid = gridFromStops([0, 5, 10, 15, 20], BASE_STRIPS);
  const reels = new ReelSet(textures, tweens, BASE_STRIPS, initialGrid);
  const particles = new ParticlePool(createParticleTexture(app.renderer));
  const presenter = new WinPresenter(reels, particles, tweens);

  const board = new Container();
  board.addChild(reels.view, presenter.view, particles.view);
  app.stage.addChild(board);

  const layout = () => {
    const { width, height } = app.screen;
    const scale = Math.min(width / (BOARD_WIDTH + BOARD_PADDING * 2), height / (BOARD_HEIGHT + BOARD_PADDING * 2));
    board.scale.set(scale);
    board.position.set((width - BOARD_WIDTH * scale) / 2, (height - BOARD_HEIGHT * scale) / 2);
  };
  app.renderer.on('resize', layout);
  layout();

  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS, MAX_DELTA_MS);
    tweens.update(dt);
    reels.update(dt);
    particles.update(dt);
  });

  const turbo = reducedMotion;
  let controller: GameController;
  const hud = new Hud(
    {
      onSpin: () => controller.press(),
      onBetChange: (direction) => controller.changeBet(direction),
      onTurboChange: (on) => controller.setTurbo(on),
      onBuyBonus: () => void controller.buyBonus(),
    },
    turbo,
  );

  controller = new GameController({
    api: server,
    getSession: () => server.getSession(),
    reels,
    presenter,
    hud,
    tweens,
    initialGrid,
    turbo,
    reducedMotion,
  });

  mountPerfOverlay(
    app,
    { particles: () => particles.stats, tweens: () => tweens.count },
    params.has('perf'),
  );

  document.getElementById('seed')!.textContent = `seed ${seed}`;

  // Lets automated tests compare the HUD with the server's truth.
  if (import.meta.env.DEV || params.has('debug')) {
    Object.assign(window, { __debug: { server, controller } });
  }
}

start().catch((error) => {
  console.error(error);
  document.body.dataset.failed = 'true';
});
