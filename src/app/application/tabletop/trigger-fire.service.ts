import { inject, Injectable } from '@angular/core';
import { StatusAilmentService } from '@axe/application/character/status-ailment.service';
import { ChatMessageService } from '@axe/application/chat/chat-message.service';
import { EffectCastService } from '@axe/application/effect/effect-cast.service';
import { EffectLibraryService } from '@axe/application/effect/effect-library.service';
import { TRANSLATE_FN } from '@axe/application/i18n/translate.token';
import { CutInService } from '@axe/application/media/cut-in.service';
import { AudioStorage } from '@axe/core/storage/audio-storage';
import { ObjectStore } from '@axe/core/sync/object-store';
import { GameCharacter } from '@axe/domain/character/game-character';
import { newStatusAilment } from '@axe/domain/character/status-ailment';
import { DataElement } from '@axe/domain/data/data-element';
import { findByReference } from '@axe/domain/hotbar/hotbar-reference';
import { CutIn } from '@axe/domain/media/cut-in';
import { SoundEffect } from '@axe/domain/media/sound-effect';
import { cellColRow, CellGrid, cellGridOf } from '@axe/domain/tabletop/fog/cell-grid';
import { pieceCellOf } from '@axe/domain/tabletop/move/piece-on-grid';
import { TableSelecter } from '@axe/domain/tabletop/table-selecter';
import { TableTrigger, triggersOn } from '@axe/domain/tabletop/table-trigger';
import { rollTriggerAmount, triggerCatches } from '@axe/domain/tabletop/trigger-event';

/** One piece of ground going off, and what it came to. */
export interface TriggerFiring {
  trigger: TableTrigger;
  /** What was taken, after the dice. Negative where the ground gave something back. */
  taken: number;
  /** The name of what it was taken from, or nothing where the piece carried no such thing. */
  from: string;
}

/**
 * Ground that goes off under a piece, set off by the seat that moved the piece.
 *
 * One seat has to be the one that springs a trap, or a room of five would spring it five
 * times. It is the seat doing the moving, since that is the one that knows a walk happened
 * at all, and what it changes is synced from there like any other change to a piece.
 */
@Injectable({ providedIn: 'root' })
export class TriggerFireService {
  private readonly tableSelecter = inject(TableSelecter);
  private readonly effectLibrary = inject(EffectLibraryService);
  private readonly effectCast = inject(EffectCastService);
  private readonly chat = inject(ChatMessageService);
  private readonly ailments = inject(StatusAilmentService);
  private readonly cutIns = inject(CutInService);
  private readonly audioStorage = inject(AudioStorage);
  private readonly objectStore = inject(ObjectStore);
  private readonly t = inject(TRANSLATE_FN);

  /** Where each piece was lifted from, so putting it down knows what it crossed to get here. */
  private readonly lifted = new Map<string, number>();

  /** Remembers the ground a piece was standing on before a hand took it off the table. */
  pickedUp(piece: GameCharacter): void {
    const cell = this.cellOf(piece);
    if (cell < 0) this.lifted.delete(piece.identifier);
    else this.lifted.set(piece.identifier, cell);
  }

  /**
   * Springs whatever the piece was put down on, which is the one cell a hand ever crosses.
   *
   * A piece carried by hand takes no way: it leaves one cell and arrives at another, and
   * whatever lies between was never walked. Ground that waits for a walk to end and ground
   * that goes off in passing therefore come to the same thing here.
   */
  putDown(piece: GameCharacter): TriggerFiring[] {
    const from = this.lifted.get(piece.identifier);
    this.lifted.delete(piece.identifier);
    const table = this.tableSelecter.viewTable;
    if (from === undefined || !table || table.gridSize <= 0) return [];
    const grid = cellGridOf(table.width, table.height, table.gridSize, table.gridType);
    const to = this.cellOf(piece);
    if (to < 0 || to === from) return [];
    return this.walked(piece, grid, [from, to]);
  }

  private cellOf(piece: GameCharacter): number {
    const table = this.tableSelecter.viewTable;
    if (!table || table.gridSize <= 0 || table.width <= 0 || table.height <= 0) return -1;
    const grid = cellGridOf(table.width, table.height, table.gridSize, table.gridType);
    return pieceCellOf(grid, piece, table.gridSize);
  }

  /**
   * Springs whatever the piece walked onto, and answers with what went off.
   *
   * The way is given cell by cell, beginning where the piece set out from: ground under the
   * first cell is ground the piece was already standing on, and standing still springs
   * nothing. Ground that waits for the walk to end takes only the last cell.
   *
   * Ground that goes off the moment it is stepped on goes off for every cell of it that is
   * stepped on. Wading four cells of a poison swamp is four steps in poison, and a swamp that
   * charged once for the crossing would be a swamp it paid to wade the long way through.
   */
  walked(piece: GameCharacter, grid: CellGrid, way: readonly number[]): TriggerFiring[] {
    if (way.length < 2) return [];

    const walked = way.slice(1);
    const firings: TriggerFiring[] = [];
    for (const [index, cell] of walked.entries()) {
      firings.push(...this.stepped(piece, grid, cell, index === walked.length - 1));
    }
    return firings;
  }

  /**
   * One step of a walk, sprung as the piece arrives on the cell rather than once it is done.
   *
   * A walk drawn cell by cell is walked cell by cell, and a trap under the second cell of it
   * goes off while the piece is standing on the second cell. Springing them all at the end
   * would land four explosions on the far side of a swamp the piece waded through.
   */
  stepped(piece: GameCharacter, grid: CellGrid, cell: number, ending: boolean): TriggerFiring[] {
    const table = this.tableSelecter.viewTable;
    const { col, row } = cellColRow(grid, cell);
    const firings: TriggerFiring[] = [];
    for (const trigger of triggersOn(table)) {
      // Asked again each time: ground with one go in it is spent by the first cell of it.
      if (!trigger.isArmed) continue;
      if (!trigger.covers(col, row)) continue;
      if (trigger.firesOn === 'stop' && !ending) continue;
      if (!triggerCatches(trigger.catches, piece.isNpc)) continue;
      firings.push(this.spring(trigger, piece));
    }
    return firings;
  }

  private spring(trigger: TableTrigger, piece: GameCharacter): TriggerFiring {
    const taken = rollTriggerAmount(trigger.amount);
    const held = this.resourceOf(piece, trigger.element);
    if (held) {
      const current = Number(held.currentValue);
      const most = Number(held.value);
      const next = (Number.isFinite(current) ? current : 0) - taken;
      // Given back rather than taken, a resource stops at the full it was written with.
      held.currentValue = taken < 0 && Number.isFinite(most) ? Math.min(most, next) : next;
    }
    this.leave(trigger, piece);
    if (trigger.once) trigger.spent = true;
    // Ground that was to give itself away does so by being seen, which is the one change to it
    // the room is allowed to notice.
    if (trigger.reveals && !trigger.found) trigger.found = true;
    const firing = { trigger, taken, from: held ? held.name : '' };
    // Neither the show nor the telling is what the ground is for, so neither is allowed to
    // stop it: a room with no chat tab yet, or an effect that will not play, still takes the
    // damage it was walked into.
    try {
      this.play(firing, piece);
    } catch {
      // The effect is a flourish; the ground did its work either way.
    }
    try {
      this.announce(firing, piece);
    } catch {
      // Said or unsaid, the resource has already changed.
    }
    return firing;
  }

  /**
   * Leaves the piece in whatever state the ground was told to leave it in.
   *
   * The state is looked up in the room's list so that a poison painted once is the same poison
   * everywhere. A name the room has never heard of is put on all the same, as a plain mark: a
   * master who types one in is naming a state rather than asking the room for one.
   */
  private leave(trigger: TableTrigger, piece: GameCharacter): void {
    const named = trigger.ailment.trim();
    if (named.length < 1) return;
    const known = this.ailments.ailments().find((held) => held.name === named);
    const held = known ?? newStatusAilment(named);
    const rounds = Math.max(0, Math.floor(trigger.ailmentRounds));
    this.ailments.plant(piece, rounds > 0 ? { ...held, rounds } : held);
  }

  /**
   * Sets off whatever the ground was told to play, on the piece that set it off.
   *
   * Each of the three is tried on its own, so a cut-in nobody has made does not take the sound
   * down with it. All three are named rather than pointed at: a map carried into another room
   * holds identifiers that mean nothing there, and a name that matches one thing and no other
   * still finds it.
   */
  private play(firing: TriggerFiring, piece: GameCharacter): void {
    const trigger = firing.trigger;
    const named = trigger.effect.trim();
    // Looked up past the master-only gate: the ground was painted by the master, so playing
    // what it was told to play is the ground's doing rather than the reader's reaching.
    const preset = named.length > 0 ? this.effectLibrary.presets().find((held) => held.name.trim() === named) : null;
    if (preset) this.effectCast.fire(preset, [piece], null);

    const heard = trigger.sound.trim();
    if (heard.length > 0) {
      const audio = this.audioStorage.audios.filter((held) => held.name.trim() === heard);
      if (audio.length === 1) SoundEffect.play(audio[0]);
    }

    const shown = trigger.cutIn.trim();
    if (shown.length > 0) {
      const found = findByReference(this.objectStore.getObjects<CutIn>(CutIn), '', shown);
      if (found) this.cutIns.launch(found.thing);
    }
  }

  /**
   * Says in the room that the ground went off.
   *
   * Ground that nobody was shown is still ground that took something, and a table that is not
   * told has no way of knowing whether anything happened at all. What is said is what was
   * taken and from whom, never where the ground was: a trap that announces its own cell is a
   * trap the party has found.
   *
   * Ground given a line of its own says that instead of saying merely that it went off, and
   * still says what it took on a line after it: the description is the master's telling, and
   * what a piece lost is the table's reckoning.
   */
  private announce(firing: TriggerFiring, piece: GameCharacter): void {
    const trigger = firing.trigger;
    const name = trigger.name.trim();
    const called = name.length > 0 ? name : this.t('feature.tabletop.trigger.unnamed');
    const said = trigger.say.trim();
    if (said.length > 0) this.tell(trigger, this.t('feature.tabletop.trigger.said', { trigger: called, say: said }));
    this.ask(trigger, piece, called);
    if (firing.from.length > 0) {
      this.tell(
        trigger,
        this.t('feature.tabletop.trigger.tookFrom', {
          trigger: called,
          piece: piece.name,
          amount: Math.abs(firing.taken),
          element: firing.from,
          verb: this.t(firing.taken < 0 ? 'feature.tabletop.trigger.gave' : 'feature.tabletop.trigger.took'),
        })
      );
      return;
    }
    // Ground that took nothing and described nothing still says it was walked into, or a table
    // would have no way of telling a trap that did nothing from ground that is not trapped.
    if (said.length < 1)
      this.tell(trigger, this.t('feature.tabletop.trigger.sprang', { trigger: called, piece: piece.name }));
  }

  /**
   * Asks whoever walked in for the roll the ground wants of them.
   *
   * Asked for rather than rolled. Which dice a table throws, and what counts as making it, are
   * the game's business: a piece of ground that rolled for itself would have to know one game's
   * terms, and a room playing another would be handed an answer in the wrong language.
   */
  private ask(trigger: TableTrigger, piece: GameCharacter, called: string): void {
    const asked = trigger.check.trim();
    if (asked.length < 1) return;
    const target = trigger.checkTarget.trim();
    const key = target.length > 0 ? 'feature.tabletop.trigger.asksFor' : 'feature.tabletop.trigger.asks';
    this.tell(trigger, this.t(key, { trigger: called, piece: piece.name, check: asked, target }));
  }

  /**
   * Writes one line for a piece of ground, held back from the room where the ground is quiet.
   *
   * A held-back line is sent whole and kept from the room by the view, so the master reads it
   * and nobody else does. It is sent from nobody in particular on purpose: sent from the seat
   * that moved, the very player who was not to notice would be the one who could read it.
   */
  private tell(trigger: TableTrigger, text: string): void {
    if (trigger.silent) this.chat.sendSecretSystemMessageToMainTab(text);
    else this.chat.sendSystemMessageToMainTab(text);
  }

  private resourceOf(piece: GameCharacter, name: string): DataElement | null {
    const root = piece.rootDataElement;
    if (!root || name.length < 1) return null;
    const held = DataElement.findElementByReference(root, name);
    return held && held.isNumberResource ? held : null;
  }
}
