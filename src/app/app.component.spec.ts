import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from '@axe/app.component';
import { PointerDeviceService } from '@axe/application/input/pointer-device.service';
import { ConfirmService } from '@axe/application/ui/confirm.service';
import { ContextMenuService } from '@axe/application/ui/context-menu.service';
import { MenuLayoutService } from '@axe/application/ui/menu-layout.service';
import { ObjectStore } from '@axe/core/sync/object-store';
import { PeerCursor } from '@axe/domain/peer/peer-cursor';
import { PeerRole } from '@axe/domain/peer/peer-role';
import { MENU_SURFACES, menuCommandOf } from '@axe/domain/ui/menu-command';
import { MenuCommandService } from '@axe/features/menu/menu-command.service';
import { RoomPanelService } from '@axe/features/panels/room-panel.service';
import { TEST_PROVIDERS } from '@axe/testing/test-providers';
import { version } from '@pkg';

describe('AppComponent', () => {
  // Booting the screen brings the room's own objects into being — the chat tabs, the config,
  // the table selecter — which the next spec file in this worker would otherwise inherit.
  afterEach(() => {
    for (const object of ObjectStore.instance.getObjects()) ObjectStore.instance.remove(object);
    PeerCursor.myCursor = null!;
  });

  it('should be defined', () => {
    expect(AppComponent).toBeTruthy();
  });

  it('resolves the version string from package.json through the @pkg alias', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+(-.+)?$/);
  });

  describe('the way back into the menus', () => {
    let fixture: ComponentFixture<AppComponent>;

    /** Empties every menu, which is what somebody arranging one can do to themselves. */
    function emptyEveryMenu(): void {
      const layouts = TestBed.inject(MenuLayoutService);
      for (const surface of MENU_SURFACES) layouts.save(surface, { nodes: [] });
    }

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [AppComponent],
        providers: [...TEST_PROVIDERS],
      }).compileComponents();
      PeerCursor.createMyCursor().role = PeerRole.GameMaster;
      // A menu may not open where the pointer has moved since it was pressed, which is false
      // until something presses. Nothing here presses, so it is said outright.
      vi.spyOn(TestBed.inject(PointerDeviceService), 'isAllowedToOpenContextMenu', 'get').mockReturnValue(true);
      fixture = TestBed.createComponent(AppComponent);
      fixture.detectChanges();
    });

    afterEach(() => {
      for (const surface of MENU_SURFACES) TestBed.inject(MenuLayoutService).reset(surface);
      vi.restoreAllMocks();
    });

    it('is on the drawer button, which is no part of any arrangement', () => {
      emptyEveryMenu();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="fab-toggle"]')).toBeTruthy();
      expect(fixture.nativeElement.querySelectorAll('[data-testid^="fab-entry-"]').length).toBe(0);
    });

    it('offers the editor and a way to put every menu back, with nothing left on any of them', () => {
      emptyEveryMenu();
      fixture.detectChanges();
      const offered: string[] = [];
      vi.spyOn(TestBed.inject(ContextMenuService), 'open').mockImplementation(((
        _point: unknown,
        actions: { name: string }[]
      ) => {
        offered.push(...actions.map((action) => action.name));
      }) as never);

      const button: HTMLElement = fixture.nativeElement.querySelector('[data-testid="fab-toggle"]');
      button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

      expect(offered).toEqual(['メニューの編集', 'すべてのメニューを初期配置に戻す']);
    });

    it('opens the editor from there, whatever the arrangement says', () => {
      emptyEveryMenu();
      fixture.detectChanges();
      const opened: string[] = [];
      vi.spyOn(TestBed.inject(RoomPanelService), 'open').mockImplementation(((name: string) => {
        opened.push(name);
      }) as never);
      vi.spyOn(TestBed.inject(ContextMenuService), 'open').mockImplementation(((
        _point: unknown,
        actions: { action?: () => void }[]
      ) => {
        actions[0].action?.();
      }) as never);

      const button: HTMLElement = fixture.nativeElement.querySelector('[data-testid="fab-toggle"]');
      button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

      expect(opened).toEqual(['menuEditor']);
    });

    it('puts every menu back from there, once it is confirmed', async () => {
      emptyEveryMenu();
      fixture.detectChanges();
      const layouts = TestBed.inject(MenuLayoutService);
      expect(layouts.isArranged('fab')).toBe(true);
      vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(true);
      vi.spyOn(TestBed.inject(ContextMenuService), 'open').mockImplementation(((
        _point: unknown,
        actions: { action?: () => void }[]
      ) => {
        actions[1].action?.();
      }) as never);

      const button: HTMLElement = fixture.nativeElement.querySelector('[data-testid="fab-toggle"]');
      button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await fixture.whenStable();

      for (const surface of MENU_SURFACES) expect(layouts.isArranged(surface)).toBe(false);
    });
  });

  it('hands the menus the two things only the screen can do', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [...TEST_PROVIDERS],
    }).compileComponents();
    TestBed.createComponent(AppComponent);
    const commands = TestBed.inject(MenuCommandService);

    // `noHost` is what these two answer when nothing has handed the menus the screen, which is
    // a wiring that nothing else notices: every spec of the menus registers one of its own.
    expect(commands.run(menuCommandOf('zipLoad')!)).toBe('done');
    expect(commands.run(menuCommandOf('save')!)).toBe('done');
  });
});
