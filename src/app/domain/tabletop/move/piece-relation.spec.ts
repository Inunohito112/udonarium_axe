import { PIECE_RELATIONS, relationBetween } from '@axe/domain/tabletop/move/piece-relation';
import { describe, expect, it } from 'vitest';

function piece(identifier: string, partyIdentifier = ''): { identifier: string; partyIdentifier: string } {
  return { identifier, partyIdentifier };
}

describe('what a piece in the way is to the one walking into it', () => {
  it('knows its own party', () => {
    expect(relationBetween(piece('b', 'heroes'), piece('a', 'heroes'))).toBe('same');
  });

  it('knows another party', () => {
    expect(relationBetween(piece('b', 'goblins'), piece('a', 'heroes'))).toBe('other');
  });

  it('knows a piece nobody has placed', () => {
    expect(relationBetween(piece('b'), piece('a', 'heroes'))).toBe('none');
  });

  it('makes no companions of two pieces nobody has placed', () => {
    expect(relationBetween(piece('b'), piece('a'))).toBe('none');
  });

  it('counts a party of its own for nothing to a piece in none', () => {
    expect(relationBetween(piece('b', 'goblins'), piece('a'))).toBe('other');
  });

  it('answers with one of the three it knows, whatever it is asked', () => {
    expect(PIECE_RELATIONS).toContain(relationBetween(piece('b', 'x'), piece('a', 'y')));
  });
});
