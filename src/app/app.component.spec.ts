import { TestBed } from '@angular/core/testing';
import { AppComponent } from '@axe/app.component';
import { ObjectStore } from '@axe/core/sync/object-store';
import { PeerCursor } from '@axe/domain/peer/peer-cursor';
import { menuCommandOf } from '@axe/domain/ui/menu-command';
import { MenuCommandService } from '@axe/features/menu/menu-command.service';
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
