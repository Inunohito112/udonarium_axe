import { inject, Injectable } from '@angular/core';
import { CharacterMacroService } from '@axe/application/chat/character-macro.service';
import { ChatMessageService } from '@axe/application/chat/chat-message.service';
import { ChatSpeakerService } from '@axe/application/chat/chat-speaker.service';
import { NamedCueService } from '@axe/application/media/named-cue.service';
import { GameCharacter } from '@axe/domain/character/game-character';
import { ChatTab } from '@axe/domain/chat/chat-tab';
import { PeerCursor } from '@axe/domain/peer/peer-cursor';
import { BoardSwitch } from '@axe/domain/tabletop/board-switch/board-switch';
import { SwitchAction, SwitchDefinition } from '@axe/domain/tabletop/board-switch/switch-definition';
import { pressRefusal, SwitchRefusal } from '@axe/domain/tabletop/board-switch/switch-press-rules';

/** How long a switch stays down after a press, so a double click or an eager finger presses once. */
export const SWITCH_COOLDOWN_MS = 1500;

/** How a press turned out: done, turned away for a reason, or ignored as a switch still going. */
export type SwitchPressOutcome = 'pressed' | 'busy' | SwitchRefusal;

/** What the switch sits on, as far as pressing it needs to know. */
export interface SwitchHost {
  /** The name it speaks under where it speaks for itself. */
  name: string;
}

interface PressContext {
  definition: SwitchDefinition;
  host: SwitchHost;
  tab: ChatTab | null;
  /** The piece the presser is speaking as, or null where they speak as themselves. */
  character: GameCharacter | null;
}

/**
 * Presses switches on the table, on the seat of whoever pressed them.
 *
 * One seat has to carry a press out, or a room of five would say the line five times. It is the
 * seat that pressed, since that is the one that knows it happened, and what it says and plays
 * reaches the others the way anything said or played does.
 *
 * What a switch does is done in order, each thing after the wait written on it, and a line is
 * sent before the next thing starts so the room reads them in the order they were written. While
 * a switch is still going, and for a moment after it was pressed, pressing it again does nothing.
 */
@Injectable({ providedIn: 'root' })
export class SwitchPressService {
  private readonly macro = inject(CharacterMacroService);
  private readonly chat = inject(ChatMessageService);
  private readonly speaker = inject(ChatSpeakerService);
  private readonly cues = inject(NamedCueService);

  private readonly running = new Set<string>();
  private readonly pressedAt = new Map<string, number>();

  /** Why this seat may not press the switch just now, or null where it may. */
  refusalFor(target: BoardSwitch): SwitchRefusal | null {
    const definition = target.def;
    return pressRefusal({
      definition,
      role: PeerCursor.myRole,
      tab: this.macro.currentTab(definition.tab),
      retired: target.retired,
    });
  }

  /** Presses the switch, and answers once everything it does has been done or turned away. */
  async press(target: BoardSwitch, host: SwitchHost): Promise<SwitchPressOutcome> {
    const key = target.identifier;
    const now = Date.now();
    if (this.running.has(key)) return 'busy';
    if (now - (this.pressedAt.get(key) ?? -Infinity) < SWITCH_COOLDOWN_MS) return 'busy';
    const refusal = this.refusalFor(target);
    if (refusal) return refusal;

    this.running.add(key);
    this.pressedAt.set(key, now);
    const definition = target.def;
    const context: PressContext = {
      definition,
      host,
      tab: this.macro.currentTab(definition.tab),
      character: this.speaker.current(),
    };
    try {
      for (const [order, action] of definition.actions.entries()) {
        if (order > 0 && action.delayMs > 0) await wait(action.delayMs);
        try {
          await this.run(action, context);
        } catch {
          // One thing going wrong is no reason to leave the rest of the switch undone.
        }
      }
    } finally {
      this.running.delete(key);
    }
    return 'pressed';
  }

  private async run(action: SwitchAction, context: PressContext): Promise<void> {
    switch (action.kind) {
      case 'say':
        await this.say(action.text, context);
        return;
      case 'sound':
        this.cues.playSound(action.name);
        return;
      case 'effect':
        this.cues.playEffect(action.name, context.character ? [context.character] : []);
        return;
      case 'cutIn':
        this.cues.launchCutIn(action.name);
        return;
      case 'unknown':
        return;
    }
  }

  private async say(text: string, context: PressContext): Promise<void> {
    const line = text.trim();
    if (line.length < 1 || !context.tab) return;
    const { definition, character, tab } = context;
    const options = { tab, gameType: definition.gameType || undefined };
    switch (definition.speaker) {
      case 'presser':
        if (character) await this.macro.sendAsCharacter(character, line, options);
        else await this.macro.sendAsSelf(line, options);
        return;
      case 'host':
        await this.macro.sendAsNamed(this.hostName(context), line, character, options);
        return;
      case 'system':
        this.chat.sendSystemMessageToTab(tab, line);
        return;
    }
  }

  private hostName(context: PressContext): string {
    return context.host.name.trim() || context.definition.label.trim();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
