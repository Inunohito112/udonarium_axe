import { DieLabels } from '@axe/domain/dice/dice-3d/dice-throw-plan';
import { DieShape, polyhedronOf } from '@axe/domain/dice/dice-3d/polyhedra';
import { atlasOf } from '@axe/infrastructure/dice-3d/dice-geometry';
import { FaceGlyph, faceGlyphsOf } from '@axe/infrastructure/dice-3d/dice-glyphs';
import { NUMERAL_GAP, NUMERAL_HEIGHT, NUMERALS } from '@axe/infrastructure/dice-3d/dice-numerals';

/** The colours of a die: its body, the ink in its numbers, and the accent of a d6's one pip. */
export interface DiceLook {
  readonly body: string;
  readonly ink: string;
  readonly accent: string;
}

/** The pictures a die is drawn with: its colours, and the dents of its engraving as normals. */
export interface DiceAtlas {
  readonly color: HTMLCanvasElement;
  readonly normal: HTMLCanvasElement;
}

/** The size of one face's cell, in texture pixels. */
export const CELL_PX = 256;

const DARK_INK = '#161616';
const LIGHT_INK = '#f6f3ec';
const ACCENT = '#c8102e';
/** How deep the engraving reads under the light. */
const ENGRAVE_STRENGTH = 2.6;
const BLUR_RADIUS = 2;

/**
 * The colours of a die of a given body colour: ink that stands out from it, light on a dark body and
 * dark on a light one, and a red one pip unless the body is red itself.
 */
export function lookFor(body: string): DiceLook {
  const rgb = parseColor(body) ?? [32, 32, 36];
  const lightness = (0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])) ** (1 / 2.2);
  const ink = lightness > 0.55 ? DARK_INK : LIGHT_INK;
  const [r, g, b] = rgb;
  const reddish = r > 140 && r > g * 1.6 && r > b * 1.6;
  return { body: rgbText(rgb), ink, accent: reddish ? ink : ACCENT };
}

/**
 * Draws the texture of a die: every face's cell in the body's colour with its marks in the ink,
 * and beside it the normals of the same marks cut into the face, so they catch the light as
 * engraving does.
 */
export function drawDiceAtlas(shape: DieShape, labels: DieLabels, look: DiceLook): DiceAtlas {
  const atlas = atlasOf(shape);
  const width = atlas.columns * CELL_PX;
  const height = atlas.rows * CELL_PX;
  const color = canvasOf(width, height);
  const depth = canvasOf(width, height);
  const paint = color.getContext('2d')!;
  const carve = depth.getContext('2d')!;
  paint.fillStyle = look.body;
  paint.fillRect(0, 0, width, height);
  carve.fillStyle = '#000';
  carve.fillRect(0, 0, width, height);

  const faces = polyhedronOf(shape).faces.length;
  for (let face = 0; face < faces; face++) {
    const left = (face % atlas.columns) * CELL_PX;
    const top = Math.floor(face / atlas.columns) * CELL_PX;
    for (const glyph of faceGlyphsOf(shape, labels, face)) {
      drawGlyph(paint, glyph, left, top, glyph.accent ? look.accent : look.ink);
      drawGlyph(carve, glyph, left, top, '#fff');
    }
  }

  const normal = canvasOf(width, height);
  normalsFromDepth(carve.getImageData(0, 0, width, height), normal.getContext('2d')!);
  return { color, normal };
}

function drawGlyph(ctx: CanvasRenderingContext2D, glyph: FaceGlyph, left: number, top: number, fill: string): void {
  const x = left + glyph.x * CELL_PX;
  const y = top + (1 - glyph.y) * CELL_PX;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-glyph.rotation);
  ctx.fillStyle = fill;
  if (glyph.kind === 'pip') {
    const radius = (glyph.size * CELL_PX) / 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  // Set by the figures' own ink, so the number sits in the middle of the face.
  const figures = [...glyph.text].map((figure) => NUMERALS[figure]).filter(Boolean);
  const width =
    figures.reduce((sum, figure) => sum + figure.right - figure.left, 0) + NUMERAL_GAP * (figures.length - 1);
  const scale = (glyph.size * CELL_PX) / NUMERAL_HEIGHT;
  ctx.scale(scale, scale);
  ctx.translate(-width / 2, NUMERAL_HEIGHT / 2);
  let pen = 0;
  for (const figure of figures) {
    ctx.save();
    ctx.translate(pen - figure.left, 0);
    ctx.fill(new Path2D(figure.outline));
    ctx.restore();
    pen += figure.right - figure.left + NUMERAL_GAP;
  }
  if (glyph.underline) {
    const line = Math.max(width * 0.8, NUMERAL_HEIGHT * 0.45);
    ctx.fillRect((width - line) / 2, NUMERAL_HEIGHT * 0.12, line, NUMERAL_HEIGHT * 0.09);
  }
  ctx.restore();
}

/**
 * Turns the marks into the normals of a surface they are cut into: blurred a little for a soft
 * edge to the cut, then each pixel tilted down the slope of its neighbours.
 */
function normalsFromDepth(depth: ImageData, out: CanvasRenderingContext2D): void {
  const { width, height } = depth;
  const heights = boxBlur(redChannel(depth), width, height, BLUR_RADIUS);
  const image = out.createImageData(width, height);
  const at = (x: number, y: number) =>
    heights[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Cut in, so the surface falls where the marks are: its slope across is their rise across,
      // and up the texture, which runs against the rows, is their fall down the rows.
      const dx = ((at(x + 1, y) - at(x - 1, y)) / 2) * ENGRAVE_STRENGTH;
      const dy = (-(at(x, y + 1) - at(x, y - 1)) / 2) * ENGRAVE_STRENGTH;
      const length = Math.hypot(dx, dy, 1);
      const i = (y * width + x) * 4;
      image.data[i] = Math.round(((dx / length) * 0.5 + 0.5) * 255);
      image.data[i + 1] = Math.round(((dy / length) * 0.5 + 0.5) * 255);
      image.data[i + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
      image.data[i + 3] = 255;
    }
  }
  out.putImageData(image, 0, 0);
}

function redChannel(image: ImageData): Float32Array {
  const values = new Float32Array(image.width * image.height);
  for (let i = 0; i < values.length; i++) values[i] = image.data[i * 4] / 255;
  return values;
}

/** A blur by two passes of a running box, across and then down. */
function boxBlur(values: Float32Array, width: number, height: number, radius: number): Float32Array {
  const across = new Float32Array(values.length);
  const down = new Float32Array(values.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += values[y * width + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      across[y * width + x] = sum / span;
      sum += values[y * width + Math.min(width - 1, x + radius + 1)] - values[y * width + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += across[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) {
      down[y * width + x] = sum / span;
      sum += across[Math.min(height - 1, y + radius + 1) * width + x] - across[Math.max(0, y - radius) * width + x];
    }
  }
  return down;
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function parseColor(text: string): [number, number, number] | null {
  const hex = text.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = text.trim().match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgbText([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}
