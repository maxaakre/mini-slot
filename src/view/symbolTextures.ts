import { Container, Graphics, Rectangle, Text, type Renderer, type Texture } from 'pixi.js';
import { Sym, SYMBOL_NAMES, type SymbolId } from '../math/config';
import { DISPLAY_FONT } from './textStyle';

export const SYMBOL_SIZE = 140;

interface SymbolStyle {
  background: number;
  accent: number;
  draw?: (g: Graphics, c: number) => void;
}

const HALF = SYMBOL_SIZE / 2;

const STYLES: Record<SymbolId, SymbolStyle> = {
  [Sym.J]: { background: 0x1f3a5f, accent: 0x7fb3ff },
  [Sym.Q]: { background: 0x3a1f5f, accent: 0xc59bff },
  [Sym.K]: { background: 0x1f5f4a, accent: 0x7fffd0 },
  [Sym.A]: { background: 0x5f3a1f, accent: 0xffc27f },
  [Sym.ORB]: {
    background: 0x10242e,
    accent: 0x3ad6ff,
    draw: (g, c) => g.circle(HALF, HALF, 40).fill(c).circle(HALF - 12, HALF - 14, 12).fill({ color: 0xffffff, alpha: 0.6 }),
  },
  [Sym.GEM]: {
    background: 0x2e1024,
    accent: 0xff4fa3,
    draw: (g, c) =>
      g
        .poly([HALF, 22, HALF + 42, HALF - 8, HALF, SYMBOL_SIZE - 22, HALF - 42, HALF - 8])
        .fill(c)
        .poly([HALF, 22, HALF + 42, HALF - 8, HALF - 42, HALF - 8])
        .fill({ color: 0xffffff, alpha: 0.35 }),
  },
  [Sym.STAR]: {
    background: 0x2e2410,
    accent: 0xffd23a,
    draw: (g, c) => g.star(HALF, HALF + 4, 5, 48, 22).fill(c).stroke({ width: 4, color: 0xfff3c0 }),
  },
  [Sym.WILD]: { background: 0x5a4200, accent: 0xffe066 },
  [Sym.SCATTER]: {
    background: 0x3b0a3b,
    accent: 0xff7bff,
    draw: (g, c) => g.star(HALF, HALF - 10, 8, 40, 26).fill({ color: c, alpha: 0.9 }),
  },
};

function drawSymbol(id: SymbolId): Container {
  const style = STYLES[id];
  const root = new Container();

  const tile = new Graphics()
    .roundRect(6, 6, SYMBOL_SIZE - 12, SYMBOL_SIZE - 12, 18)
    .fill(style.background)
    .stroke({ width: 3, color: style.accent, alpha: 0.8 });
  root.addChild(tile);

  if (style.draw) {
    const art = new Graphics();
    style.draw(art, style.accent);
    root.addChild(art);
  }

  // Letters for the low symbols, labels for the specials.
  const isLow = id <= Sym.A;
  const isSpecial = id === Sym.WILD || id === Sym.SCATTER;
  if (isLow || isSpecial) {
    const label = new Text({
      text: SYMBOL_NAMES[id].toUpperCase(),
      style: {
        ...DISPLAY_FONT,
        fontSize: isLow ? 72 : 30,
        fill: isLow ? style.accent : 0xffffff,
        stroke: { color: 0x000000, width: 5 },
        letterSpacing: isSpecial ? 2 : 0,
      },
    });
    label.anchor.set(0.5);
    label.position.set(HALF, id === Sym.SCATTER ? SYMBOL_SIZE - 30 : HALF);
    root.addChild(label);
  }

  return root;
}

/**
 * Renders each symbol once into a texture. Reels then use plain sprites,
 * which batch into very few draw calls — Graphics and Text on every cell
 * would not.
 */
export function createSymbolTextures(renderer: Renderer): Record<SymbolId, Texture> {
  const textures = {} as Record<SymbolId, Texture>;
  for (const id of Object.values(Sym)) {
    const art = drawSymbol(id);
    // Fixed frame so every symbol texture is exactly one cell, whatever its art.
    const frame = new Rectangle(0, 0, SYMBOL_SIZE, SYMBOL_SIZE);
    textures[id] = renderer.generateTexture({ target: art, frame, resolution: 2, antialias: true });
    art.destroy({ children: true });
  }
  return textures;
}

/** Small soft dot used by the particle pool. */
export function createParticleTexture(renderer: Renderer): Texture {
  const g = new Graphics().circle(8, 8, 8).fill({ color: 0xffffff, alpha: 0.35 }).circle(8, 8, 4).fill(0xffffff);
  const texture = renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return texture;
}
