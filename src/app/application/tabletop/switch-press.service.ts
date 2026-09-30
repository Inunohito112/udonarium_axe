import { inject, Injectable } from '@angular/core';
import { CharacterMacroService } from '@axe/application/chat/character-macro.service';
import { ChatMessageService } from '@axe/application/chat/chat-message.service';
import { ChatSpeakerService } from '@axe/application/chat/chat-speaker.service';
import { NamedCueService } from '@axe/application/media/named-cue.service';
import { blockFootprintOf } from '@axe/application/tabletop/functional-paint.service';
import { VisionService } from '@axe/application/tabletop/vision.service';
import { Network } from '@axe/core/network/network';
import { ObjectNode } from '@axe/core/sync/object-node';
import { ObjectStore } from '@axe/core/sync/object-store';
import { GameCharacter } from '@axe/domain/character/game-character';
import { evaluateCharacterReferences } from '@axe/domain/chat/chat-palette';
import { ChatTab } from '@axe/domain/chat/chat-tab';
import { PeerCursor } from '@axe/domain/peer/peer-cursor';
import { BoardSwitch, spendSwitch, switchHasGoFor } from '@axe/domain/tabletop/board-switch/board-switch';
import { SwitchAction, SwitchDefinition } from '@axe/domain/tabletop/board-switch/switch-definition';
import { pressRefusal, SwitchReach, SwitchRefusal } from '@axe/domain/tabletop/board-switch/switch-press-rules';
import { cellsOfRect, stepsToReach } from '@axe/domain/tabletop/board-switch/switch-reach';
import { CellRect } from '@axe/domain/tabletop/cell-rectangles';
import { CellGrid, cellGridOf } from '@axe/domain/tabletop/fog/cell-grid';
import { groundInSight } from '@axe/domain/tabletop/ground-in-sight';
import { pieceCellOf } from '@axe/domain/tabletop/move/piece-on-grid';
import { TableSelecter } from '@axe/domain/tabletop/table-selecter';
import { TableTrigger } from '@axe/domain/tabletop/table-trigger';
import { Terrain } from '@axe/domain/tabletop/terrain';
import { TurnState } from '@axe/domain/tabletop/turn-state';

/** How long a switch stays down after a press, so a double click or an eager finger presses once. */
export const SWITCH_COOLDOWN_MS = 1500;

/** How a press turned out: done, turned away for a reason, or ignored as a switch still going. */
export type SwitchPressOutcome = 'pressed' | 'busy' | SwitchRefusal;

export interface SwitchPressOptions {
  /** The master trying the switch out, which neither counts as a press nor is held to its count. */
  trial?: boolean;
}

/** What the switch sits on, as far as pressing it needs to know. */
export interface SwitchHost {
  /** The name it speaks under where it speaks for itself. */
  name: string;
  /** The cells it stands over on the table being looked at, or null where it stands over none. */
  rect: CellRect | null;
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
 * A switch that counts its presses writes the press down before doing anything, so a second seat
 * pressing it a moment later finds it already spent.
 */
@Injectable({ providedIn: 'root' })
export class SwitchPressService {
  private readonly macro = inject(CharacterMacroService);
  private readonly chat = inject(ChatMessageService);
  private readonly speaker = inject(ChatSpeakerService);
  private readonly cues = inject(NamedCueService);
  private readonly vision = inject(VisionService);
  private readonly tableSelecter = inject(TableSelecter);
  private readonly objectStore = inject(ObjectStore);

  private readonly running = new Set<string>();
  private readonly pressedAt = new Map<string, number>();

  /** What the switch sits on: its name, and the cells it stands over on the table being looked at. */
  hostOf(target: BoardSwitch): SwitchHost {
    const host: ObjectNode | null = target.parent;
    const grid = this.grid();
    if (host instanceof Terrain) {
      const rect = grid ? (blockFootprintOf(host, host.width, host.depth, grid)?.rect ?? null) : null;
      return { name: host.name, rect };
    }
    if (host instanceof TableTrigger) return { name: host.name, rect: host.rect };
    return { name: '', rect: null };
  }

  /** Why this seat may not press the switch just now, or null where it may. */
  refusalFor(target: BoardSwitch, options: SwitchPressOptions = {}): SwitchRefusal | null {
    const definition = target.def;
    const character = this.speaker.current();
    const host = this.hostOf(target);
    return pressRefusal({
      definition,
      role: PeerCursor.myRole,
      tab: this.macro.currentTab(definition.tab),
      retired: target.retired,
      hasGo: switchHasGoFor(target, this.presserKey(character), this.round()),
      reach: definition.range > 0 ? this.reachOf(character, host, definition.range) : undefined,
      inSight: definition.needsSight ? this.sees(host) : undefined,
      trial: options.trial,
    });
  }

  /** Presses the switch, and answers once everything it does has been done or turned away. */
  async press(target: BoardSwitch, options: SwitchPressOptions = {}): Promise<SwitchPressOutcome> {
    const key = target.identifier;
    const now = Date.now();
    if (this.running.has(key)) return 'busy';
    if (now - (this.pressedAt.get(key) ?? -Infinity) < SWITCH_COOLDOWN_MS) return 'busy';
    const refusal = this.refusalFor(target, options);
    if (refusal) return refusal;

    this.running.add(key);
    this.pressedAt.set(key, now);
    const definition = target.def;
    const character = this.speaker.current();
    if (!options.trial) spendSwitch(target, this.presserKey(character), this.round());
    const context: PressContext = {
      definition,
      host: this.hostOf(target),
      tab: this.macro.currentTab(definition.tab),
      character,
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
      case 'secret':
        this.keepBack(action.text, action.to, context);
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

  /**
   * Writes a line the room sees only as kept back.
   *
   * Sent from the presser, it is the presser's to read and the master's; sent from nobody in
   * particular, it is the master's alone, which is how painted ground keeps its quiet lines.
   */
  private keepBack(text: string, to: 'presser' | 'master', context: PressContext): void {
    const line = text.trim();
    if (line.length < 1 || !context.tab) return;
    const filled = context.character ? evaluateCharacterReferences(line, context.character).text : line;
    const from = to === 'presser' ? Network.peerContext.userId : undefined;
    this.chat.sendSecretSystemMessageToTab(context.tab, filled, from);
  }

  private hostName(context: PressContext): string {
    return context.host.name.trim() || context.definition.label.trim();
  }

  /** Who a press is counted against: the piece pressing it, else the person. */
  private presserKey(character: GameCharacter | null): string {
    return character?.identifier ?? PeerCursor.myCursor?.userId ?? '';
  }

  private reachOf(character: GameCharacter | null, host: SwitchHost, range: number): SwitchReach {
    const grid = this.grid();
    if (!character || character.location.name !== 'table' || !grid || !host.rect) return 'noPiece';
    const from = pieceCellOf(grid, character, grid.sizePx);
    if (from < 0) return 'noPiece';
    return stepsToReach(grid, from, cellsOfRect(grid, host.rect), range) === null ? 'tooFar' : 'near';
  }

  private sees(host: SwitchHost): boolean {
    const grid = this.grid();
    if (!grid || !host.rect) return true;
    return groundInSight(grid, host.rect, this.vision.overlayVision()?.visible ?? null);
  }

  private grid(): CellGrid | null {
    const table = this.tableSelecter.viewTable;
    if (!table || table.gridSize <= 0 || table.width <= 0 || table.height <= 0) return null;
    return cellGridOf(table.width, table.height, table.gridSize, table.gridType);
  }

  private round(): number {
    const held = this.objectStore.get<TurnState>('TurnState');
    return held instanceof TurnState ? held.round : -1;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
