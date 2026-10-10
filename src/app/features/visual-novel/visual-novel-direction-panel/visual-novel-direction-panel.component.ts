import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ChatMessageService } from '@axe/application/chat/chat-message.service';
import { encodeI18nMessage } from '@axe/application/i18n/i18n-message';
import { TRANSLATE_FN } from '@axe/application/i18n/translate.token';
import { ConfirmService } from '@axe/application/ui/confirm.service';
import { ChatTabList } from '@axe/domain/chat/chat-tab-list';
import { PeerCursor } from '@axe/domain/peer/peer-cursor';
import { VN_STAGE_TRANSITIONS } from '@axe/domain/visual-novel/vn-stage';
import { VisualNovelDirectorService } from '@axe/features/visual-novel/visual-novel-director.service';
import { VisualNovelPlaybackService } from '@axe/features/visual-novel/visual-novel-playback.service';
import { VisualNovelSceneService } from '@axe/features/visual-novel/visual-novel-scene.service';
import { TranslocoModule } from '@jsverse/transloco';

/**
 * What the game master does to the scene everybody is looking at.
 *
 * Apart from the display settings, which are each reader's own: these reach the whole table.
 * In the same strip as the controls for reading and for speaking they would be three unlabelled
 * icons among twenty.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'visual-novel-direction-panel',
  templateUrl: './visual-novel-direction-panel.component.html',
  host: { class: 'block' },
  imports: [TranslocoModule],
})
export class VisualNovelDirectionPanelComponent {
  readonly scene = inject(VisualNovelSceneService);
  readonly director = inject(VisualNovelDirectorService);
  private readonly playback = inject(VisualNovelPlaybackService);
  private readonly chatTabList = inject(ChatTabList);
  private readonly chatMessageService = inject(ChatMessageService);
  private readonly confirm = inject(ConfirmService);
  private readonly t = inject(TRANSLATE_FN);

  readonly transitionOptions = VN_STAGE_TRANSITIONS;

  /**
   * Clears the stage of the tab being read, for everybody: a notice goes into the log, and nothing
   * said before it stays on the stage. Only the game master may do it, and with no tab nothing
   * happens.
   */
  resetStage(): void {
    const tab = this.playback.chatTab();
    if (tab) this.scene.resetStage(tab);
  }

  /**
   * Clears the history of every chat tab for the whole room after a destructive-action warning.
   *
   * The permission is checked both before and after the asynchronous confirmation, so changing
   * roles while the dialog is open cannot leave a player holding a game-master action. Each tab
   * receives one new system notice after its old history and portrait state have been removed.
   */
  async clearAllChatHistory(): Promise<void> {
    if (!this.scene.canDirect()) return;
    const accepted = await this.confirm.ask({
      message: this.t('feature.visualNovel.chatHistoryClearConfirm'),
      okLabel: this.t('feature.visualNovel.chatHistoryClear'),
      danger: true,
    });
    if (!accepted || !this.scene.canDirect()) return;

    const cursor = PeerCursor.myCursor;
    const requester = cursor?.userId ?? '';
    const user = cursor?.name?.trim() || cursor?.identifier || '';
    const notice = encodeI18nMessage('common.chat.logClearedBy', { user });
    for (const tab of this.chatTabList.chatTabs) {
      while (tab.children.length > 0) tab.children[0].destroy();
      tab.portraitReset();
      this.chatMessageService.sendSystemMessageToTab(tab, notice, undefined, requester);
    }
  }
}
