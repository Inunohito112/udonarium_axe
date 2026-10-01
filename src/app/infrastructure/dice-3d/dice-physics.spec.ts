import { upFace } from '@axe/domain/dice/dice-3d/die-symmetry';
import { DIE_SHAPES, DieShape, polyhedronOf } from '@axe/domain/dice/dice-3d/polyhedra';
import { cross, dot, Quat, quatMultiply, quatRotate, UP, Vec3 } from '@axe/domain/dice/dice-3d/rotation';
import { trayFor } from '@axe/domain/dice/dice-3d/tray-size';
import { faceFramesOf } from '@axe/infrastructure/dice-3d/dice-geometry';
import { simulateThrow } from '@axe/infrastructure/dice-3d/dice-physics';
import { DiceThrowRequest, DiceThrowResult, FRAME_STRIDE } from '@axe/infrastructure/dice-3d/dice-physics-message';

function lastRotation(result: DiceThrowResult, die: number, count: number): Quat {
  const at = ((result.frameCount - 1) * count + die) * FRAME_STRIDE;
  return [result.frames[at + 3], result.frames[at + 4], result.frames[at + 5], result.frames[at + 6]];
}

function lastPosition(result: DiceThrowResult, die: number, count: number): [number, number, number] {
  const at = ((result.frameCount - 1) * count + die) * FRAME_STRIDE;
  return [result.frames[at], result.frames[at + 1], result.frames[at + 2]];
}

const away: Vec3 = [0, 1, 0];

function requestFor(key: string, shapes: DieShape[], extra: Partial<DiceThrowRequest> = {}): DiceThrowRequest {
  return { key, shapes, targets: shapes.map(() => 0), tray: trayFor(3, 2), edge: 'left', away, ...extra };
}

describe('simulateThrow', () => {
  const tray = trayFor(3, 2);

  it('throws the same way every time for the same roll', () => {
    const request = requestFor('same-roll', ['d20', 'd6']);
    const a = simulateThrow(request);
    const b = simulateThrow(request);
    expect(b.frameCount).toBe(a.frameCount);
    expect(Array.from(b.frames)).toEqual(Array.from(a.frames));
    expect(b.landed).toEqual(a.landed);
  });

  it('throws another roll another way', () => {
    const a = simulateThrow(requestFor('roll-a', ['d20']));
    const b = simulateThrow(requestFor('roll-b', ['d20']));
    expect(Array.from(b.frames.slice(0, 70))).not.toEqual(Array.from(a.frames.slice(0, 70)));
  });

  for (const shape of DIE_SHAPES) {
    it(`lands a ${shape} cleanly in the tray and brings it round to the number it has to show`, () => {
      const poly = polyhedronOf(shape);
      const count = poly.readsCorners ? poly.vertices.length : poly.faces.length;
      for (let seed = 0; seed < 4; seed++) {
        const shapes = [shape, shape];
        const targets = [seed % count, (seed * 3 + 1) % count];
        const edge = seed % 2 ? 'right' : 'left';
        const result = simulateThrow(requestFor(`${shape}-${seed}`, shapes, { targets, edge }));

        expect(result.fault).toBeNull();
        expect(result.restFrame).toBeLessThan(result.frameCount);
        shapes.forEach((_, die) => {
          const rest = lastRotation(result, die, shapes.length);
          const [x, y] = lastPosition(result, die, shapes.length);
          expect(Math.abs(x)).toBeLessThan(tray.halfWidth);
          expect(Math.abs(y)).toBeLessThan(tray.halfDepth);
          expect(upFace(poly, rest)).toBe(result.landed[die]);
          expect(upFace(poly, quatMultiply(rest, result.corrections[die]))).toBe(targets[die]);
        });
      }
    });
  }

  it('lands twenty dice apart, given the room the tray gives so many', () => {
    const shapes = Array<DieShape>(20).fill('d6');
    const result = simulateThrow(requestFor('twenty', shapes, { tray: trayFor(20, 2), edge: 'near' }));

    expect(result.fault).toBeNull();
    expect(result.landed).toHaveLength(20);
  });

  it('records seven numbers for every die in every frame', () => {
    const result = simulateThrow(requestFor('stride', ['d8', 'd12', 'd4'], { edge: 'near' }));

    expect(result.frames).toHaveLength(result.frameCount * 3 * FRAME_STRIDE);
    expect(Array.from(result.frames).every(Number.isFinite)).toBe(true);
  });

  it('throws a pair of d10 again rather than leave a number upside down to the viewer', () => {
    const tray = trayFor(2, 400 / 120);
    let upsideDown = 0;
    for (let seed = 0; seed < 12; seed++) {
      const targets = [seed % 10, (seed * 7) % 10];
      const result = simulateThrow(requestFor(`d100-${seed}`, ['d10', 'd10'], { targets, tray }));
      [0, 1].forEach((die) => {
        const turned = quatMultiply(lastRotation(result, die, 2), result.corrections[die]);
        const up = quatRotate(turned, faceFramesOf('d10')[targets[die]].up);
        const across: Vec3 = [up[0], up[1], 0];
        if (Math.abs(Math.atan2(dot(cross(away, across), UP), dot(away, across))) > Math.PI / 2) upsideDown++;
      });
    }
    expect(upsideDown).toBe(0);
  });
});
