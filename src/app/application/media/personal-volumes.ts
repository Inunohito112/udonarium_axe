/** Where this browser keeps the listener's own volumes. */
export const PERSONAL_VOLUME_STORAGE_KEY = 'audio-personal-volumes';

/** The listener's own volumes, each from 0 to 1, before the room volume scales them. */
export interface PersonalVolumes {
  readonly audition: number;
  readonly bgm: number;
  readonly se: number;
  readonly background: number;
}

export type PersonalVolumeKind = keyof PersonalVolumes;

export const DEFAULT_PERSONAL_VOLUMES: PersonalVolumes = { audition: 0.5, bgm: 0.5, se: 0.5, background: 0.5 };

/**
 * Reads the listener's volumes from storage text, taking the default for any one missing, not a
 * number or outside 0 to 1, and for text that cannot be read.
 */
export function parsePersonalVolumes(raw: string | null): PersonalVolumes {
  if (!raw) return DEFAULT_PERSONAL_VOLUMES;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<PersonalVolumeKind, unknown>> | null;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PERSONAL_VOLUMES;
    const read = (kind: PersonalVolumeKind): number => {
      const value = parsed[kind];
      return typeof value === 'number' && value >= 0 && value <= 1 ? value : DEFAULT_PERSONAL_VOLUMES[kind];
    };
    return { audition: read('audition'), bgm: read('bgm'), se: read('se'), background: read('background') };
  } catch {
    return DEFAULT_PERSONAL_VOLUMES;
  }
}
