import { computed, inject, Injectable } from '@angular/core';
import { ObjectChangeService } from '@axe/application/sync/object-change.service';
import { ObjectNode } from '@axe/core/sync/object-node';
import { PeerCursor } from '@axe/domain/peer/peer-cursor';
import { PeerRole } from '@axe/domain/peer/peer-role';
import { BoardSwitch, switchOf } from '@axe/domain/tabletop/board-switch/board-switch';
import { SwitchDefinition } from '@axe/domain/tabletop/board-switch/switch-definition';

/**
 * Makes things on the table into switches and takes them back out, for the master.
 *
 * What a switch does is the master's to write and the master's to read: a switch that answers a
 * search would give the answer away to anyone who could open it. The switch is synced like the
 * rest of the table, since whoever presses it has to know what it does, so what is kept from the
 * players is kept by the screens they would read it on rather than by the data.
 */
@Injectable({ providedIn: 'root' })
export class BoardSwitchService {
  private readonly objectChange = inject(ObjectChangeService);

  /** Whether this seat writes and reads switches, which only the master does. */
  readonly canEdit = computed(() => {
    this.objectChange.trackMyCursor();
    return PeerCursor.myRole === PeerRole.GameMaster;
  });

  /** The switch on something, making one first where it has none. Only the master makes one. */
  ensure(host: ObjectNode): BoardSwitch | null {
    const held = switchOf(host);
    if (held || !this.canEdit()) return held;
    const made = new BoardSwitch();
    made.initialize();
    host.appendChild(made);
    return made;
  }

  /** Writes what a switch does, where this seat may. */
  write(target: BoardSwitch, definition: SwitchDefinition): void {
    if (!this.canEdit()) return;
    target.write(definition);
  }

  /** Takes the switch off something, leaving it the plain thing it was. */
  remove(host: ObjectNode): void {
    if (!this.canEdit()) return;
    switchOf(host)?.destroy();
  }
}
