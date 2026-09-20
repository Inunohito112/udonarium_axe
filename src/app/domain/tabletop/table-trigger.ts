import { SyncObject, SyncVar } from '@axe/core/sync/decorator';
import { ObjectNode } from '@axe/core/sync/object-node';
import { CellRect } from '@axe/domain/tabletop/cell-rectangles';
import { GameTable } from '@axe/domain/tabletop/game-table';
import {
  asTriggerMoment,
  asTriggerTarget,
  DEFAULT_TRIGGER_COLOR,
  DEFAULT_TRIGGER_MOMENT,
  DEFAULT_TRIGGER_TARGET,
  TriggerMoment,
  TriggerTarget,
} from '@axe/domain/tabletop/trigger-event';

/**
 * Ground that does something to whoever walks onto it.
 *
 * It stands on the table beside the walls and the masks rather than inside the map editor,
 * because a trap is part of the table rather than part of the drawing of it: a table saved
 * and opened again is still trapped, and a room that never opens the editor still walks into
 * one. It carries what it does, whom it does it to, and whether it has been sprung.
 */
@SyncObject('table-trigger')
export class TableTrigger extends ObjectNode {
  @SyncVar() name: string = '';
  @SyncVar() col: number = 0;
  @SyncVar() row: number = 0;
  @SyncVar() width: number = 1;
  @SyncVar() height: number = 1;
  /** One of TRIGGER_MOMENTS: as a walk ends on it, or the moment it is stepped on. */
  @SyncVar() moment: string = DEFAULT_TRIGGER_MOMENT;
  /** One of TRIGGER_TARGETS: everyone, the players' pieces, or the master's. */
  @SyncVar() targets: string = DEFAULT_TRIGGER_TARGET;
  /** Whether springing it once is the end of it. */
  @SyncVar() once: boolean = false;
  /** Whether the room sees the ground, or only the master does. */
  @SyncVar() open: boolean = false;
  /** Whether going off is what shows the ground to the room, a trap giving itself away. */
  @SyncVar() reveals: boolean = false;
  @SyncVar() color: string = DEFAULT_TRIGGER_COLOR;
  /**
   * A line to write in the room as it goes off, in place of saying only that it did.
   *
   * Ground that describes itself saves the master the telling: the sinking of a flagstone, the
   * hiss of a dart. Empty leaves the room the plain notice it has always had.
   */
  @SyncVar() say: string = '';
  /**
   * The state to leave a piece in, by the name the room keeps it under.
   *
   * A name the room has never heard of is put on all the same, as a plain mark with nothing
   * written under it: a master who types one in is naming a state, not asking for one.
   */
  @SyncVar() ailment: string = '';
  /** How long that state lasts. Nought leaves it however long the room says. */
  @SyncVar() ailmentRounds: number = 0;
  /**
   * The roll the ground asks of whoever walks into it, such as a save or a resistance.
   *
   * Asked for rather than rolled. Which dice a table throws and what counts as making it are
   * the game's business, not the ground's, and a room that was told what it rolled would have
   * to be told in one game's terms.
   */
  @SyncVar() check: string = '';
  /** What that roll has to reach. Empty asks for the roll without naming a number. */
  @SyncVar() checkTarget: string = '';
  /**
   * Whether what it says is kept back from the room.
   *
   * A trip wire the party is not meant to notice still has to reach somebody, or nobody would
   * know it had been crossed. The line goes out held back, which is the master's to read and
   * the master's to open.
   */
  @SyncVar() silent: boolean = false;
  /** The name of what it takes from, and how much. A resource of the piece that walked in. */
  @SyncVar() element: string = '';
  @SyncVar() amount: string = '';
  /** The effect played on whoever sets it off, by name. Empty plays nothing. */
  @SyncVar() effect: string = '';
  /**
   * The sound it makes as it goes off, by the name the room's audio goes under.
   *
   * By name rather than by the identifier behind it, the way the effect is named: a map carried
   * into another room holds identifiers that mean nothing there, and a name that matches one
   * piece of audio and no other still finds it.
   */
  @SyncVar() sound: string = '';
  /** The cut-in it plays as it goes off, by name. Empty plays none. */
  @SyncVar() cutIn: string = '';
  /**
   * Whether it carries whoever ends a walk on it away to another cell.
   *
   * Held apart from where it carries them to, since nought and nought is the top left corner
   * of every board and would otherwise be indistinguishable from ground that carries nobody
   * anywhere.
   */
  @SyncVar() warps: boolean = false;
  /** The cell it carries them to, counted from the top left of the board. */
  @SyncVar() warpCol: number = 0;
  @SyncVar() warpRow: number = 0;
  /** Whether it has already gone off, which only ground that goes off once ever holds. */
  @SyncVar() spent: boolean = false;
  /**
   * Whether going off has shown it to the room.
   *
   * Kept apart from what was painted rather than written back over it: the painting is what the
   * ground is, and being found is what has happened to it. Painting the same ground again would
   * otherwise read the finding as a different painting and lay down a fresh, unsprung trap.
   */
  @SyncVar() found: boolean = false;

  /** The ground it covers in cells, rounded to whole cells and at least one cell each way. */
  get rect(): CellRect {
    return {
      col: Math.round(this.col),
      row: Math.round(this.row),
      width: Math.max(1, Math.round(this.width)),
      height: Math.max(1, Math.round(this.height)),
    };
  }

  /** When it goes off, with an unknown stored moment read as the default. */
  get firesOn(): TriggerMoment {
    return asTriggerMoment(this.moment);
  }

  /** Whose pieces it acts on, with an unknown stored target read as everyone's. */
  get catches(): TriggerTarget {
    return asTriggerTarget(this.targets);
  }

  /** Whether this ground still has anything left in it. */
  get isArmed(): boolean {
    return !(this.once && this.spent);
  }

  /** Whether the room is being shown it: painted open, or given away by going off. */
  get isShown(): boolean {
    return this.open || this.found;
  }

  /** Whether a cell lies within the ground it covers. */
  covers(col: number, row: number): boolean {
    const rect = this.rect;
    return col >= rect.col && col < rect.col + rect.width && row >= rect.row && row < rect.row + rect.height;
  }
}

/** The trigger areas laid on a table, or none when there is no table. */
export function triggersOn(table: GameTable | null | undefined): TableTrigger[] {
  if (!table) return [];
  return table.children.filter((child): child is TableTrigger => child instanceof TableTrigger);
}
