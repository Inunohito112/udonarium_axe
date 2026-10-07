import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PersonalVolumeService } from '@axe/application/media/personal-volume.service';
import { AudioPlayer } from '@axe/core/storage/audio-player';
import { ObjectStore } from '@axe/core/sync/object-store';
import { ChatTabList } from '@axe/domain/chat/chat-tab-list';
import { Config } from '@axe/domain/peer/config';
import { PeerCursor } from '@axe/domain/peer/peer-cursor';
import { PeerRole } from '@axe/domain/peer/peer-role';
import { SoundSettingsPanelComponent } from '@axe/features/sound-settings/sound-settings-panel/sound-settings-panel.component';
import { TEST_PROVIDERS } from '@axe/testing/test-providers';

describe('SoundSettingsPanelComponent', () => {
  let fixture: ComponentFixture<SoundSettingsPanelComponent>;

  const root = () => fixture.nativeElement as HTMLElement;
  const slider = (name: string) => root().querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const row = (kind: string) => root().querySelector<HTMLElement>(`[data-testid="sound-settings-row-${kind}"]`)!;

  async function open(role: PeerRole = PeerRole.Player): Promise<void> {
    TestBed.configureTestingModule({ imports: [SoundSettingsPanelComponent], providers: [...TEST_PROVIDERS] });
    PeerCursor.createMyCursor();
    PeerCursor.myCursor.role = role;
    if (!ObjectStore.instance.get<Config>('Config')) new Config('Config').initialize();
    fixture = TestBed.createComponent(SoundSettingsPanelComponent);
    await fixture.whenStable();
  }

  beforeEach(() => {
    vi.spyOn(AudioPlayer, 'setChannelVolume').mockImplementation(() => {});
  });

  afterEach(() => {
    (ChatTabList as unknown as { _instance: ChatTabList | undefined })._instance = undefined;
    vi.restoreAllMocks();
  });

  it('lists every kind of sound the listener sets, music first and the leftover effects last', async () => {
    await open();

    const names = [
      ...root().querySelectorAll<HTMLInputElement>('[data-testid="sound-settings-own"] input[type="range"]'),
    ].map((input) => input.name);

    expect(names).toEqual([
      'audition-volume',
      'bgm-volume',
      'background-volume',
      'cut-in-volume',
      'notification-volume',
      'handling-volume',
      'effect-volume',
      'se-volume',
    ]);
  });

  it('sets the listener’s own volume for a kind from its slider', async () => {
    await open();

    slider('handling-volume').value = '0.2';
    slider('handling-volume').dispatchEvent(new Event('input'));

    expect(TestBed.inject(PersonalVolumeService).get('handling')).toBe(0.2);
  });

  it('turns a kind off and back on from the button beside it', async () => {
    await open();
    const volumes = TestBed.inject(PersonalVolumeService);
    const mute = () => row('notification').querySelector<HTMLButtonElement>('[data-testid="volume-row-mute"]')!;

    mute().click();
    await fixture.whenStable();
    expect(volumes.isMuted('notification')).toBe(true);
    expect(mute().getAttribute('aria-pressed')).toBe('true');

    mute().click();
    await fixture.whenStable();
    expect(volumes.isMuted('notification')).toBe(false);
  });

  it('holds the chat note’s settings', async () => {
    await open();

    expect(root().querySelector('[data-testid="sound-settings-chat"] ui-chat-sound-settings')).not.toBeNull();
  });

  it('shows the room volume to a player without letting them move it', async () => {
    await open(PeerRole.Player);

    expect(slider('room-volume').disabled).toBe(true);
  });

  it('lets the game master move the room volume for everyone', async () => {
    await open(PeerRole.GameMaster);

    slider('room-volume').value = '1.5';
    slider('room-volume').dispatchEvent(new Event('input'));

    expect(slider('room-volume').disabled).toBe(false);
    expect(ObjectStore.instance.get<Config>('Config')!.roomVolume).toBe(1.5);
  });
});
