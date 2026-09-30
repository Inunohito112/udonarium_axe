import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { EffectLibraryService } from '@axe/application/effect/effect-library.service';
import { TRANSLATE_FN } from '@axe/application/i18n/translate.token';
import { ObjectChangeService } from '@axe/application/sync/object-change.service';
import { AudioStorage } from '@axe/core/storage/audio-storage';
import { ObjectStore } from '@axe/core/sync/object-store';
import { CutIn } from '@axe/domain/media/cut-in';
import { presetSoundLabelKey, soundFileName } from '@axe/domain/media/preset-sound-labels';
import {
  clampSwitchDelay,
  MAX_SWITCH_ACTIONS,
  newSwitchAction,
  SWITCH_ACTION_KINDS,
  SwitchAction,
  SwitchActionKind,
} from '@axe/domain/tabletop/board-switch/switch-definition';
import { TranslocoModule } from '@jsverse/transloco';

interface NameChoice {
  value: string;
  name: string;
}

/**
 * The list of things a switch does, in the order it does them, for the master to write.
 *
 * Each thing is a line to say or a sound, effect or cut-in to play by name, with how long to wait
 * after the one before it. Something a newer version wrote and this one cannot do is shown as
 * such and kept where it stands, so writing the list back does not lose it.
 */
@Component({
  selector: 'app-switch-action-list',
  templateUrl: './switch-action-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoModule],
})
export class SwitchActionListComponent {
  private readonly effectLibrary = inject(EffectLibraryService);
  private readonly audioStorage = inject(AudioStorage);
  private readonly objectStore = inject(ObjectStore);
  private readonly objectChange = inject(ObjectChangeService);
  private readonly t = inject(TRANSLATE_FN);

  readonly actions = input.required<readonly SwitchAction[]>();
  readonly actionsChange = output<SwitchAction[]>();

  protected readonly kinds = SWITCH_ACTION_KINDS;
  protected readonly full = computed(() => this.actions().length >= MAX_SWITCH_ACTIONS);

  private readonly effectChoices = computed<NameChoice[]>(() =>
    this.effectLibrary.presets().map((preset) => ({ value: preset.name, name: preset.name }))
  );

  private readonly soundChoices = computed<NameChoice[]>(() => {
    this.objectChange.fileVersion();
    return [...this.audioStorage.audios]
      .map((audio) => {
        const labelKey = presetSoundLabelKey(audio.identifier);
        return { value: audio.name, name: labelKey ? this.t(labelKey) : soundFileName(audio.name) };
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'ja'));
  });

  private readonly cutInChoices = computed<NameChoice[]>(() => {
    this.objectChange.collectionOf('cut-in')();
    return this.objectStore.getObjects<CutIn>(CutIn).map((cutIn) => ({ value: cutIn.name, name: cutIn.name }));
  });

  /**
   * What a played thing can be, with the name already written kept on offer even where nothing in
   * the room goes by it, so opening the list does not quietly swap it for something else.
   */
  protected choicesFor(action: SwitchAction): NameChoice[] {
    if (action.kind === 'say' || action.kind === 'unknown') return [];
    const choices =
      action.kind === 'sound'
        ? this.soundChoices()
        : action.kind === 'effect'
          ? this.effectChoices()
          : this.cutInChoices();
    const name = action.name.trim();
    if (name.length < 1 || choices.some((choice) => choice.value === name)) return choices;
    return [{ value: name, name: this.t('feature.boardSwitch.missing', { name }) }, ...choices];
  }

  protected delaySeconds(action: SwitchAction): number {
    return action.delayMs / 1000;
  }

  protected add(kind: SwitchActionKind): void {
    if (this.full()) return;
    this.actionsChange.emit([...this.actions(), newSwitchAction(kind)]);
  }

  protected setKind(index: number, kind: string): void {
    const held = this.actions()[index];
    if (!held || !(SWITCH_ACTION_KINDS as readonly string[]).includes(kind)) return;
    const made = newSwitchAction(kind as SwitchActionKind);
    this.replace(index, { ...made, delayMs: held.delayMs });
  }

  protected setText(index: number, text: string): void {
    const held = this.actions()[index];
    if (held?.kind === 'say') this.replace(index, { ...held, text });
  }

  protected setName(index: number, name: string): void {
    const held = this.actions()[index];
    if (held && held.kind !== 'say' && held.kind !== 'unknown') this.replace(index, { ...held, name });
  }

  protected setDelay(index: number, seconds: string): void {
    const held = this.actions()[index];
    if (held) this.replace(index, { ...held, delayMs: clampSwitchDelay(Number(seconds) * 1000) });
  }

  protected move(index: number, by: number): void {
    const list = [...this.actions()];
    const to = index + by;
    if (to < 0 || to >= list.length) return;
    [list[index], list[to]] = [list[to], list[index]];
    this.actionsChange.emit(list);
  }

  protected remove(index: number): void {
    this.actionsChange.emit(this.actions().filter((_, at) => at !== index));
  }

  private replace(index: number, action: SwitchAction): void {
    this.actionsChange.emit(this.actions().map((held, at) => (at === index ? action : held)));
  }
}
