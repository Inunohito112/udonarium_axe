import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ObjectChangeService } from '@axe/application/sync/object-change.service';
import { TabletopService } from '@axe/application/tabletop/tabletop.service';
import { MotionService } from '@axe/application/ui/motion.service';
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

  function roseAngle(): number {
    return Number(query('compass-rose')!.dataset['angle']);
  }

  /** Where the rose points, whatever it has been wound round to. */
  function rosePointsAt(): number {
    return ((roseAngle() % 360) + 360) % 360;
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
    TestBed.inject(MotionService).setting.set('on');
    widgets.compass.set(true);
    fixture = TestBed.createComponent(CompassComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem('ui-widgets');
    localStorage.removeItem('ui-motion');
  });

  it('is drawn only for a seat that asked for it', () => {
    expect(query('compass-widget')).toBeTruthy();

    widgets.compass.set(false);
    fixture.detectChanges();

    expect(query('compass-widget')).toBeNull();
  });

  it('turns its rose with the table, so north on the table is north on the compass', () => {
    turnTableTo(0);
    expect(roseAngle()).toBe(0);

    turnTableTo(90);
    expect(roseAngle()).toBe(90);
  });

  it('crosses north the short way rather than winding most of a turn the other way', () => {
    turnTableTo(5);
    const before = roseAngle();

    turnTableTo(-5);

    expect(roseAngle()).toBe(before - 10);
  });

  it('points where the table points however far round it has been wound', () => {
    turnTableTo(-5);
    expect(rosePointsAt()).toBe(355);

    turnTableTo(725);
    expect(rosePointsAt()).toBe(5);
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

describe('CompassComponent under a magnetic anomaly', () => {
  let fixture: ComponentFixture<CompassComponent>;
  let tabletop: TabletopService;
  let motion: MotionService;

  function query<T extends HTMLElement>(testId: string): T | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function roseAngle(): number {
    return Number(query('compass-rose')!.dataset['angle']);
  }

  function setAnomaly(anomalous: boolean): void {
    tabletop.currentTable.magneticAnomaly = anomalous;
    TestBed.inject(ObjectChangeService).notifyChanged(tabletop.currentTable.identifier);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [CompassComponent],
      providers: [...TEST_PROVIDERS],
    }).compileComponents();
    TestBed.inject(WidgetVisibilityService).compass.set(true);
    tabletop = TestBed.inject(TabletopService);
    motion = TestBed.inject(MotionService);
    motion.setting.set('on');
    fixture = TestBed.createComponent(CompassComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem('ui-widgets');
    localStorage.removeItem('ui-motion');
  });

  it('says the reading is worth nothing rather than showing a bearing', () => {
    expect(query('compass-bearing')).toBeTruthy();

    setAnomaly(true);

    expect(query('compass-bearing')).toBeNull();
    expect(query('compass-anomaly')).toBeTruthy();
  });

  it('sets the needle wandering, and it does not come to rest', () => {
    setAnomaly(true);
    const start = roseAngle();

    vi.advanceTimersByTime(3000);
    fixture.detectChanges();

    expect(roseAngle()).not.toBe(start);
  });

  it('gives the needle back to the table once the field is left behind', () => {
    setAnomaly(true);
    vi.advanceTimersByTime(3000);
    fixture.detectChanges();

    setAnomaly(false);

    expect(((roseAngle() % 360) + 360) % 360).toBeCloseTo(10, 6);
  });

  it('leaves the needle where north is for a seat that asked for less movement', () => {
    motion.setting.set('off');
    fixture.detectChanges();

    setAnomaly(true);
    const start = roseAngle();
    vi.advanceTimersByTime(3000);
    fixture.detectChanges();

    expect(roseAngle()).toBe(start);
    expect(query('compass-anomaly')).toBeTruthy();
  });
});
