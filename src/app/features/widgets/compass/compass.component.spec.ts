import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiSignalService } from '@axe/application/ui/ui-signal.service';
import { WidgetVisibilityService } from '@axe/application/ui/widget-visibility.service';
import { CompassComponent } from '@axe/features/widgets/compass/compass.component';
import { TEST_PROVIDERS } from '@axe/testing/test-providers';

describe('CompassComponent', () => {
  let fixture: ComponentFixture<CompassComponent>;
  let widgets: WidgetVisibilityService;
  let uiSignal: UiSignalService;

  function query<T extends HTMLElement>(testId: string): T | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function turnTableTo(degrees: number): void {
    uiSignal.notifyTableViewRotation(50, 0, degrees);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompassComponent],
      providers: [...TEST_PROVIDERS],
    }).compileComponents();
    widgets = TestBed.inject(WidgetVisibilityService);
    uiSignal = TestBed.inject(UiSignalService);
    widgets.compass.set(true);
    fixture = TestBed.createComponent(CompassComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('ui-widgets');
  });

  it('is drawn only for a seat that asked for it', () => {
    expect(query('compass-widget')).toBeTruthy();

    widgets.compass.set(false);
    fixture.detectChanges();

    expect(query('compass-widget')).toBeNull();
  });

  it('turns its rose with the table, so north on the table is north on the compass', () => {
    turnTableTo(0);
    expect(query('compass-rose')!.dataset['angle']).toBe('0');

    turnTableTo(90);
    expect(query('compass-rose')!.dataset['angle']).toBe('90');
  });

  it('brings the rose back round rather than counting on past a turn', () => {
    turnTableTo(-90);

    expect(query('compass-rose')!.dataset['angle']).toBe('270');
  });

  it('says which way the top of the screen looks, and what it is called', () => {
    turnTableTo(0);
    expect(query('compass-bearing')!.textContent!.trim()).toBe('0° 北');

    turnTableTo(90);
    expect(query('compass-bearing')!.textContent!.trim()).toBe('270° 西');
  });

  it('puts itself away when it is closed', () => {
    query<HTMLButtonElement>('compass-close')!.click();
    fixture.detectChanges();

    expect(widgets.compass()).toBe(false);
    expect(query('compass-widget')).toBeNull();
  });
});
