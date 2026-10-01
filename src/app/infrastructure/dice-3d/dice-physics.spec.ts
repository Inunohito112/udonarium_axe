import { correctionFor, upFace } from '@axe/domain/dice/dice-3d/die-symmetry';
import { DIE_SHAPES, DieShape, polyhedronOf } from '@axe/domain/dice/dice-3d/polyhedra';
import { Quat, quatMultiply } from '@axe/domain/dice/dice-3d/rotation';
import { trayFor } from '@axe/domain/dice/dice-3d/tray-size';
import { simulateThrow } from '@axe/infrastructure/dice-3d/dice-physics';
import { DiceThrowResult, FRAME_STRIDE } from '@axe/infrastructure/dice-3d/dice-physics-message';

function lastRotation(result: DiceThrowResult, die: number, count: number): Quat {
  const at = ((result.frameCount - 1) * count + die) * FRAME_STRIDE;
  return [result.frames[at + 3], result.frames[at + 4], result.frames[at + 5], result.frames[at + 6]];
}

function lastPosition(result: DiceThrowResult, die: number, count: number): [number, number, number] {
  const at = ((result.frameCount - 1) * count + die) * FRAME_STRIDE;
  return [result.frames[at], result.frames[at + 1], result.frames[at + 2]];
}

describe('simulateThrow', () => {
  const tray = trayFor(3, 2);

  it('throws the same way every time for the same roll', () => {
    const request = { key: 'same-roll', shapes: ['d20', 'd6'] as DieShape[], tray, edge: 'left' as const };
    const a = simulateThrow(request);
    const b = simulateThrow(request);
    expect(b.frameCount).toBe(a.frameCount);
    expect(Array.from(b.frames)).toEqual(Array.from(a.frames));
    expect(b.landed).toEqual(a.landed);
  });

  it('throws another roll another way', () => {
    const a = simulateThrow({ key: 'roll-a', shapes: ['d20'], tray, edge: 'left' });
    const b = simulateThrow({ key: 'roll-b', shapes: ['d20'], tray, edge: 'left' });
    expect(Array.from(b.frames.slice(0, 70))).not.toEqual(Array.from(a.frames.slice(0, 70)));
  });

  for (const shape of DIE_SHAPES) {
    it(`lands a ${shape} cleanly in the tray and brings it round to any number it has to show`, () => {
      const poly = polyhedronOf(shape);
      const count = poly.readsCorners ? poly.vertices.length : poly.faces.length;
      for (let seed = 0; seed < 4; seed++) {
        const shapes = [shape, shape];
        const result = simulateThrow({ key: `${shape}-${seed}`, shapes, tray, edge: seed % 2 ? 'right' : 'left' });

        expect(result.fault).toBeNull();
        expect(result.restFrame).toBeLessThan(result.frameCount);
        shapes.forEach((_, die) => {
          const rest = lastRotation(result, die, shapes.length);
          const [x, y] = lastPosition(result, die, shapes.length);
          expect(Math.abs(x)).toBeLessThan(tray.halfWidth);
          expect(Math.abs(y)).toBeLessThan(tray.halfDepth);
          expect(upFace(poly, rest)).toBe(result.landed[die]);
          for (let target = 0; target < count; target++) {
            const shown = quatMultiply(rest, correctionFor(poly, result.landed[die], target));
            expect(upFace(poly, shown)).toBe(target);
          }
        });
      }
    });
  }

  it('lands twenty dice apart, given the room the tray gives so many', () => {
    const shapes = Array<DieShape>(20).fill('d6');
    const result = simulateThrow({ key: 'twenty', shapes, tray: trayFor(20, 2), edge: 'near' });

    expect(result.fault).toBeNull();
    expect(result.landed).toHaveLength(20);
  });

  it('records seven numbers for every die in every frame', () => {
    const result = simulateThrow({ key: 'stride', shapes: ['d8', 'd12', 'd4'], tray, edge: 'near' });

    expect(result.frames).toHaveLength(result.frameCount * 3 * FRAME_STRIDE);
    expect(Array.from(result.frames).every(Number.isFinite)).toBe(true);
  });
});
