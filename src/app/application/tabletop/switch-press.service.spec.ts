import { TestBed } from '@angular/core/testing';
import { CharacterMacroService } from '@axe/application/chat/character-macro.service';
import { ChatMessageService } from '@axe/application/chat/chat-message.service';
import { ChatSpeakerService } from '@axe/application/chat/chat-speaker.service';
import { NamedCueService } from '@axe/application/media/named-cue.service';
import { SWITCH_COOLDOWN_MS, SwitchPressService } from '@axe/application/tabletop/switch-press.service';
import { ObjectStore } from '@axe/core/sync/object-store';
import { GameCharacter } from '@axe/domain/character/game-character';
import { ChatTab } from '@axe/domain/chat/chat-tab';
import { PeerCursor } from '@axe/domain/peer/peer-cursor';
import { PeerRole } from '@axe/domain/peer/peer-role';
import { BoardSwitch } from '@axe/domain/tabletop/board-switch/board-switch';
import {
  defaultSwitchDefinition,
  SwitchAction,
  SwitchDefinition,
} from '@axe/domain/tabletop/board-switch/switch-definition';
import { TEST_PROVIDERS } from '@axe/testing/test-providers';

describe('SwitchPressService', () => {
  let presses: SwitchPressService;
  let macro: CharacterMacroService;
  let said: string[];
  const tab = { plCanView: true, plCanSpeak: true, guestCanView: true, guestCanSpeak: false } as unknown as ChatTab;

  function say(text: string, delayMs = 0): SwitchAction {
    return { kind: 'say', text, delayMs, extra: {} };
  }

  function switchWith(change: Partial<SwitchDefinition>): BoardSwitch {
    const made = new BoardSwitch();
    made.initialize();
    made.write({ ...defaultSwitchDefinition(), ...change });
    return made;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...TEST_PROVIDERS] });
    PeerCursor.createMyCursor().role = PeerRole.Player;
    presses = TestBed.inject(SwitchPressService);
    macro = TestBed.inject(CharacterMacroService);
    said = [];
    vi.spyOn(macro, 'currentTab').mockReturnValue(tab);
    vi.spyOn(macro, 'sendAsSelf').mockImplementation(async (line) => {
      said.push(`self:${line}`);
      return null;
    });
    vi.spyOn(macro, 'sendAsCharacter').mockImplementation(async (character, line) => {
      said.push(`${character.name}:${line}`);
      return null;
    });
    vi.spyOn(macro, 'sendAsNamed').mockImplementation(async (name, line) => {
      said.push(`named ${name}:${line}`);
      return null;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const object of ObjectStore.instance.getObjects()) ObjectStore.instance.remove(object);
    PeerCursor.myCursor = null!;
  });

  it('does what the switch says in order, waiting as long as each thing asks after the one before', async () => {
    vi.useFakeTimers();
    const played: string[] = [];
    vi.spyOn(TestBed.inject(NamedCueService), 'playSound').mockImplementation((name) => {
      played.push(name);
      said.push(`sound:${name}`);
      return true;
    });
    const lever = switchWith({
      actions: [say('one', 3000), { kind: 'sound', name: 'bell', delayMs: 500, extra: {} }, say('two', 1000)],
    });

    const pressing = presses.press(lever, { name: 'lever' });
    await vi.advanceTimersByTimeAsync(0);
    expect(said).toEqual(['self:one']);

    await vi.advanceTimersByTimeAsync(500);
    expect(said).toEqual(['self:one', 'sound:bell']);

    await vi.advanceTimersByTimeAsync(1000);
    expect(said).toEqual(['self:one', 'sound:bell', 'self:two']);
    await expect(pressing).resolves.toBe('pressed');
  });

  it('ignores a press while the switch is still going, however long it goes on for', async () => {
    vi.useFakeTimers();
    const lever = switchWith({ actions: [say('one'), say('two', SWITCH_COOLDOWN_MS * 2)] });

    const first = presses.press(lever, { name: '' });
    await vi.advanceTimersByTimeAsync(SWITCH_COOLDOWN_MS + 100);

    expect(await presses.press(lever, { name: '' })).toBe('busy');
    await vi.advanceTimersByTimeAsync(SWITCH_COOLDOWN_MS);
    await expect(first).resolves.toBe('pressed');
    expect(said).toEqual(['self:one', 'self:two']);
  });

  it('ignores a press for a moment after the last one, so a double click presses once', async () => {
    vi.useFakeTimers();
    const lever = switchWith({ actions: [say('one')] });

    expect(await presses.press(lever, { name: '' })).toBe('pressed');
    expect(await presses.press(lever, { name: '' })).toBe('busy');
    await vi.advanceTimersByTimeAsync(SWITCH_COOLDOWN_MS);

    expect(await presses.press(lever, { name: '' })).toBe('pressed');
    expect(said).toEqual(['self:one', 'self:one']);
  });

  it('speaks as the piece the presser has picked in the chat, where they have one', async () => {
    const hero = GameCharacter.create('勇者', 1, '');
    TestBed.inject(ChatSpeakerService).set(hero.identifier);

    await presses.press(switchWith({ actions: [say('1d100<={目星}')] }), { name: '' });

    expect(said).toEqual(['勇者:1d100<={目星}']);
  });

  it('speaks under the name of what it sits on, else its own label, where it speaks for itself', async () => {
    await presses.press(switchWith({ speaker: 'host', label: 'lever', actions: [say('creak')] }), { name: '宝箱' });
    await presses.press(switchWith({ speaker: 'host', label: 'lever', actions: [say('creak')] }), { name: ' ' });

    expect(said).toEqual(['named 宝箱:creak', 'named lever:creak']);
  });

  it('writes a system line in the tab where it speaks as the room', async () => {
    const system = vi.spyOn(TestBed.inject(ChatMessageService), 'sendSystemMessageToTab').mockReturnValue(null!);

    await presses.press(switchWith({ speaker: 'system', actions: [say('the floor gives way')] }), { name: '' });

    expect(system).toHaveBeenCalledWith(tab, 'the floor gives way');
  });

  it('turns a watcher away without saying anything', async () => {
    PeerCursor.myCursor.role = PeerRole.Guest;

    expect(await presses.press(switchWith({ actions: [say('hi')] }), { name: '' })).toBe('watching');
    expect(said).toEqual([]);
  });

  it('plays an effect on the piece the presser speaks as, and on nobody where they speak as themselves', async () => {
    const effect = vi.spyOn(TestBed.inject(NamedCueService), 'playEffect').mockReturnValue(true);
    const sparkle = { kind: 'effect' as const, name: 'sparkle', delayMs: 0, extra: {} };

    await presses.press(switchWith({ actions: [sparkle] }), { name: '' });
    const hero = GameCharacter.create('勇者', 1, '');
    TestBed.inject(ChatSpeakerService).set(hero.identifier);
    await presses.press(switchWith({ actions: [sparkle] }), { name: '' });

    expect(effect).toHaveBeenNthCalledWith(1, 'sparkle', []);
    expect(effect).toHaveBeenNthCalledWith(2, 'sparkle', [hero]);
  });

  it('goes on with the rest where one thing goes wrong', async () => {
    vi.spyOn(TestBed.inject(NamedCueService), 'launchCutIn').mockImplementation(() => {
      throw new Error('no cut-in');
    });

    const outcome = await presses.press(
      switchWith({ actions: [{ kind: 'cutIn', name: 'boom', delayMs: 0, extra: {} }, say('after')] }),
      { name: '' }
    );

    expect(outcome).toBe('pressed');
    expect(said).toEqual(['self:after']);
  });
});
