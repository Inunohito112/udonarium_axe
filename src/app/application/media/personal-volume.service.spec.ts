import { TestBed } from '@angular/core/testing';
import { PersonalVolumeService } from '@axe/application/media/personal-volume.service';
import {
  DEFAULT_PERSONAL_VOLUMES,
  parsePersonalVolumes,
  PERSONAL_VOLUME_STORAGE_KEY,
} from '@axe/application/media/personal-volumes';
import { AudioPlayer } from '@axe/core/storage/audio-player';
import { ObjectStore } from '@axe/core/sync/object-store';
import { Jukebox } from '@axe/domain/media/jukebox';
import { Config } from '@axe/domain/peer/config';
import { TEST_PROVIDERS } from '@axe/testing/test-providers';

/** A fresh service reading what this browser holds, as a page opened again would. */
function reopened(): PersonalVolumeService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [...TEST_PROVIDERS] });
  return TestBed.inject(PersonalVolumeService);
}

function channels() {
  return {
    audition: vi.spyOn(AudioPlayer, 'auditionVolume', 'set').mockImplementation(() => {}),
    bgm: vi.spyOn(AudioPlayer, 'volume', 'set').mockImplementation(() => {}),
    se: vi.spyOn(AudioPlayer, 'seVolume', 'set').mockImplementation(() => {}),
    background: vi.spyOn(AudioPlayer, 'backgroundVolume', 'set').mockImplementation(() => {}),
  };
}

describe('PersonalVolumeService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts every volume at half until the listener sets one', () => {
    channels();
    const volumes = reopened();

    expect(['audition', 'bgm', 'se', 'background'].map((kind) => volumes.get(kind as never))).toEqual([
      0.5, 0.5, 0.5, 0.5,
    ]);
  });

  it('remembers a volume in this browser, so it holds when the page is opened again', () => {
    channels();
    reopened().set('se', 0.2);
    reopened().set('background', 0.7);

    const volumes = reopened();
    expect(volumes.get('se')).toBe(0.2);
    expect(volumes.get('background')).toBe(0.7);
    expect(volumes.get('bgm')).toBe(0.5);
  });

  it('makes a volume heard at once, scaled by the room volume, and puts it on the jukebox', () => {
    const heard = channels();
    const volumes = reopened();
    new Config('Config').initialize();
    ObjectStore.instance.get<Config>('Config')!.roomVolume = 0.5;
    new Jukebox('Jukebox').initialize();

    volumes.set('bgm', 0.8);

    expect(heard.bgm).toHaveBeenLastCalledWith(expect.closeTo(0.4));
    expect(ObjectStore.instance.get<Jukebox>('Jukebox')!.volume).toBe(0.8);
  });

  it('hands the remembered volumes to the jukebox and the players as the app starts', () => {
    localStorage.setItem(
      PERSONAL_VOLUME_STORAGE_KEY,
      JSON.stringify({ audition: 0.1, bgm: 0.2, se: 0.3, background: 0.4 })
    );
    const heard = channels();
    const volumes = reopened();
    const jukebox = new Jukebox('Jukebox');
    jukebox.initialize();

    volumes.restore();

    expect([jukebox.auditionVolume, jukebox.volume, jukebox.seVolume, jukebox.backgroundVolume]).toEqual([
      0.1, 0.2, 0.3, 0.4,
    ]);
    expect(heard.audition).toHaveBeenLastCalledWith(0.1);
    expect(heard.bgm).toHaveBeenLastCalledWith(0.2);
    expect(heard.se).toHaveBeenLastCalledWith(0.3);
    expect(heard.background).toHaveBeenLastCalledWith(0.4);
  });

  it('keeps a volume for the session when the browser refuses to write it down', () => {
    channels();
    const volumes = reopened();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('private browsing');
    });

    expect(() => volumes.set('bgm', 0.3)).not.toThrow();
    expect(volumes.get('bgm')).toBe(0.3);
  });
});

describe('parsePersonalVolumes()', () => {
  it('takes the defaults when nothing was written down, or what was cannot be read', () => {
    expect(parsePersonalVolumes(null)).toEqual(DEFAULT_PERSONAL_VOLUMES);
    expect(parsePersonalVolumes('not json')).toEqual(DEFAULT_PERSONAL_VOLUMES);
    expect(parsePersonalVolumes('null')).toEqual(DEFAULT_PERSONAL_VOLUMES);
  });

  it('takes the default for a volume missing, not a number or outside 0 to 1, and keeps the rest', () => {
    expect(parsePersonalVolumes(JSON.stringify({ bgm: 0.25, se: '0.3', audition: 2, background: -1 }))).toEqual({
      audition: 0.5,
      bgm: 0.25,
      se: 0.5,
      background: 0.5,
    });
  });

  it('keeps a volume turned right down', () => {
    expect(parsePersonalVolumes(JSON.stringify({ bgm: 0 })).bgm).toBe(0);
  });
});
