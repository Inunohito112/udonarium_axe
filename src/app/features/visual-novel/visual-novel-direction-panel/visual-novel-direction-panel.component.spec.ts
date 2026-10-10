import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ObjectChangeService } from '@axe/application/sync/object-change.service';
import { ConfirmService } from '@axe/application/ui/confirm.service';
import { ObjectStore } from '@axe/core/sync/object-store';
import { ChatTab } from '@axe/domain/chat/chat-tab';
import { ChatTabList } from '@axe/domain/chat/chat-tab-list';
import { PeerCursor } from '@axe/domain/peer/peer-cursor';
import { PeerRole } from '@axe/domain/peer/peer-role';
import { toStageResetAt } from '@axe/domain/visual-novel/vn-portrait-position';
import { VnStage } from '@axe/domain/visual-novel/vn-stage';
import { VisualNovelDirectionPanelComponent } from '@axe/features/visual-novel/visual-novel-direction-panel/visual-novel-direction-panel.component';
import { VisualNovelPlaybackService } from '@axe/features/visual-novel/visual-novel-playback.service';
import { TEST_PROVIDERS } from '@axe/testing/test-providers';

describe('VisualNovelDirectionPanelComponent', () => {
  let fixture: ComponentFixture<VisualNovelDirectionPanelComponent>;
  let component: VisualNovelDirectionPanelComponent;
  let tab: ChatTab;

  beforeEach(async () => {
    PeerCursor.createMyCursor();
    TestBed.configureTestingModule({
      imports: [VisualNovelDirectionPanelComponent],
      providers: [...TEST_PROVIDERS],
    }).compileComponents();
    if (!ObjectStore.instance.get('VnStage')) new VnStage('VnStage').initialize();
    tab = ChatTabList.instance.addChatTab('テストタブ');
    TestBed.inject(VisualNovelPlaybackService).setChatTab(tab.identifier);
    fixture = TestBed.createComponent(VisualNovelDirectionPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture?.destroy();
    tab?.destroy();
    PeerCursor.myCursor.role = PeerRole.Player;
    localStorage.removeItem('vn-settings');
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('offers nothing to anybody but the game master', () => {
    expect(component.scene.canDirect()).toBe(false);
    expect(component.director.canDirect()).toBe(false);
  });

  it('clears the portraits of the tab being read', () => {
    PeerCursor.myCursor.role = PeerRole.GameMaster;
    TestBed.inject(ObjectChangeService).notifyChanged(PeerCursor.myCursor.identifier);

    component.resetStage();

    expect(toStageResetAt(tab.vnPortraitResetAt)).toBeGreaterThan(0);
    expect(tab.chatMessages).toHaveLength(1);
  });

  it('clears every chat tab after the game master confirms', async () => {
    PeerCursor.myCursor.role = PeerRole.GameMaster;
    TestBed.inject(ObjectChangeService).notifyChanged(PeerCursor.myCursor.identifier);
    vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(true);
    const other = ChatTabList.instance.addChatTab('別タブ');
    try {
      tab.addMessage({ from: 'someone', name: 'アリス', text: '消える発言', timestamp: 1000 });
      other.addMessage({ from: 'someone', name: 'ボブ', text: '消える発言', timestamp: 1001 });

      await component.clearAllChatHistory();

      expect(tab.chatMessages).toHaveLength(1);
      expect(other.chatMessages).toHaveLength(1);
      expect(tab.chatMessages[0].isSystemMessage).toBe(true);
      expect(other.chatMessages[0].isSystemMessage).toBe(true);
    } finally {
      other.destroy();
    }
  });

  it('leaves every line in place when the clearing is cancelled', async () => {
    PeerCursor.myCursor.role = PeerRole.GameMaster;
    TestBed.inject(ObjectChangeService).notifyChanged(PeerCursor.myCursor.identifier);
    vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(false);
    tab.addMessage({ from: 'someone', name: 'アリス', text: '残る発言', timestamp: 1000 });

    await component.clearAllChatHistory();

    expect(tab.chatMessages).toHaveLength(1);
    expect(tab.chatMessages[0].text).toBe('残る発言');
  });

  it('does not even ask a player to clear the room history', async () => {
    const ask = vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(true);
    tab.addMessage({ from: 'someone', name: 'アリス', text: '残る発言', timestamp: 1000 });

    await component.clearAllChatHistory();

    expect(ask).not.toHaveBeenCalled();
    expect(tab.chatMessages).toHaveLength(1);
  });
});
