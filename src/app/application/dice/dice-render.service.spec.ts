import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DICE_ENGINE_LOADER, DiceEngine, DiceRenderService } from '@axe/application/dice/dice-render.service';
import { DiceThrow, DiceThrowService } from '@axe/application/dice/dice-throw.service';
import type { PreparedThrow } from '@axe/infrastructure/dice-3d/dice-3d-engine';
import { TEST_PROVIDERS } from '@axe/testing/test-providers';

const ROLL_SECONDS = 1;

/** An engine that draws nothing and remembers what it was asked to draw. */
class StandInEngine {
  readonly canvas = document.createElement('canvas');
  isLost = false;
  readonly drawn: { id: string; seconds: number; width: number }[] = [];
  disposed = false;

  prepare(draw: { color: string }): PreparedThrow {
    return { totalSeconds: ROLL_SECONDS, restSeconds: ROLL_SECONDS, id: draw.color } as unknown as PreparedThrow;
  }

  render(prepared: PreparedThrow, seconds: number, _view: unknown, size: { width: number }): void {
    this.drawn.push({ id: (prepared as unknown as { id: string }).id, seconds, width: size.width });
  }

  dispose(): void {
    this.disposed = true;
  }
}

function throwOf(id: string, change: Partial<DiceThrow> = {}): DiceThrow {
  return {
    messageIdentifier: id,
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
    ...change,
  };
}

describe('DiceRenderService', () => {
  let frames: FrameRequestCallback[];
  let throws: ReturnType<typeof signal<ReadonlyMap<string, DiceThrow>>>;
  let failed: string[];
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
    engine = new StandInEngine();
    loads = 0;
    TestBed.configureTestingModule({
      providers: [
        ...TEST_PROVIDERS,
        { provide: DiceThrowService, useValue: { throws, fail: (id: string) => failed.push(id) } },
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
});
