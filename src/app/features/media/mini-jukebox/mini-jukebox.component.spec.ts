import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AudioFile } from '@axe/core/storage/audio-file';
import { AudioStorage } from '@axe/core/storage/audio-storage';
import { LoopPlayer } from '@axe/core/storage/loop-player';
import { ObjectStore } from '@axe/core/sync/object-store';
import { AUDIO_TAG_BGS, AudioTag } from '@axe/domain/media/audio-tag';
import { BackgroundSound } from '@axe/domain/media/background-sound';
import { Jukebox } from '@axe/domain/media/jukebox';
import { MiniJukeboxComponent } from '@axe/features/media/mini-jukebox/mini-jukebox.component';
import { TEST_PROVIDERS } from '@axe/testing/test-providers';

function addBackgroundSound(identifier: string, name: string): void {
  const audio = AudioFile.createEmpty(identifier);
  const context = (audio as unknown as { context: Record<string, unknown> }).context;
  context['blob'] = new Blob(['x']);
  context['url'] = 'blob:x';
  context['name'] = name;
  AudioStorage.instance.add(audio);
  AudioTag.create(identifier).tag = AUDIO_TAG_BGS;
}

describe('MiniJukeboxComponent', () => {
  let fixture: ComponentFixture<MiniJukeboxComponent>;

  const line = (): HTMLElement | null =>
    fixture.nativeElement.querySelector('[data-testid="mini-jukebox-background-sounds"]');

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MiniJukeboxComponent],
      providers: [...TEST_PROVIDERS],
    });
    if (!ObjectStore.instance.get<Jukebox>('Jukebox')) new Jukebox('Jukebox').initialize();
    vi.spyOn(LoopPlayer.prototype, 'start').mockImplementation(() => {});
    vi.spyOn(LoopPlayer.prototype, 'stop').mockImplementation(() => {});
    fixture = TestBed.createComponent(MiniJukeboxComponent);
  });

  afterEach(() => {
    AudioStorage.instance.audios.forEach((audio) => AudioStorage.instance.delete(audio.identifier));
    vi.restoreAllMocks();
  });

  describe('the line of background sounds', () => {
    it('is not shown while none is playing', async () => {
      await fixture.whenStable();

      expect(line()).toBeNull();
    });

    it('names the ones playing, in the order they were started', async () => {
      addBackgroundSound('rain', 'Rain');
      addBackgroundSound('fire', 'Campfire');
      BackgroundSound.start('rain')!.startedAt = 100;
      BackgroundSound.start('fire')!.startedAt = 200;
      await fixture.whenStable();

      expect(line()?.textContent).toContain('Rain · Campfire');
    });

    it('stops them all for the room, and goes', async () => {
      addBackgroundSound('rain', 'Rain');
      BackgroundSound.start('rain');
      await fixture.whenStable();

      line()!.querySelector<HTMLButtonElement>('[data-testid="mini-jukebox-background-stop-all"]')!.click();
      await fixture.whenStable();

      expect(BackgroundSound.playing()).toEqual([]);
      expect(line()).toBeNull();
    });
  });
});
