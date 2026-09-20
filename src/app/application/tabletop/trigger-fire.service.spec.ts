import { TestBed } from '@angular/core/testing';
import { ChatMessageService } from '@axe/application/chat/chat-message.service';
import { EffectCastService } from '@axe/application/effect/effect-cast.service';
import { EffectLibraryService } from '@axe/application/effect/effect-library.service';
import { TRANSLATE_FN, TranslateFn } from '@axe/application/i18n/translate.token';
import { TriggerFireService } from '@axe/application/tabletop/trigger-fire.service';
import { ObjectStore } from '@axe/core/sync/object-store';
import { GameCharacter } from '@axe/domain/character/game-character';
import { DataElement, DataElementType } from '@axe/domain/data/data-element';
import { cellGridOf, cellIndexOf } from '@axe/domain/tabletop/fog/cell-grid';
import { GameTable, GridType } from '@axe/domain/tabletop/game-table';
import { TableSelecter } from '@axe/domain/tabletop/table-selecter';
import { TableTrigger } from '@axe/domain/tabletop/table-trigger';
import { TEST_PROVIDERS } from '@axe/testing/test-providers';
import { vi } from 'vitest';

const GRID = 50;

describe('TriggerFireService', () => {
  let service: TriggerFireService;
  let table: GameTable;

  const grid = () => cellGridOf(table.width, table.height, GRID, GridType.SQUARE);
  const at = (col: number, row: number) => cellIndexOf(grid(), col, row);

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...TEST_PROVIDERS] });
    table = new GameTable();
    table.width = 12;
    table.height = 12;
    table.gridSize = GRID;
    table.initialize();
    TestBed.inject(TableSelecter).viewTableIdentifier = table.identifier;
    service = TestBed.inject(TriggerFireService);
  });

  afterEach(() => {
    for (const object of ObjectStore.instance.getObjects()) ObjectStore.instance.remove(object);
  });

  function trapAt(col: number, row: number, overrides: Partial<TableTrigger> = {}): TableTrigger {
    const trigger = new TableTrigger();
    trigger.col = col;
    trigger.row = row;
    trigger.element = 'ライフ';
    trigger.amount = '3';
    Object.assign(trigger, overrides);
    trigger.initialize();
    table.appendChild(trigger);
    return trigger;
  }

  function heroWith(hp: number): GameCharacter {
    const hero = GameCharacter.create('英雄', 1, '');
    const resource = DataElement.create('ライフ', hp, { type: DataElementType.NUMBER_RESOURCE, currentValue: hp });
    hero.detailDataElement!.appendChild(resource);
    return hero;
  }

  function hpOf(piece: GameCharacter): number {
    return Number(DataElement.findElementByReference(piece.rootDataElement!, 'ライフ')!.currentValue);
  }

  describe('a piece carried by hand', () => {
    function standAt(piece: GameCharacter, col: number, row: number): void {
      piece.location = { name: 'table', x: col * GRID, y: row * GRID };
    }

    it('springs what it is put down on', () => {
      trapAt(5, 5);
      const hero = heroWith(20);
      standAt(hero, 4, 5);

      service.pickedUp(hero);
      standAt(hero, 5, 5);
      const fired = service.putDown(hero);

      expect(fired.length).toBe(1);
      expect(hpOf(hero)).toBe(17);
    });

    it('springs ground that waits to be stepped on as readily, having no way to offer', () => {
      trapAt(5, 5, { moment: 'enter' });
      const hero = heroWith(20);
      standAt(hero, 4, 5);

      service.pickedUp(hero);
      standAt(hero, 5, 5);
      service.putDown(hero);

      expect(hpOf(hero)).toBe(17);
    });

    it('springs nothing where the piece was put back where it came from', () => {
      trapAt(4, 5);
      const hero = heroWith(20);
      standAt(hero, 4, 5);

      service.pickedUp(hero);
      const fired = service.putDown(hero);

      expect(fired).toEqual([]);
      expect(hpOf(hero)).toBe(20);
    });

    it('springs nothing for a piece nobody picked up', () => {
      trapAt(5, 5);
      const hero = heroWith(20);
      standAt(hero, 5, 5);

      expect(service.putDown(hero)).toEqual([]);
    });
  });

  it('takes what the ground takes from the piece that walks onto it', () => {
    trapAt(5, 5);
    const hero = heroWith(20);

    const fired = service.walked(hero, grid(), [at(4, 5), at(5, 5)]);

    expect(fired.length).toBe(1);
    expect(fired[0].taken).toBe(3);
    expect(hpOf(hero)).toBe(17);
  });

  it('says the resource changed, so the gauge, the floating number and its sound all follow', () => {
    trapAt(5, 5);
    const hero = heroWith(20);
    const resource = DataElement.findElementByReference(hero.rootDataElement!, 'ライフ')!;
    const told = vi.spyOn(resource, 'update');

    service.walked(hero, grid(), [at(4, 5), at(5, 5)]);

    // The write itself announces it, which is what the piece watches to draw the change.
    expect(told).toHaveBeenCalled();
  });

  it('plays what the ground was told to play, on whoever set it off', () => {
    const preset = TestBed.inject(EffectLibraryService).create('爆発');
    const cast = vi.spyOn(TestBed.inject(EffectCastService), 'fire').mockReturnValue(null);
    trapAt(5, 5, { effect: '爆発' });
    const hero = heroWith(20);

    service.walked(hero, grid(), [at(4, 5), at(5, 5)]);

    expect(cast).toHaveBeenCalledWith(preset, [hero], null);
  });

  it('plays an effect the master keeps to themselves, since the master is who painted it', () => {
    const preset = TestBed.inject(EffectLibraryService).create('隠し爆発');
    preset.gmOnly = true;
    const cast = vi.spyOn(TestBed.inject(EffectCastService), 'fire').mockReturnValue(null);
    trapAt(5, 5, { effect: '隠し爆発' });

    service.walked(heroWith(20), grid(), [at(4, 5), at(5, 5)]);

    expect(cast).toHaveBeenCalled();
  });

  it('plays nothing where the ground names no effect', () => {
    const cast = vi.spyOn(TestBed.inject(EffectCastService), 'fire').mockReturnValue(null);
    trapAt(5, 5);

    service.walked(heroWith(20), grid(), [at(4, 5), at(5, 5)]);

    expect(cast).not.toHaveBeenCalled();
  });

  it('leaves ground the piece was already standing on alone', () => {
    trapAt(5, 5);
    const hero = heroWith(20);

    expect(service.walked(hero, grid(), [at(5, 5)])).toEqual([]);
    expect(hpOf(hero)).toBe(20);
  });

  it('waits for the walk to end where that is what it waits for', () => {
    trapAt(5, 5);
    const hero = heroWith(20);

    service.walked(hero, grid(), [at(4, 5), at(5, 5), at(6, 5)]);

    expect(hpOf(hero)).toBe(20);
  });

  it('goes off in passing where it was told to', () => {
    trapAt(5, 5, { moment: 'enter' });
    const hero = heroWith(20);

    service.walked(hero, grid(), [at(4, 5), at(5, 5), at(6, 5)]);

    expect(hpOf(hero)).toBe(17);
  });

  it('goes off for every cell of it that is stepped on, so wading it costs the wading', () => {
    trapAt(5, 5, { moment: 'enter', width: 3, height: 3 });
    const hero = heroWith(20);

    const fired = service.walked(hero, grid(), [at(4, 5), at(5, 5), at(6, 5), at(7, 5)]);

    expect(fired.length).toBe(3);
    expect(hpOf(hero)).toBe(11);
  });

  it('goes off once for a walk across it where one go is all it had', () => {
    trapAt(5, 5, { moment: 'enter', width: 3, height: 3, once: true });
    const hero = heroWith(20);

    const fired = service.walked(hero, grid(), [at(4, 5), at(5, 5), at(6, 5), at(7, 5)]);

    expect(fired.length).toBe(1);
    expect(hpOf(hero)).toBe(17);
  });

  it('gives itself away by being seen where that is what going off was to do', () => {
    const trap = trapAt(5, 5, { reveals: true });
    expect(trap.isShown).toBe(false);

    service.walked(heroWith(20), grid(), [at(4, 5), at(5, 5)]);

    expect(trap.isShown).toBe(true);
  });

  it('is found rather than repainted, so what was painted is still what it was', () => {
    const trap = trapAt(5, 5, { reveals: true });

    service.walked(heroWith(20), grid(), [at(4, 5), at(5, 5)]);

    expect(trap.found).toBe(true);
    expect(trap.open).toBe(false);
  });

  it('stays hidden where giving itself away was never asked of it', () => {
    const trap = trapAt(5, 5);

    service.walked(heroWith(20), grid(), [at(4, 5), at(5, 5)]);

    expect(trap.isShown).toBe(false);
  });

  it('holds its peace for a piece it was not pointed at', () => {
    trapAt(5, 5, { targets: 'pc' });
    const monster = heroWith(20);
    monster.isNpc = true;

    expect(service.walked(monster, grid(), [at(4, 5), at(5, 5)])).toEqual([]);
    expect(hpOf(monster)).toBe(20);
  });

  it('is spent once it has gone off, where it only ever had the one go', () => {
    const trap = trapAt(5, 5, { once: true });
    const hero = heroWith(20);

    service.walked(hero, grid(), [at(4, 5), at(5, 5)]);
    service.walked(hero, grid(), [at(4, 5), at(5, 5)]);

    expect(trap.spent).toBe(true);
    expect(hpOf(hero)).toBe(17);
  });

  it('goes off again and again where nothing said otherwise', () => {
    trapAt(5, 5);
    const hero = heroWith(20);

    service.walked(hero, grid(), [at(4, 5), at(5, 5)]);
    service.walked(hero, grid(), [at(4, 5), at(5, 5)]);

    expect(hpOf(hero)).toBe(14);
  });

  it('gives back rather than takes where the amount is written the other way', () => {
    trapAt(5, 5, { amount: '-5' });
    const hero = heroWith(20);
    DataElement.findElementByReference(hero.rootDataElement!, 'ライフ')!.currentValue = 10;

    service.walked(hero, grid(), [at(4, 5), at(5, 5)]);

    expect(hpOf(hero)).toBe(15);
  });

  it('gives nothing back past the full a resource was written with', () => {
    trapAt(5, 5, { amount: '-50' });
    const hero = heroWith(20);
    DataElement.findElementByReference(hero.rootDataElement!, 'ライフ')!.currentValue = 12;

    service.walked(hero, grid(), [at(4, 5), at(5, 5)]);

    expect(hpOf(hero)).toBe(20);
  });

  it('takes nothing from a piece that carries no such thing', () => {
    trapAt(5, 5, { element: 'マナ' });
    const hero = heroWith(20);

    const fired = service.walked(hero, grid(), [at(4, 5), at(5, 5)]);

    expect(fired[0].from).toBe('');
    expect(hpOf(hero)).toBe(20);
  });
});

describe('TriggerFireService and what the room is told', () => {
  let service: TriggerFireService;
  let table: GameTable;
  let chat: ChatMessageService;

  const grid = () => cellGridOf(table.width, table.height, GRID, GridType.SQUARE);
  const at = (col: number, row: number) => cellIndexOf(grid(), col, row);

  /** Says the key and the words put into it, so a line can be read without any translation. */
  const spell: TranslateFn = (key, params) => [key, ...Object.values(params ?? {}).map((held) => `${held}`)].join('|');

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...TEST_PROVIDERS, { provide: TRANSLATE_FN, useValue: spell }] });
    table = new GameTable();
    table.width = 12;
    table.height = 12;
    table.gridSize = GRID;
    table.initialize();
    TestBed.inject(TableSelecter).viewTableIdentifier = table.identifier;
    service = TestBed.inject(TriggerFireService);
    chat = TestBed.inject(ChatMessageService);
    vi.spyOn(chat, 'sendSystemMessageToMainTab').mockReturnValue(null!);
    vi.spyOn(chat, 'sendSecretSystemMessageToMainTab').mockReturnValue(null!);
  });

  afterEach(() => {
    for (const object of ObjectStore.instance.getObjects()) ObjectStore.instance.remove(object);
    vi.restoreAllMocks();
  });

  function trapAt(col: number, row: number, overrides: Partial<TableTrigger> = {}): TableTrigger {
    const trigger = new TableTrigger();
    trigger.col = col;
    trigger.row = row;
    trigger.name = '落とし穴';
    Object.assign(trigger, overrides);
    trigger.initialize();
    table.appendChild(trigger);
    return trigger;
  }

  function heroWith(hp: number): GameCharacter {
    const hero = GameCharacter.create('英雄', 1, '');
    const resource = DataElement.create('ライフ', hp, { type: DataElementType.NUMBER_RESOURCE, currentValue: hp });
    hero.detailDataElement!.appendChild(resource);
    return hero;
  }

  const spoken = () => vi.mocked(chat.sendSystemMessageToMainTab).mock.calls.map((call) => call[0]);
  const kept = () => vi.mocked(chat.sendSecretSystemMessageToMainTab).mock.calls.map((call) => call[0]);

  it('says only that the ground was stepped on where it was given no line', () => {
    trapAt(5, 5);

    service.walked(heroWith(20), grid(), [at(4, 5), at(5, 5)]);

    expect(spoken()).toHaveLength(1);
    expect(spoken()[0]).toContain('trigger.sprang');
  });

  it('writes the line the ground was given in place of saying merely that it went off', () => {
    trapAt(5, 5, { say: '足元の石が沈んだ' });

    service.walked(heroWith(20), grid(), [at(4, 5), at(5, 5)]);

    expect(spoken()).toHaveLength(1);
    expect(spoken()[0]).toContain('足元の石が沈んだ');
    expect(spoken()[0]).not.toContain('trigger.sprang');
  });

  it('writes what it took on a line after the one it was given', () => {
    trapAt(5, 5, { say: '足元の石が沈んだ', element: 'ライフ', amount: '3' });

    service.walked(heroWith(20), grid(), [at(4, 5), at(5, 5)]);

    expect(spoken()).toHaveLength(2);
    expect(spoken()[0]).toContain('足元の石が沈んだ');
    expect(spoken()[1]).toContain('trigger.tookFrom');
  });

  it('keeps every line of a quiet trap back from the room', () => {
    trapAt(5, 5, { say: '糸が張ってある', silent: true, element: 'ライフ', amount: '3' });

    service.walked(heroWith(20), grid(), [at(4, 5), at(5, 5)]);

    expect(spoken()).toHaveLength(0);
    expect(kept()).toHaveLength(2);
  });

  it('sends a quiet line from nobody, so the seat that sprang it cannot read it either', () => {
    trapAt(5, 5, { silent: true });

    service.walked(heroWith(20), grid(), [at(4, 5), at(5, 5)]);

    expect(vi.mocked(chat.sendSecretSystemMessageToMainTab).mock.calls[0][1]).toBeUndefined();
  });

  it('takes what it takes whether or not anybody is told', () => {
    vi.mocked(chat.sendSystemMessageToMainTab).mockImplementation(() => {
      throw new Error('no chat tab yet');
    });
    trapAt(5, 5, { element: 'ライフ', amount: '3' });
    const hero = heroWith(20);

    service.walked(hero, grid(), [at(4, 5), at(5, 5)]);

    expect(Number(DataElement.findElementByReference(hero.rootDataElement!, 'ライフ')!.currentValue)).toBe(17);
  });
});
