/**
 * Where a room shows the dice of a chat roll tumbling: in the frame of the line that gives the
 * result, on the table, or nowhere.
 */
export type DiceStage = 'off' | 'frame' | 'table';

export const DICE_STAGES: readonly DiceStage[] = ['off', 'frame', 'table'];

/**
 * Reads a room's setting. Anything but `frame` or `table`, such as nothing at all from a room
 * saved before the setting was there, is `off`.
 */
export function asDiceStage(raw: unknown): DiceStage {
  return raw === 'frame' || raw === 'table' ? raw : 'off';
}
