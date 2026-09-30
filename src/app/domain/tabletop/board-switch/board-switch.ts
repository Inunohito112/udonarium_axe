import { SyncObject, SyncVar } from '@axe/core/sync/decorator';
import { ObjectNode } from '@axe/core/sync/object-node';
import {
  encodeSwitchDefinition,
  parseSwitchDefinition,
  SwitchDefinition,
} from '@axe/domain/tabletop/board-switch/switch-definition';

/**
 * What happens when somebody presses the thing it is attached to.
 *
 * It hangs under what it belongs to as a child of its own rather than being written onto it.
 * An older peer that moves or locks a block hands the block's settings over whole, and anything
 * it had never heard of would go with them; a child is left alone. An older version reading a
 * saved table does not know the name and passes over it, so the block comes back as a block.
 *
 * What it does is kept as one piece of text, so the fields it has are the fields it will always
 * have: an older build writing down that it was pressed carries the text across untouched, and
 * whatever a newer build added to it survives the trip.
 */
@SyncObject('board-switch')
export class BoardSwitch extends ObjectNode {
  /** What it is called and what it does, as `encodeSwitchDefinition` writes it. */
  @SyncVar() definition: string = '';
  /** Whether it has been used up, where it could only be pressed once. */
  @SyncVar() spent: boolean = false;
  /** Who has pressed it already, where each may press it once. Space separated. */
  @SyncVar() spentBy: string = '';
  /** The round it was last pressed in, where it may be pressed once a round. Below nought is none. */
  @SyncVar() spentRound: number = -1;
  /** Whether it has been taken off the table for good, kept rather than destroyed. */
  @SyncVar() retired: boolean = false;

  /** What it is called and what it does, read afresh each time. */
  get def(): SwitchDefinition {
    return parseSwitchDefinition(this.definition);
  }

  /** Writes down what it is called and what it does. */
  write(definition: SwitchDefinition): void {
    const encoded = encodeSwitchDefinition(definition);
    if (encoded !== this.definition) this.definition = encoded;
  }

  /**
   * The round it was last pressed in.
   *
   * A table saved without it, or an older peer handing over nothing, reads as never pressed:
   * read as nought, the empty answer would say the switch had been pressed in the first round.
   */
  get lastRound(): number {
    const held: unknown = this.spentRound;
    if (typeof held === 'string' && held.trim().length < 1) return -1;
    const round = Number(held);
    return Number.isFinite(round) ? round : -1;
  }
}

/** The switch hung under something, or null where it has none. */
export function switchOf(host: ObjectNode | null | undefined): BoardSwitch | null {
  if (!host) return null;
  for (const child of host.children) if (child instanceof BoardSwitch) return child;
  return null;
}
