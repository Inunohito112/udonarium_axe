import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DiceRenderService } from '@axe/application/dice/dice-render.service';
import { DiceThrow, DiceThrowService } from '@axe/application/dice/dice-throw.service';
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

describe('DiceRollStageComponent', () => {
  let throws: ReturnType<typeof signal<ReadonlyMap<string, DiceThrow>>>;
  let registered: { canvas: HTMLCanvasElement; id: string; released: boolean }[];

  function mount(id: string) {
    const fixture = TestBed.createComponent(DiceRollStageComponent);
    fixture.componentRef.setInput('messageIdentifier', id);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    throws = signal<ReadonlyMap<string, DiceThrow>>(new Map());
    registered = [];
    TestBed.configureTestingModule({
      imports: [DiceRollStageComponent],
      providers: [
        ...TEST_PROVIDERS,
        { provide: DiceThrowService, useValue: { throws } },
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

  it('shows nothing for a line whose dice are not being thrown here', () => {
    const fixture = mount('quiet');

    expect(fixture.nativeElement.querySelector('[data-testid="dice-roll-stage"]')).toBeNull();
    expect(registered).toEqual([]);
  });

  it('shows the throw of its line, in the shape of its tray, and puts its canvas on the stage', async () => {
    throws.set(new Map([['line', throwOf('line')]]));
    const fixture = mount('line');
    await fixture.whenStable();

    const stage: HTMLElement = fixture.nativeElement.querySelector('[data-testid="dice-roll-stage"]');
    expect(stage.dataset['state']).toBe('rolling');
    expect(stage.dataset['shown']).toBe('17 2');
    expect(stage.style.aspectRatio).not.toBe('');
    expect(registered).toHaveLength(1);
    expect(registered[0].id).toBe('line');
    expect(registered[0].canvas).toBe(stage.querySelector('canvas'));
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
    await fixture.whenStable();

    throws.set(new Map([['line', throwOf('line', { phase: 'settled' })]]));
    await fixture.whenStable();

    const stage: HTMLElement = fixture.nativeElement.querySelector('[data-testid="dice-roll-stage"]');
    expect(stage.dataset['state']).toBe('settled');
    expect(registered).toHaveLength(1);
    expect(registered[0].released).toBe(false);
  });

  it('puts the stage away when the dice cannot be drawn', async () => {
    throws.set(new Map([['line', throwOf('line')]]));
    const fixture = mount('line');
    await fixture.whenStable();

    throws.set(new Map([['line', throwOf('line', { phase: 'failed' })]]));
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="dice-roll-stage"]')).toBeNull();
    expect(registered[0].released).toBe(true);
  });

  it('takes its canvas off the stage when it goes', async () => {
    throws.set(new Map([['line', throwOf('line')]]));
    const fixture = mount('line');
    await fixture.whenStable();

    fixture.destroy();

    expect(registered[0].released).toBe(true);
  });
});
