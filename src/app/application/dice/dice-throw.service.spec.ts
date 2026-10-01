import { TestBed } from '@angular/core/testing';
import {
  DiceThrowService,
  JUST_ROLLED_MS,
  KEPT_THROWS,
  LINE_WAIT_MS,
  MAX_TUMBLING,
} from '@axe/application/dice/dice-throw.service';
import { DiceTrayPlacementService, TablePlacement } from '@axe/application/dice/dice-tray-placement.service';
import { MotionService } from '@axe/application/ui/motion.service';
import { callDiceThrow, emitMessageAdded } from '@axe/core/event/domain-events';
import { setNetworkIsolated } from '@axe/core/network/network-isolation';
import { IPeerContext } from '@axe/core/network/peer-context';
import { resetPeerContextProvider, setPeerContextProvider } from '@axe/core/network/peer-context-source';
import { PeerSessionGrade } from '@axe/core/network/peer-session-state';
import { ObjectStore } from '@axe/core/sync/object-store';
import { ChatMessage } from '@axe/domain/chat/chat-message';
import { ChatTab } from '@axe/domain/chat/chat-tab';
import { DiceStage } from '@axe/domain/dice/dice-3d/dice-stage';
import { Quat, quatRotate } from '@axe/domain/dice/dice-3d/rotation';
import { DiceRollOutcome, encodeDiceRollDetail } from '@axe/domain/dice/dice-roll-detail';
import { Config } from '@axe/domain/peer/config';
import { PeerCursor } from '@axe/domain/peer/peer-cursor';
import { PeerRole } from '@axe/domain/peer/peer-role';
import { faceFramesOf } from '@axe/infrastructure/dice-3d/dice-geometry';
import { useDicePhysicsWorkerFactory } from '@axe/infrastructure/dice-3d/dice-physics-client';
import { TEST_PROVIDERS } from '@axe/testing/test-providers';

const ME = 'me';
const SOMEONE = 'someone-else';

describe('DiceThrowService', () => {
  let tab: ChatTab;
  let service: DiceThrowService;
  let stageBefore: DiceStage;
  let placement: TablePlacement | null;
  let placedFor: string[];

  function fixPeerContext(): void {
    const self = {
      peerId: 'peer-self',
      userId: ME,
      session: { grade: PeerSessionGrade.UNSPECIFIED, name: '', isVisitor: false },
    } as unknown as IPeerContext;
    setPeerContextProvider({ peerContext: self, peerContexts: [self], peerIds: [self.peerId], peerId: self.peerId });
  }

  interface Answer {
    faces?: { sides: number; value: number }[];
    from?: string;
    secret?: boolean;
    to?: string;
    timestamp?: number;
    color?: string;
    outcome?: DiceRollOutcome;
  }

  /** The dice bot's answer to a roll, put in the tab. */
  function answer(options: Answer = {}): ChatMessage {
    const from = options.from ?? ME;
    return tab.addMessage({
      from: 'System-BCDice',
      originFrom: from,
      text: '→ 8',
      timestamp: options.timestamp ?? Date.now(),
      imageIdentifier: '',
      tag: options.secret ? 'system secret' : 'system',
      name: '<BCDice>',
      to: options.to,
      messColor: options.color ?? '#3b5bdb',
      dicebot: encodeDiceRollDetail({
        system: 'DiceBot',
        outcome: options.outcome ?? '',
        faces: (options.faces ?? [{ sides: 20, value: 17 }]).map((face) => ({ ...face, kind: 'normal' })),
      }),
    });
  }

  function thrown(message: ChatMessage) {
    return service.throws().get(message.identifier);
  }

  beforeEach(() => {
    fixPeerContext();
    PeerCursor.createMyCursor();
    PeerCursor.myCursor.userId = ME;
    PeerCursor.myCursor.role = PeerRole.Player;
    stageBefore = Config.instance.diceStage;
    Config.instance.diceStage = 'frame';
    useDicePhysicsWorkerFactory(() => null);
    placedFor = [];
    placement = {
      model: [20, 0, 0, 0, 0, -20, 0, 0, 0, 0, 20, 0, 400, 300, 0, 1],
      tray: { halfWidth: 4, halfDepth: 3 },
    };
    TestBed.configureTestingModule({
      providers: [
        ...TEST_PROVIDERS,
        {
          provide: DiceTrayPlacementService,
          useValue: {
            placementFor: (speaker: string) => {
              placedFor.push(speaker);
              return placement;
            },
          },
        },
      ],
    });
    service = TestBed.inject(DiceThrowService);
    TestBed.inject(MotionService).setting.set('on');

    tab = new ChatTab();
    tab.initialize();
  });

  afterEach(() => {
    vi.useRealTimers();
    setNetworkIsolated(false);
    useDicePhysicsWorkerFactory(null);
    Config.instance.diceStage = stageBefore;
    resetPeerContextProvider();
    tab.destroy();
    for (const message of ObjectStore.instance.getObjects<ChatMessage>(ChatMessage)) message.destroy();
    for (const cursor of ObjectStore.instance.getObjects<PeerCursor>(PeerCursor)) cursor.destroy();
  });

  it('throws the dice of a roll just answered, landing them on the numbers it came to', async () => {
    const line = answer({
      faces: [
        { sides: 20, value: 17 },
        { sides: 6, value: 2 },
      ],
    });

    callDiceThrow({ messageIdentifier: line.identifier }, 'here');

    await vi.waitFor(() => expect(thrown(line)?.phase).toBe('rolling'));
    expect(thrown(line)?.shown).toEqual(['17', '2']);
    expect(thrown(line)?.dice.map((die) => die.shape)).toEqual(['d20', 'd6']);
    expect(thrown(line)?.color).toBe('#3b5bdb');
  });

  it('lets the dice come to rest once their recording has played', async () => {
    const line = answer();
    callDiceThrow({ messageIdentifier: line.identifier }, 'here');
    await vi.waitFor(() => expect(thrown(line)?.phase).toBe('rolling'));

    const result = thrown(line)!.result!;
    await vi.waitFor(() => expect(thrown(line)?.phase).toBe('settled'), {
      timeout: (result.frameCount / 60) * 1000 + 2000,
    });
  });

  it('carries whether the roll was a critical or a fumble, for the dice to flash', async () => {
    const line = answer({ outcome: 'critical' });

    callDiceThrow({ messageIdentifier: line.identifier }, 'here');

    await vi.waitFor(() => expect(thrown(line)?.phase).toBe('rolling'));
    expect(thrown(line)?.outcome).toBe('critical');
  });

  it('comes to rest as long after it began to play on the screen as its dice take, not after it was worked out', async () => {
    const line = answer();
    callDiceThrow({ messageIdentifier: line.identifier }, 'here');
    await vi.waitFor(() => expect(thrown(line)?.phase).toBe('rolling'));
    const total = ((thrown(line)!.result!.frameCount - 1) / 60) * 1000;

    service.played(line.identifier, performance.now() + 1500);
    await new Promise((resolve) => setTimeout(resolve, total + 300));
    expect(thrown(line)?.phase).toBe('rolling');

    await vi.waitFor(() => expect(thrown(line)?.phase).toBe('settled'), { timeout: 3000 });
  });

  it('throws nothing while the room shows no dice', async () => {
    Config.instance.diceStage = 'off';
    const line = answer();

    callDiceThrow({ messageIdentifier: line.identifier }, 'here');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(thrown(line)).toBeUndefined();
  });

  it('waits for a line that arrives after the call to throw it', async () => {
    const id = 'answer-that-comes-later';
    callDiceThrow({ messageIdentifier: id }, 'here');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.throws().has(id)).toBe(false);

    const line = answer();
    (line as unknown as { context: { identifier: string } }).context.identifier = id;
    ObjectStore.instance.add(line);
    emitMessageAdded({ tabIdentifier: tab.identifier, messageIdentifier: id });

    await vi.waitFor(() => expect(service.throws().get(id)?.phase).toBe('rolling'));
  });

  it('stops waiting for a line that never comes', async () => {
    vi.useFakeTimers();
    const id = 'never-comes';
    callDiceThrow({ messageIdentifier: id }, 'here');
    await vi.advanceTimersByTimeAsync(LINE_WAIT_MS + 1);
    vi.useRealTimers();

    expect(service.throws().has(id)).toBe(false);
  });

  it('throws the same line once, however often it is called', async () => {
    const line = answer();
    callDiceThrow({ messageIdentifier: line.identifier }, 'here');
    await vi.waitFor(() => expect(thrown(line)?.phase).toBe('rolling'));
    const first = thrown(line);

    callDiceThrow({ messageIdentifier: line.identifier }, 'here');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(thrown(line)).toBe(first);
  });

  it('throws nothing for a line said long enough ago, as one handed over on coming back to the room', async () => {
    const line = answer({ timestamp: Date.now() - JUST_ROLLED_MS - 1000 });

    callDiceThrow({ messageIdentifier: line.identifier }, 'here');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(thrown(line)).toBeUndefined();
  });

  it('throws nothing while a replay plays the room back', async () => {
    setNetworkIsolated(true);
    const line = answer();

    callDiceThrow({ messageIdentifier: line.identifier }, 'here');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(thrown(line)).toBeUndefined();
  });

  it('throws a secret roll for the one who rolled it alone', async () => {
    const mine = answer({ secret: true });
    const theirs = answer({ secret: true, from: SOMEONE });

    callDiceThrow({ messageIdentifier: mine.identifier }, 'here');
    callDiceThrow({ messageIdentifier: theirs.identifier }, 'here');

    await vi.waitFor(() => expect(thrown(mine)?.phase).toBe('rolling'));
    expect(thrown(theirs)).toBeUndefined();
  });

  it('throws nothing for a line whispered between others, or in a tab this reader may not read', async () => {
    const whispered = answer({ from: SOMEONE, to: 'a-third-user' });
    const hiddenTab = new ChatTab();
    hiddenTab.initialize();
    hiddenTab.plCanView = false;
    const inHiddenTab = hiddenTab.addMessage({
      from: 'System-BCDice',
      originFrom: SOMEONE,
      text: '→ 3',
      timestamp: Date.now(),
      imageIdentifier: '',
      tag: 'system',
      name: '<BCDice>',
      dicebot: encodeDiceRollDetail({
        system: 'DiceBot',
        outcome: '',
        faces: [{ sides: 6, value: 3, kind: 'normal' }],
      }),
    });

    callDiceThrow({ messageIdentifier: whispered.identifier }, 'here');
    callDiceThrow({ messageIdentifier: inHiddenTab.identifier }, 'here');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(thrown(whispered)).toBeUndefined();
    expect(thrown(inHiddenTab)).toBeUndefined();
    hiddenTab.destroy();
  });

  it('throws nothing for a roll with no dice it can draw', async () => {
    const line = answer({ faces: [{ sides: 7, value: 3 }] });

    callDiceThrow({ messageIdentifier: line.identifier }, 'here');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(thrown(line)).toBeUndefined();
  });

  it('lays the dice down still, showing their numbers, for a reader who keeps the screen still', async () => {
    TestBed.inject(MotionService).setting.set('off');
    const line = answer({
      faces: [
        { sides: 6, value: 5 },
        { sides: 10, value: 10 },
      ],
    });

    callDiceThrow({ messageIdentifier: line.identifier }, 'here');

    await vi.waitFor(() => expect(thrown(line)?.phase).toBe('settled'));
    expect(thrown(line)?.still).toBe(true);
    expect(thrown(line)?.shown).toEqual(['5', '0']);
  });

  it('lays each die down with its number near enough upright to the reader', async () => {
    TestBed.inject(MotionService).setting.set('off');
    const line = answer({ faces: [6, 8, 10, 12, 20].map((sides) => ({ sides, value: 3 })) });

    callDiceThrow({ messageIdentifier: line.identifier }, 'here');

    await vi.waitFor(() => expect(thrown(line)?.phase).toBe('settled'));
    const { dice, result } = thrown(line)!;
    dice.forEach((die, index) => {
      const at = index * 7 + 3;
      const rest: Quat = [result!.frames[at], result!.frames[at + 1], result!.frames[at + 2], result!.frames[at + 3]];
      const [x, y] = quatRotate(rest, faceFramesOf(die.shape)[die.target].up);
      expect(Math.abs(Math.atan2(-x, y))).toBeLessThan(0.2);
    });
  });

  it(`tumbles no more than ${MAX_TUMBLING} rolls at once and lays the rest down still`, async () => {
    const lines = Array.from({ length: MAX_TUMBLING + 1 }, () => answer());

    for (const line of lines) callDiceThrow({ messageIdentifier: line.identifier }, 'here');

    await vi.waitFor(() => expect(lines.every((line) => thrown(line)?.result)).toBe(true));
    expect(lines.map((line) => thrown(line)?.still)).toEqual([...Array(MAX_TUMBLING).fill(false), true]);
  });

  it(`keeps the last ${KEPT_THROWS} throws and lets older ones go`, async () => {
    TestBed.inject(MotionService).setting.set('off');
    const lines = Array.from({ length: KEPT_THROWS + 2 }, () => answer());

    for (const line of lines) callDiceThrow({ messageIdentifier: line.identifier }, 'here');

    await vi.waitFor(() => expect(thrown(lines[lines.length - 1])?.phase).toBe('settled'));
    expect(service.throws().size).toBe(KEPT_THROWS);
    expect(thrown(lines[0])).toBeUndefined();
  });

  it('puts a throw away when its dice cannot be drawn', async () => {
    const line = answer();
    callDiceThrow({ messageIdentifier: line.identifier }, 'here');
    await vi.waitFor(() => expect(thrown(line)?.phase).toBe('rolling'));

    service.fail(line.identifier);

    expect(thrown(line)?.phase).toBe('failed');
  });

  describe('on the table', () => {
    beforeEach(() => {
      Config.instance.diceStage = 'table';
    });

    it('throws the dice on the tray the table gives them, before the piece that spoke', async () => {
      const line = answer({ faces: [{ sides: 6, value: 4 }] });

      callDiceThrow({ messageIdentifier: line.identifier, speakerIdentifier: 'goblin' }, 'here');

      await vi.waitFor(() => expect(thrown(line)?.phase).toBe('rolling'));
      expect(thrown(line)?.stage).toBe('table');
      expect(thrown(line)?.placement).toBe(placement);
      expect(thrown(line)?.tray).toEqual(placement!.tray);
      expect(thrown(line)?.shown).toEqual(['4']);
      expect(placedFor).toEqual(['goblin']);
    });

    it('puts nothing on the table for a reader who keeps the screen still', async () => {
      TestBed.inject(MotionService).setting.set('off');
      const line = answer();

      callDiceThrow({ messageIdentifier: line.identifier }, 'here');
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(thrown(line)).toBeUndefined();
    });

    it('throws nothing when no table is on show', async () => {
      placement = null;
      const line = answer();

      callDiceThrow({ messageIdentifier: line.identifier }, 'here');
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(thrown(line)).toBeUndefined();
    });
  });
});
