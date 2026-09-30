import type { Application } from 'pixi.js';

export interface PerfSource {
  particles: () => { live: number; free: number };
  rain: () => { live: number; free: number };
  tweens: () => number;
}

/**
 * Small live stats panel. Toggle with "P" or open with ?perf.
 * Worst frame time matters more than average FPS: one 60 ms hitch is what
 * players notice, even at "60 fps".
 */
export function mountPerfOverlay(app: Application, source: PerfSource, visible: boolean): void {
  const panel = document.createElement('pre');
  panel.className = 'perf';
  panel.hidden = !visible;
  document.body.appendChild(panel);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'p' || event.key === 'P') panel.hidden = !panel.hidden;
  });

  let worst = 0;
  app.ticker.add((ticker) => {
    worst = Math.max(worst, ticker.deltaMS);
  });

  const render = () => {
    if (panel.hidden) return;
    const { live, free } = source.particles();
    const renderer = app.renderer;
    panel.textContent = [
      `FPS        ${app.ticker.FPS.toFixed(0)}`,
      `worst ms   ${worst.toFixed(1)}`,
      `renderer   ${renderer.name}`,
      `resolution ${renderer.resolution}`,
      `particles  ${live} live / ${free} pooled`,
      `rain       ${source.rain().live} live / ${source.rain().free} pooled`,
      `tweens     ${source.tweens()}`,
    ].join('\n');
    worst = 0;
  };
  render();
  setInterval(render, 500);
}
