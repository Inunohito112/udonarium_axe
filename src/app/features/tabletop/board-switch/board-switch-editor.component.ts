import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ChatMessageService } from '@axe/application/chat/chat-message.service';
import { ObjectChangeService } from '@axe/application/sync/object-change.service';
import { BoardSwitchService } from '@axe/application/tabletop/board-switch.service';
import { SwitchPressService } from '@axe/application/tabletop/switch-press.service';
import { ChatTab } from '@axe/domain/chat/chat-tab';
import { BoardSwitch } from '@axe/domain/tabletop/board-switch/board-switch';
import {
  clampSwitchRange,
  defaultSwitchDefinition,
  SWITCH_SPEAKERS,
  SwitchAction,
  SwitchDefinition,
  SwitchSpeaker,
} from '@axe/domain/tabletop/board-switch/switch-definition';
import { asTriggerRepeat, TRIGGER_REPEATS } from '@axe/domain/tabletop/trigger-event';
import { SwitchActionListComponent } from '@axe/features/tabletop/board-switch/switch-action-list.component';
import { TranslocoModule } from '@jsverse/transloco';

/**
 * Where the master writes what a switch is called and what it does.
 *
 * Every change is written to the switch as it is made, the way the other settings panels on the
 * table write theirs, so there is nothing to save and nothing lost by closing it. A seat that is
 * not the master's is shown nothing of what the switch does.
 */
@Component({
  selector: 'app-board-switch-editor',
  templateUrl: './board-switch-editor.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SwitchActionListComponent, TranslocoModule],
})
export class BoardSwitchEditorComponent {
  private readonly switches = inject(BoardSwitchService);
  private readonly presses = inject(SwitchPressService);
  private readonly chat = inject(ChatMessageService);
  private readonly objectChange = inject(ObjectChangeService);

  /** The switch being written, handed in by whoever opened the panel. */
  readonly target = signal<BoardSwitch | null>(null);

  protected readonly canEdit = this.switches.canEdit;
  protected readonly speakers = SWITCH_SPEAKERS;
  protected readonly repeats = TRIGGER_REPEATS;

  /** Counts this panel's own writes, so what it draws follows them before the room has heard. */
  private readonly written = signal(0);

  protected readonly definition = computed<SwitchDefinition>(() => {
    const target = this.target();
    if (!target) return defaultSwitchDefinition();
    this.objectChange.versionOf(target.identifier)();
    this.written();
    return target.def;
  });

  /** The tabs a switch may speak into: every tab but the system's noticeboard. */
  protected readonly tabs = computed<ChatTab[]>(() => {
    this.objectChange.collectionOf(ChatTab.aliasName)();
    return this.chat.chatTabs.filter((tab) => !tab.isSystemTab);
  });

  protected readonly tried = signal<string>('');

  protected setLabel(label: string): void {
    this.update({ label });
  }

  protected setSpeaker(speaker: string): void {
    if ((SWITCH_SPEAKERS as readonly string[]).includes(speaker)) this.update({ speaker: speaker as SwitchSpeaker });
  }

  protected setTab(tab: string): void {
    this.update({ tab });
  }

  protected setGuests(guests: boolean): void {
    this.update({ guests });
  }

  protected setRange(range: string): void {
    this.update({ range: clampSwitchRange(range) });
  }

  protected setNeedsSight(needsSight: boolean): void {
    this.update({ needsSight });
  }

  protected setRepeat(repeat: string): void {
    this.update({ repeat: asTriggerRepeat(repeat) });
  }

  protected setActions(actions: SwitchAction[]): void {
    this.update({ actions });
  }

  /** Tries the switch out from the panel without counting it as a press, and says how it went. */
  protected async tryIt(): Promise<void> {
    const target = this.target();
    if (!target) return;
    const outcome = await this.presses.press(target, { trial: true });
    this.tried.set(outcome);
  }

  /**
   * Writes one change onto what the switch says now.
   *
   * Read from the switch itself rather than from what the panel last drew: the room hears of a
   * change a moment after it is made, and two changes made inside that moment would otherwise each
   * be written over what the panel drew before either, the second taking the first back out.
   */
  private update(change: Partial<SwitchDefinition>): void {
    const target = this.target();
    if (!target) return;
    this.switches.write(target, { ...target.def, ...change });
    this.written.update((count) => count + 1);
  }
}
