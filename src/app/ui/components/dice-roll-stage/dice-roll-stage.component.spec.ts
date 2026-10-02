import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiceRenderService } from '@axe/application/dice/dice-render.service';
import { DiceFrame, DiceThrow, DiceThrowService } from '@axe/application/dice/dice-throw.service';
import { TEST_PROVIDERS } from '@axe/testing/test-providers';
import { DiceRollStageComponent } from '@axe/ui/components/dice-roll-stage/dice-roll-stage.component';

function throwOf(id: string, change: Partial<DiceThrow> = {}): DiceThrow {
  return {
    key: id,
    messageIdentifier: id,
    stage: 'frame',
    placement: null,
    dice: [
      { shape: 'd20', labels: 'standard', target: 0, shows: '17' },
      { shape: 'd6', labels: 'standard', target: 0, shows: '2' },
    ],
    overflow: 0,
    color: '#3b5bdb',
    tray: { halfWidth: 8, halfDepth: 2.4 },
    aspect: 10 / 3,
    phase: 'rolling',
    result: null,
    startedAt: 0,
    still: false,
    shown: ['17', '2'],
    outcome: '',
    ...change,
  };
}

/** Stands in for the browser's watch on what is in view, told by the test when that changes. */
class StandInIntersectionObserver {
  static made: StandInIntersectionObserver[] = [];
  private readonly targets: Element[] = [];

  constructor(private readonly callback: IntersectionObserverCallback) {
    StandInIntersectionObserver.made.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  disconnect(): void {
    this.targets.length = 0;
  }

  tell(inView: boolean): void {
    if (this.targets.length < 1) return;
    const entries = this.targets.map((target) => ({ target, isIntersecting: inView }) as IntersectionObserverEntry);
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

describe('DiceRollStageComponent', () => {
  let throws: ReturnType<typeof signal<ReadonlyMap<string, DiceThrow>>>;
  let waiting: ReturnType<typeof signal<ReadonlySet<string>>>;
  let stills: string[];
  let registered: { canvas: HTMLCanvasElement; id: string; released: boolean }[];
  let view: { IntersectionObserver: unknown };
  let observerBefore: unknown;

  function frameOf(id: string): DiceFrame | null {
    const diceThrow = throws().get(id);
    if (diceThrow)
      return diceThrow.phase === 'failed'
        ? null
        : { aspect: diceThrow.aspect, overflow: diceThrow.overflow, diceThrow };
    return waiting().has(id) ? { aspect: 4, overflow: 0, diceThrow: null } : null;
  }

  function mount(id: string) {
    const fixture = TestBed.createComponent(DiceRollStageComponent);
    fixture.componentRef.setInput('messageIdentifier', id);
    fixture.detectChanges();
    return fixture;
  }

  async function scrolled(fixture: ComponentFixture<DiceRollStageComponent>, inView: boolean): Promise<void> {
    await fixture.whenStable();
    for (const observer of StandInIntersectionObserver.made) observer.tell(inView);
    await fixture.whenStable();
  }

  function stageOf(fixture: ComponentFixture<DiceRollStageComponent>): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="dice-roll-stage"]');
  }

  beforeEach(() => {
    throws = signal<ReadonlyMap<string, DiceThrow>>(new Map());
    waiting = signal<ReadonlySet<string>>(new Set());
    stills = [];
    registered = [];
    StandInIntersectionObserver.made = [];
    view = document.defaultView as unknown as { IntersectionObserver: unknown };
    observerBefore = view.IntersectionObserver;
    view.IntersectionObserver = StandInIntersectionObserver;
    TestBed.configureTestingModule({
      imports: [DiceRollStageComponent],
      providers: [
        ...TEST_PROVIDERS,
        { provide: DiceThrowService, useValue: { throws, frameOf, showStill: (id: string) => stills.push(id) } },
        {
          provide: DiceRenderService,
          useValue: {
            register: (canvas: HTMLCanvasElement, id: string) => {
              const entry = { canvas, id, released: false };
              registered.push(entry);
              return { resize: () => undefined, release: () => (entry.released = true) };
            },
          },
        },
      ],
    });
  });

  afterEach(() => {
    view.IntersectionObserver = observerBefore;
  });

  it('shows nothing for a line with no dice to show', async () => {
    const fixture = mount('quiet');
    await scrolled(fixture, true);

    expect(stageOf(fixture)).toBeNull();
    expect(registered).toEqual([]);
    expect(stills).toEqual([]);
  });

  it('shows the throw of its line in the shape of its tray, and puts its canvas on the stage once in view', async () => {
    throws.set(new Map([['line', throwOf('line')]]));
    const fixture = mount('line');
    await fixture.whenStable();
    expect(registered).toEqual([]);

    await scrolled(fixture, true);

    const stage = stageOf(fixture)!;
    expect(stage.dataset['state']).toBe('rolling');
    expect(stage.dataset['shown']).toBe('17 2');
    expect(stage.style.aspectRatio).not.toBe('');
    expect(registered).toHaveLength(1);
    expect(registered[0].id).toBe('line');
    expect(registered[0].canvas).toBe(stage.querySelector('canvas'));
  });

  it('takes the canvas off the stage and gives its picture back once scrolled out of view, and puts it back on its return', async () => {
    throws.set(new Map([['line', throwOf('line', { phase: 'settled' })]]));
    const fixture = mount('line');
    await scrolled(fixture, true);
    const canvas = registered[0].canvas;
    canvas.width = 640;
    canvas.height = 160;

    await scrolled(fixture, false);

    expect(registered[0].released).toBe(true);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);

    await scrolled(fixture, true);

    expect(registered).toHaveLength(2);
    expect(registered[1].canvas).toBe(canvas);
    expect(registered[1].released).toBe(false);
  });

  it('keeps the room for a line whose dice are not here yet, and has them laid down once it is in view', async () => {
    waiting.set(new Set(['line']));
    const fixture = mount('line');
    await fixture.whenStable();

    expect(stageOf(fixture)?.dataset['state']).toBe('waiting');
    expect(stills).toEqual([]);

    await scrolled(fixture, true);

    expect(stills).toEqual(['line']);
  });

  it('does not have the dice of a line laid down that are already thrown', async () => {
    throws.set(new Map([['line', throwOf('line')]]));
    const fixture = mount('line');
    await scrolled(fixture, true);

    expect(stills).toEqual([]);
  });

  it('counts the dice of a roll too large to throw them all', async () => {
    throws.set(new Map([['line', throwOf('line', { overflow: 7 })]]));
    const fixture = mount('line');
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('+7');
  });

  it('follows the throw as it comes to rest, keeping the same canvas', async () => {
    throws.set(new Map([['line', throwOf('line')]]));
    const fixture = mount('line');
    await scrolled(fixture, true);

    throws.set(new Map([['line', throwOf('line', { phase: 'settled' })]]));
    await fixture.whenStable();

    expect(stageOf(fixture)?.dataset['state']).toBe('settled');
    expect(registered).toHaveLength(1);
    expect(registered[0].released).toBe(false);
  });

  it('puts the stage away when the dice cannot be drawn', async () => {
    throws.set(new Map([['line', throwOf('line')]]));
    const fixture = mount('line');
    await scrolled(fixture, true);

    throws.set(new Map([['line', throwOf('line', { phase: 'failed' })]]));
    await fixture.whenStable();

    expect(stageOf(fixture)).toBeNull();
    expect(registered[0].released).toBe(true);
  });

  it('takes its canvas off the stage when it goes', async () => {
    throws.set(new Map([['line', throwOf('line')]]));
    const fixture = mount('line');
    await scrolled(fixture, true);

    fixture.destroy();

    expect(registered[0].released).toBe(true);
  });
});
