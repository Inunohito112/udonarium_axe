import { TestBed } from '@angular/core/testing';
import { CharacterPermissionService } from '@axe/application/permission/character-permission.service';
import { GameCharacter } from '@axe/domain/character/game-character';
import { PeerCursor } from '@axe/domain/peer/peer-cursor';
import { PeerRole } from '@axe/domain/peer/peer-role';
import { TEST_PROVIDERS } from '@axe/testing/test-providers';

describe('CharacterPermissionService', () => {
  let service: CharacterPermissionService;
  const originalCursor = PeerCursor.myCursor;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...TEST_PROVIDERS] });
    service = TestBed.inject(CharacterPermissionService);
  });

  afterEach(() => {
    PeerCursor.myCursor = originalCursor;
  });

  function sitAs(userId: string, role: PeerRole): void {
    PeerCursor.myCursor = { userId, role } as PeerCursor;
  }

  it('lets the game master control every character', () => {
    sitAs('gm', PeerRole.GameMaster);
    const character = { identifier: 'enemy', isOwnedBy: () => false } as unknown as GameCharacter;

    expect(service.canControl(character)).toBe(true);
  });

  it('lets a player control only a character they own', () => {
    sitAs('player-1', PeerRole.Player);
    const own = {
      identifier: 'own',
      isOwnedBy: (userId: string) => userId === 'player-1',
    } as unknown as GameCharacter;
    const other = { identifier: 'other', isOwnedBy: () => false } as unknown as GameCharacter;

    expect(service.canControl(own)).toBe(true);
    expect(service.canControl(other)).toBe(false);
  });

  it('does not let a player control an unowned character or a guest control one', () => {
    const unowned = { identifier: 'unowned', isOwnedBy: () => false } as unknown as GameCharacter;
    sitAs('player-1', PeerRole.Player);
    expect(service.canControl(unowned)).toBe(false);

    sitAs('guest-1', PeerRole.Guest);
    expect(service.canControl(unowned)).toBe(false);
  });
});
