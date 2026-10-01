import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  DICE_ENGINE_LOADER,
  DiceEngine,
  DiceRenderService,
  LATE_START_MS,
  TABLE_FADE_SECONDS,
  TABLE_HOLD_SECONDS,
} from '@axe/application/dice/dice-render.service';
import { DiceThrow, DiceThrowService } from '@axe/application/dice/dice-throw.service';
import { CoordinateService } from '@axe/application/input/coordinate.service';
import { Matrix3D } from '@axe/core/transform/matrix-3d';
import { Config } from '@axe/domain/peer/config';
import type { PreparedThrow } from '@axe/infrastructure/dice-3d/dice-3d-engine';
import { TEST_PROVIDERS } from '@axe/testing/test-providers';

const ROLL_SECONDS = 1;

/** An engine that draws nothing and remembers what it was asked to draw. */
class StandInEngine {
  readonly canvas = document.createElement('canvas');
  isLost = false;
  readonly drawn: { id: string; seconds: number; width: number; kind: string }[] = [];
  disposed = false;

  readonly accents: string[] = [];

  prepare(draw: { color: string; accent?: string }): PreparedThrow {
    this.accents.push(draw.accent ?? '');
    return {
      totalSeconds: ROLL_SECONDS,
      restSeconds: ROLL_SECONDS,
      endSeconds: ROLL_SECONDS,
      id: draw.color,
    } as unknown as PreparedThrow;
  }

  render(prepared: PreparedThrow, seconds: number, view: { kind: string }, size: { width: number; height: number }) {
    this.drawn.push({ id: (prepared as unknown as { id: string }).id, seconds, width: size.width, kind: view.kind });
    return { x: 0, y: 0, width: size.width, height: size.height };
  }

  dispose(): void {
    this.disposed = true;
  }
}

function throwOf(id: string, change: Partial<DiceThrow> = {}): DiceThrow {
  return {
    messageIdentifier: id,
    stage: 'frame',
    placement: null,
    dice: [{ shape: 'd6', labels: 'standard', target: 0, shows: '1' }],
    overflow: 0,
    color: id,
    tray: { halfWidth: 8, halfDepth: 2.4 },
    aspect: 10 / 3,
    phase: 'rolling',
    result: {
      frameCount: 61,
      restFrame: 50,
      frames: new Float32Array(),
      landed: [0],
      corrections: [],
      attempt: 0,
      fault: null,
    },
    startedAt: 0,
    still: false,
    shown: ['1'],
    outcome: '',
    ...change,
  };
}

describe('DiceRenderService', () => {
  let frames: FrameRequestCallback[];
  let throws: ReturnType<typeof signal<ReadonlyMap<string, DiceThrow>>>;
  let failed: string[];
  let played: [string, number][];
  let engine: StandInEngine;
  let loads: number;
  let service: DiceRenderService;

  async function nextFrame(at: number): Promise<void> {
    await Promise.resolve();
    TestBed.tick();
    const due = frames.splice(0);
    for (const callback of due) callback(at);
    await Promise.resolve();
  }

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    throws = signal<ReadonlyMap<string, DiceThrow>>(new Map());
    failed = [];
    played = [];
    engine = new StandInEngine();
    loads = 0;
    TestBed.configureTestingModule({
      providers: [
        ...TEST_PROVIDERS,
        {
          provide: DiceThrowService,
          useValue: {
            throws,
            fail: (id: string) => failed.push(id),
            played: (id: string, at: number) => played.push([id, at]),
          },
        },
        {
          provide: CoordinateService,
          useValue: { tabletopTransformVersion: signal(0), tabletopSceneMatrix: () => new Matrix3D() },
        },
        {
          provide: DICE_ENGINE_LOADER,
          useValue: () => {
            loads++;
            return Promise.resolve(engine as unknown as DiceEngine);
          },
        },
      ],
    });
    service = TestBed.inject(DiceRenderService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the engine only once a throw is put on show', async () => {
    throws.set(new Map([['a', throwOf('a')]]));
    await nextFrame(0);
    expect(loads).toBe(0);

    service.register(document.createElement('canvas'), 'a').resize(300, 90);
    await nextFrame(0);
    await nextFrame(16);

    expect(loads).toBe(1);
  });

  it('readies the engine in a quiet moment once the room shows its dice, before any roll', async () => {
    const before = Config.instance.diceStage;
    try {
      TestBed.tick();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(loads).toBe(0);

      Config.instance.diceStage = 'frame';
      TestBed.tick();

      await vi.waitFor(() => expect(loads).toBe(1));
    } finally {
      Config.instance.diceStage = before;
    }
  });

  it('draws a tumbling throw frame after frame, from when it began, and stops once it is at rest', async () => {
    throws.set(new Map([['a', throwOf('a', { startedAt: 1000 })]]));
    service.register(document.createElement('canvas'), 'a').resize(300, 90);
    await nextFrame(1000);
    await nextFrame(1000);

    await nextFrame(1500);
    await nextFrame(2500);
    await nextFrame(3000);

    expect(engine.drawn.map((d) => d.seconds)).toEqual([0, 0.5, ROLL_SECONDS]);
    expect(frames).toHaveLength(0);
  });

  it('plays a throw from the first frame it is drawn in, though the engine was still loading when it was worked out', async () => {
    throws.set(new Map([['a', throwOf('a', { startedAt: 0 })]]));
    service.register(document.createElement('canvas'), 'a').resize(300, 90);
    await nextFrame(0);
    await nextFrame(3000);
    await nextFrame(3400);

    expect(engine.drawn.map((d) => d.seconds)).toEqual([0, 0.4]);
  });

  it('tells the throws when one began to play, so it comes to rest when its dice do on the screen', async () => {
    throws.set(new Map([['a', throwOf('a', { startedAt: 0 })]]));
    service.register(document.createElement('canvas'), 'a').resize(300, 90);
    await nextFrame(0);
    await nextFrame(2500);
    await nextFrame(2600);

    expect(played).toEqual([['a', 2500]]);
  });

  it('flashes the dice of a critical or a fumble, and no other roll', async () => {
    throws.set(
      new Map([
        ['a', throwOf('a', { outcome: 'critical' })],
        ['b', throwOf('b', { outcome: 'fumble' })],
        ['c', throwOf('c', { outcome: 'success' })],
      ])
    );
    for (const id of ['a', 'b', 'c']) service.register(document.createElement('canvas'), id).resize(300, 90);
    await nextFrame(0);
    await nextFrame(16);

    expect(engine.accents).toEqual(['critical', 'fumble', '']);
  });

  it('shows a throw first drawn long after it was worked out at rest, without throwing it again', async () => {
    throws.set(new Map([['a', throwOf('a', { startedAt: 0 })]]));
    service.register(document.createElement('canvas'), 'a').resize(300, 90);
    await nextFrame(0);
    await nextFrame(LATE_START_MS + 500);

    expect(engine.drawn.map((d) => d.seconds)).toEqual([ROLL_SECONDS]);
    expect(frames).toHaveLength(0);
  });

  it('draws a throw once for every canvas it is on show on', async () => {
    throws.set(new Map([['a', throwOf('a', { startedAt: 0 })]]));
    service.register(document.createElement('canvas'), 'a').resize(300, 90);
    service.register(document.createElement('canvas'), 'a').resize(420, 126);
    await nextFrame(0);
    await nextFrame(100);

    expect(engine.drawn).toHaveLength(1);
    expect(engine.drawn[0].width).toBe(420);
  });

  it('draws a throw at rest once, and again only when it changes', async () => {
    throws.set(new Map([['a', throwOf('a', { phase: 'settled', still: true })]]));
    service.register(document.createElement('canvas'), 'a').resize(300, 90);
    await nextFrame(0);
    await nextFrame(16);
    await nextFrame(32);
    expect(engine.drawn).toHaveLength(1);

    throws.set(new Map([['a', throwOf('a', { phase: 'settled', still: true, shown: ['2'] })]]));
    await nextFrame(48);

    expect(engine.drawn).toHaveLength(2);
  });

  it('draws nothing for a canvas taken off the stage', async () => {
    throws.set(new Map([['a', throwOf('a', { startedAt: 0 })]]));
    const handle = service.register(document.createElement('canvas'), 'a');
    handle.resize(300, 90);
    handle.release();
    await nextFrame(0);
    await nextFrame(16);

    expect(engine.drawn).toHaveLength(0);
  });

  it('puts every throw away when the engine cannot start', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ...TEST_PROVIDERS,
        { provide: DiceThrowService, useValue: { throws, fail: (id: string) => failed.push(id) } },
        { provide: DICE_ENGINE_LOADER, useValue: () => Promise.reject(new Error('no WebGL')) },
      ],
    });
    service = TestBed.inject(DiceRenderService);
    throws.set(new Map([['a', throwOf('a')]]));
    service.register(document.createElement('canvas'), 'a').resize(300, 90);

    await nextFrame(0);
    await vi.waitFor(() => expect(failed).toEqual(['a']));
  });

  it('puts every throw away when the engine loses its drawing context', async () => {
    throws.set(new Map([['a', throwOf('a')]]));
    service.register(document.createElement('canvas'), 'a').resize(300, 90);
    await nextFrame(0);
    await nextFrame(16);
    engine.isLost = true;

    await nextFrame(32);

    expect(failed).toEqual(['a']);
  });

  describe('on the table', () => {
    /** The sheet over the table, as large as the screen of the test. */
    function sheet(): HTMLCanvasElement {
      const canvas = document.createElement('canvas');
      canvas.getBoundingClientRect = () =>
        ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }) as DOMRect;
      // The test's document draws nothing on a canvas; this one takes the strokes and keeps none.
      const context = { clearRect: () => undefined, drawImage: () => undefined, globalAlpha: 1 };
      canvas.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
      service.registerTable(canvas).resize(800, 600);
      return canvas;
    }

    function onTable(id: string, change: Partial<DiceThrow> = {}): DiceThrow {
      return throwOf(id, {
        stage: 'table',
        placement: {
          model: [20, 0, 0, 0, 0, -20, 0, 0, 0, 0, 20, 0, 400, 300, 0, 1],
          tray: { halfWidth: 4, halfDepth: 3 },
        },
        tray: { halfWidth: 4, halfDepth: 3 },
        ...change,
      });
    }

    it('draws a throw on the table with the table’s own view, and leaves the line frames to theirs', async () => {
      sheet();
      throws.set(new Map([['a', onTable('a', { startedAt: 0 })]]));
      service.register(document.createElement('canvas'), 'a').resize(300, 90);
      await nextFrame(0);
      await nextFrame(100);

      expect(engine.drawn.map((d) => d.kind)).toEqual(['table']);
    });

    it('keeps the dice on the table a while after they stop, then lets them fade and stops drawing', async () => {
      sheet();
      throws.set(new Map([['a', onTable('a', { startedAt: 0, phase: 'settled' })]]));
      await nextFrame(0);
      await nextFrame(100);
      // It began to play in the first frame it was drawn in.
      const end = 100 + (ROLL_SECONDS + TABLE_HOLD_SECONDS + TABLE_FADE_SECONDS) * 1000;

      await nextFrame(end - 100);
      const drawnBefore = engine.drawn.length;
      expect(frames).toHaveLength(1);
      await nextFrame(end + 10);

      expect(engine.drawn).toHaveLength(drawnBefore);
      expect(frames).toHaveLength(0);
    });

    it('draws nothing for a tray that lies off the screen', async () => {
      sheet();
      throws.set(
        new Map([
          [
            'a',
            onTable('a', {
              placement: {
                model: [20, 0, 0, 0, 0, -20, 0, 0, 0, 0, 20, 0, 5000, 5000, 0, 1],
                tray: { halfWidth: 4, halfDepth: 3 },
              },
            }),
          ],
        ])
      );
      await nextFrame(0);
      await nextFrame(100);

      expect(engine.drawn).toHaveLength(0);
    });
  });
});
