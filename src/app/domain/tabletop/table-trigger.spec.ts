import { TableTrigger } from '@axe/domain/tabletop/table-trigger';
import { describe, expect, it } from 'vitest';

function ground(overrides: Partial<TableTrigger> = {}): TableTrigger {
  const trigger = new TableTrigger();
  Object.assign(trigger, overrides);
  return trigger;
}

describe('how often a stretch of painted ground has another go', () => {
  it('reads ground painted before there was a finer answer by the plain yes or no', () => {
    expect(ground({ once: true }).repeats).toBe('once');
    expect(ground({ once: false }).repeats).toBe('always');
  });

  it('lets the finer answer stand over the plain one', () => {
    expect(ground({ once: true, repeat: 'oncePerPiece' }).repeats).toBe('oncePerPiece');
  });

  it('reads an answer it does not know as ground with no end of goes in it', () => {
    expect(ground({ repeat: 'twice' }).repeats).toBe('always');
  });
});

describe('whether a stretch of ground has a go left', () => {
  it('has one for anybody, any number of times, where nothing was said', () => {
    const held = ground();

    held.spend('hero', 1);

    expect(held.hasGoFor('hero', 1)).toBe(true);
  });

  it('is spent for everybody once it is spent at all', () => {
    const held = ground({ repeat: 'once' });

    held.spend('hero', 1);

    expect(held.hasGoFor('hero', 1)).toBe(false);
    expect(held.hasGoFor('rogue', 2)).toBe(false);
  });

  it('is spent on the piece that had it, and nobody else, where it has one apiece', () => {
    const held = ground({ repeat: 'oncePerPiece' });

    held.spend('hero', 1);

    expect(held.hasGoFor('hero', 1)).toBe(false);
    expect(held.hasGoFor('rogue', 1)).toBe(true);
  });

  it('keeps every piece it has had, not merely the last', () => {
    const held = ground({ repeat: 'oncePerPiece' });

    held.spend('hero', 1);
    held.spend('rogue', 1);

    expect(held.hasGoFor('hero', 1)).toBe(false);
    expect(held.hasGoFor('rogue', 1)).toBe(false);
  });

  it('comes round again with the round, where it has one go a round', () => {
    const held = ground({ repeat: 'oncePerRound' });

    held.spend('hero', 1);

    expect(held.hasGoFor('hero', 1)).toBe(false);
    expect(held.hasGoFor('rogue', 1)).toBe(false);
    expect(held.hasGoFor('hero', 2)).toBe(true);
  });

  it('has one go and no more at a table counting no rounds', () => {
    const held = ground({ repeat: 'oncePerRound' });

    held.spend('hero', -1);

    expect(held.hasGoFor('hero', -1)).toBe(false);
  });

  it('writes the plain yes or no beside the finer answer, for a peer that knows only the one', () => {
    const held = ground({ repeat: 'once' });

    held.spend('hero', 1);

    expect(held.spent).toBe(true);
  });
});
