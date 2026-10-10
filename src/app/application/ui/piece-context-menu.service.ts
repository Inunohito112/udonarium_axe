import { inject, Injectable } from '@angular/core';
import { CharacterDiceService } from '@axe/application/dice/character-dice.service';
import { DiceRollService } from '@axe/application/dice/dice-roll.service';
import { TRANSLATE_FN } from '@axe/application/i18n/translate.token';
import { PointerCoordinate } from '@axe/application/input/pointer-device.service';
import { CharacterPermissionService } from '@axe/application/permission/character-permission.service';
import { RolePermissionService } from '@axe/application/permission/role-permission.service';
import { ContextMenuService } from '@axe/application/ui/context-menu.service';
import { tryBuildMultiSelectionContextMenu } from '@axe/application/ui/multi-selection-context-menu';
import { SelectionSignalService } from '@axe/application/ui/selection-signal.service';
import { ObjectStore } from '@axe/core/sync/object-store';
import { GameCharacter } from '@axe/domain/character/game-character';
import { DiceSymbol } from '@axe/domain/dice/dice-symbol';
import { GameTableMask } from '@axe/domain/tabletop/game-table-mask';
import { TabletopObject } from '@axe/domain/tabletop/tabletop-object';
import { Terrain } from '@axe/domain/tabletop/terrain';

/**
 * Where a right-click on something on the board arrives.
 *
 * A group selection gets the bulk actions; only a single object earns the menu
 * built for that object alone.
 */
@Injectable({ providedIn: 'root' })
export class PieceContextMenuService {
  private readonly contextMenuService = inject(ContextMenuService);
  private readonly rolePermission = inject(RolePermissionService);
  private readonly characterPermission = inject(CharacterPermissionService);
  private readonly selectionSignalService = inject(SelectionSignalService);
  private readonly objectStore = inject(ObjectStore);
  private readonly diceRollService = inject(DiceRollService);
  private readonly characterDice = inject(CharacterDiceService);
  private readonly t = inject(TRANSLATE_FN);

  /** True when the bulk menu was opened. The caller stops there. */
  openForSelection(self: TabletopObject, gridSize: number, position: PointerCoordinate): boolean {
    const multi = tryBuildMultiSelectionContextMenu({
      self,
      selectionSignalService: this.selectionSignalService,
      objectStore: this.objectStore,
      t: this.t,
      gridSize,
      rollDice: (dice) => this.diceRollService.roll(dice),
      diceOwners: this.objectStore
        .getObjects<GameCharacter>(GameCharacter)
        .filter((character) => character.isVisibleOnTable && this.characterPermission.canControl(character))
        .map((character) => ({ identifier: character.identifier, name: character.name })),
      storeDice: (dice, ownerIdentifier) => this.storeDice(dice, ownerIdentifier),
      canManipulate: (object) =>
        (this.rolePermission.canEditShared || (!(object instanceof Terrain) && !(object instanceof GameTableMask))) &&
        (!(object instanceof GameCharacter) || this.characterPermission.canControl(object)),
    });
    if (!multi) return false;

    this.contextMenuService.open(position, multi, this.t('feature.tabletop.selection.title'));
    return true;
  }

  private storeDice(dice: DiceSymbol[], ownerIdentifier: string): void {
    const owner = this.objectStore.get<GameCharacter>(ownerIdentifier);
    if (!(owner instanceof GameCharacter) || !this.characterPermission.canControl(owner)) return;

    for (const die of dice) this.characterDice.store(owner, die);
    this.selectionSignalService.clearSelection();
  }
}
