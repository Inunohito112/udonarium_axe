import { Tray } from '@axe/domain/dice/dice-3d/throw-validation';

/** The floor every throw gets at least, room enough for a handful of dice to roll about. */
export const MIN_TRAY_AREA = 98;
/** The floor each die adds, so a large roll still has room to land apart. */
const AREA_PER_DIE = 6;

/**
 * The tray a number of dice are thrown onto, in the shape of the stage it is drawn in: the floor
 * asked for, which a stage sets by how large it wants the dice to look, and more of it for every
 * die past two, so a large roll still lands apart.
 */
export function trayFor(count: number, aspect: number, minArea = MIN_TRAY_AREA): Tray {
  const area = minArea + AREA_PER_DIE * Math.max(0, count - 2);
  const halfDepth = Math.sqrt(area / aspect) / 2;
  return { halfWidth: halfDepth * aspect, halfDepth };
}
