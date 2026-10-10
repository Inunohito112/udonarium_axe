import { GameCharacter } from '@axe/domain/character/game-character';

export const GRAVEYARD_LOCATION = 'graveyard';

/**
 * Whether the user owns the character and it is not in the graveyard; an empty user id owns
 * nothing.
 */
export function isOwnedByUser(character: GameCharacter, userId: string): boolean {
  if (userId.length === 0) return false;
  if (character.owner !== userId) return false;
  return character.location.name !== GRAVEYARD_LOCATION;
}

/** The characters the user owns outside the graveyard, in the order given. */
export function selectOwnedCharacters(characters: readonly GameCharacter[], userId: string): GameCharacter[] {
  return characters.filter((character) => isOwnedByUser(character, userId));
}

/**
 * Whether a player may take up and work a piece: only one they own.
 *
 * Unclaimed pieces stay read-only until the game master assigns an owner.
 */
export function isControllableByUser(character: GameCharacter, userId: string): boolean {
  if (character.location.name === GRAVEYARD_LOCATION) return false;
  return userId.length > 0 && character.owner === userId;
}

/** The characters the player owns outside the graveyard, in the order given. */
export function selectControllableCharacters(characters: readonly GameCharacter[], userId: string): GameCharacter[] {
  return characters.filter((character) => isControllableByUser(character, userId));
}

/** Whether the character is showing on the table. */
export function isOnTable(character: GameCharacter): boolean {
  return character.isVisibleOnTable;
}

/**
 * The characters on the table nobody has claimed, which a user with no character of their own can
 * take up from the empty list.
 */
export function selectClaimableCharacters(characters: readonly GameCharacter[]): GameCharacter[] {
  return characters.filter((character) => character.owner.length < 1 && isOnTable(character));
}
