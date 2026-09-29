/** The eight points a bearing is read as, from north and round by way of the east. */
export const COMPASS_POINTS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;

export type CompassPoint = (typeof COMPASS_POINTS)[number];

function wrapped(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * Which way the top of the screen looks, once the table has been turned.
 *
 * The table is turned about the vertical by so many degrees, which carries its north round with
 * it, so what the screen faces is that turn read backwards. Always from 0 to just under 360, so
 * that a table turned round and round still reads as a bearing.
 */
export function screenBearingOf(tableRotationZ: number): number {
  return wrapped(-tableRotationZ);
}

/**
 * How far round to draw a rose whose north is the table's north, measured from the top of the
 * screen. It is the turn itself, since the rose is carried round by the table exactly as the
 * table's own north is.
 */
export function northNeedleAngle(tableRotationZ: number): number {
  return wrapped(tableRotationZ);
}

/**
 * The same bearing written so as to lie nearest the one drawn before it.
 *
 * An angle kept within one turn jumps the width of a turn whenever the table crosses north: five
 * degrees to three hundred and fifty-five is ten degrees of turning and three hundred and fifty
 * of drawing, and anything easing between the two whips the long way round. Counting on past a
 * turn, and back past nothing, keeps the short way short.
 */
export function nearestTurnTo(bearing: number, drawn: number): number {
  return drawn + (wrapped(bearing - drawn + 180) - 180);
}

/**
 * The point of the compass a bearing falls nearest to.
 *
 * Each point owns the 45 degrees around it, so north answers for anything within 22.5 degrees
 * either side of it.
 */
export function compassPointOf(bearing: number): CompassPoint {
  return COMPASS_POINTS[Math.round(wrapped(bearing) / 45) % COMPASS_POINTS.length];
}
