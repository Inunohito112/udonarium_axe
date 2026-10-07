import { inject, Injectable, signal } from '@angular/core';
import {
  DEFAULT_PERSONAL_VOLUMES,
  parsePersonalVolumes,
  PERSONAL_VOLUME_STORAGE_KEY,
  PersonalVolumeKind,
  PersonalVolumes,
} from '@axe/application/media/personal-volumes';
import { AudioPlayer } from '@axe/core/storage/audio-player';
import { ObjectStore } from '@axe/core/sync/object-store';
import { Jukebox } from '@axe/domain/media/jukebox';
import { Config } from '@axe/domain/peer/config';

/**
 * The listener's own volumes for previewing, music, sound effects and background sounds, kept in
 * this browser so they hold from one session and one room to the next.
 *
 * They are this listener's alone and never reach the room. What is heard is each scaled by the
 * room volume, which the room shares.
 */
@Injectable({ providedIn: 'root' })
export class PersonalVolumeService {
  private readonly objectStore = inject(ObjectStore);
  private readonly volumes = signal<PersonalVolumes>(storedVolumes());

  /** One of the listener's own volumes, from 0 to 1. */
  get(kind: PersonalVolumeKind): number {
    return this.volumes()[kind];
  }

  /** Sets one of the listener's own volumes, makes it heard at once and remembers it in this browser. */
  set(kind: PersonalVolumeKind, volume: number): void {
    const next = { ...this.volumes(), [kind]: Math.min(1, Math.max(0, volume)) };
    this.volumes.set(next);
    this.apply();
    try {
      localStorage.setItem(PERSONAL_VOLUME_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private browsing refuses the write; the volume still holds for this session.
    }
  }

  /** Hands the remembered volumes to the room's jukebox and the players, as the app starts. */
  restore(): void {
    this.apply();
  }

  private apply(): void {
    const volumes = this.volumes();
    const jukebox = this.objectStore.get<Jukebox>('Jukebox');
    if (jukebox) {
      jukebox.auditionVolume = volumes.audition;
      jukebox.volume = volumes.bgm;
      jukebox.seVolume = volumes.se;
      jukebox.backgroundVolume = volumes.background;
    }
    const roomVolume = this.objectStore.get<Config>('Config')?.roomVolume ?? 1;
    AudioPlayer.auditionVolume = volumes.audition * roomVolume;
    AudioPlayer.volume = volumes.bgm * roomVolume;
    AudioPlayer.seVolume = volumes.se * roomVolume;
    AudioPlayer.backgroundVolume = volumes.background * roomVolume;
  }
}

function storedVolumes(): PersonalVolumes {
  try {
    return parsePersonalVolumes(localStorage.getItem(PERSONAL_VOLUME_STORAGE_KEY));
  } catch {
    return DEFAULT_PERSONAL_VOLUMES;
  }
}
