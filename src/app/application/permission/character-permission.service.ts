import { inject, Injectable } from '@angular/core';
import { ObjectChangeService } from '@axe/application/sync/object-change.service';
import { GameCharacter } from '@axe/domain/character/game-character';
import { PeerCursor } from '@axe/domain/peer/peer-cursor';
import { PeerRole } from '@axe/domain/peer/peer-role';

/** Decides whether the local seat may operate a character, rather than merely view its sheet. */
@Injectable({ providedIn: 'root' })
export class CharacterPermissionService {
  private readonly objectChange = inject(ObjectChangeService);

  /** The game master may operate every character; a player may operate only their own. */
  canControl(character: GameCharacter | null | undefined): boolean {
    if (!character) return false;
    this.objectChange.trackMyCursor();
    this.objectChange.versionOf(character.identifier)();

    if (PeerCursor.myRole === PeerRole.GameMaster) return true;
    if (PeerCursor.myRole !== PeerRole.Player) return false;

    const userId = PeerCursor.myCursor?.userId ?? '';
    return userId.length > 0 && character.isOwnedBy(userId);
  }
}
