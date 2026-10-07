import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PersonalVolumeService } from '@axe/application/media/personal-volume.service';
import { PersonalVolumeKind } from '@axe/application/media/personal-volumes';
import { RoomVolumeService } from '@axe/application/media/room-volume.service';
import { UiChatSoundSettingsComponent } from '@axe/ui/components/chat-sound-settings/chat-sound-settings.component';
import { UiVolumeRowComponent } from '@axe/ui/components/volume-row/volume-row.component';
import { TranslocoModule } from '@jsverse/transloco';

/** One kind of sound as the panel lists it: the slider's icon and the name of its input. */
interface SoundKindRow {
  readonly kind: PersonalVolumeKind;
  readonly icon: string;
  readonly name: string;
}

/** The kinds in the order the panel lists them, music first and the sound effects left over last. */
const ROWS: readonly SoundKindRow[] = [
  { kind: 'audition', icon: 'headphones', name: 'audition-volume' },
  { kind: 'bgm', icon: 'library_music', name: 'bgm-volume' },
  { kind: 'background', icon: 'waves', name: 'background-volume' },
  { kind: 'cutIn', icon: 'slideshow', name: 'cut-in-volume' },
  { kind: 'notification', icon: 'notifications', name: 'notification-volume' },
  { kind: 'handling', icon: 'pan_tool', name: 'handling-volume' },
  { kind: 'effect', icon: 'auto_awesome', name: 'effect-volume' },
  { kind: 'se', icon: 'star', name: 'se-volume' },
];

/**
 * Every sound setting of the listener's in one place: a volume for each kind of sound, each of
 * which can be turned off; the note a chat line makes; and the room volume, which only the game
 * master may change.
 *
 * Everything but the room volume is the listener's own, kept in this browser and never sent to the
 * room.
 */
@Component({
  selector: 'app-sound-settings-panel',
  templateUrl: './sound-settings-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoModule, UiVolumeRowComponent, UiChatSoundSettingsComponent],
  host: { class: 'block h-full' },
})
export class SoundSettingsPanelComponent {
  protected readonly volumes = inject(PersonalVolumeService);
  protected readonly roomVolumes = inject(RoomVolumeService);

  protected readonly rows = ROWS;
}
