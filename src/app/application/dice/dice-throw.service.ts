import { computed, DestroyRef, inject, Injectable, Signal, signal } from '@angular/core';
import { DiceTrayPlacementService, TablePlacement } from '@axe/application/dice/dice-tray-placement.service';
import { MotionService } from '@axe/application/ui/motion.service';
import { diceThrow$, messageAdded$ } from '@axe/core/event/domain-events';
import { isNetworkIsolated } from '@axe/core/network/network-isolation';
import { ObjectStore } from '@axe/core/sync/object-store';
import { ChatMessage } from '@axe/domain/chat/chat-message';
import { ChatTab } from '@axe/domain/chat/chat-tab';
import { canRoleViewTab } from '@axe/domain/chat/chat-tab-permission';
import { DieToThrow, labelOf, throwPlanOf } from '@axe/domain/dice/dice-3d/dice-throw-plan';
import { upFace } from '@axe/domain/dice/dice-3d/die-symmetry';
import { polyhedronOf } from '@axe/domain/dice/dice-3d/polyhedra';
import { restingLayout } from '@axe/domain/dice/dice-3d/resting-pose';
import { Quat, quatFromAxisAngle, quatMultiply, quatRotate, UP } from '@axe/domain/dice/dice-3d/rotation';
import { throwSeedOf } from '@axe/domain/dice/dice-3d/throw-seed';
import { Tray } from '@axe/domain/dice/dice-3d/throw-validation';
import { FRAME_TRAY_AREA, frameAspectFor, trayFor } from '@axe/domain/dice/dice-3d/tray-size';
import { DiceRollOutcome } from '@axe/domain/dice/dice-roll-detail';
import { Config } from '@axe/domain/peer/config';
import { PeerCursor } from '@axe/domain/peer/peer-cursor';
import { faceFramesOf } from '@axe/infrastructure/dice-3d/dice-geometry';
import { throwDice } from '@axe/infrastructure/dice-3d/dice-physics-client';
import { DiceThrowResult, FRAME_STRIDE, FRAMES_PER_SECOND } from '@axe/infrastructure/dice-3d/dice-physics-message';

/**
 * How lately a roll has to have been answered to be thrown. A device that comes back to the room
 * after a while away is handed what it missed, and none of that is thrown.
 */
export const JUST_ROLLED_MS = 30_000;
/** How long a throw waits for the line it throws the dice of, which can come after the call to throw. */
export const LINE_WAIT_MS = 5_000;
/** How many throws tumble at once; any more are shown where they came to rest. */
export const MAX_TUMBLING = 3;
/** How many throws are kept, so a line scrolled back into view still shows its dice. */
export const KEPT_THROWS = 30;

/**
 * Where a throw has got to: being worked out, tumbling, come to rest, or not to be shown at all
 * because the dice could not be drawn.
 */
export type DiceThrowPhase = 'working' | 'rolling' | 'settled' | 'failed';

/** A chat roll's dice, thrown in the frame of the line that answered it or on the table. */
export interface DiceThrow {
  readonly messageIdentifier: string;
  /** Where they are thrown. */
  readonly stage: 'frame' | 'table';
  /** Where on the table, for a throw there. */
  readonly placement: TablePlacement | null;
  readonly dice: readonly DieToThrow[];
  /** How many more dice the roll had than are thrown. */
  readonly overflow: number;
  /** The colour of the dice: the colour the roll was said in. */
  readonly color: string;
  readonly tray: Tray;
  /** The tray's width over its depth, which is the frame's for a throw in one. */
  readonly aspect: number;
  readonly phase: DiceThrowPhase;
  /** How the dice move and the turns that show their numbers, once worked out. */
  readonly result: DiceThrowResult | null;
  /** When the dice began to tumble, on the clock `performance.now()` keeps. */
  readonly startedAt: number;
  /** Whether the dice are only laid down showing their numbers, with no tumble. */
  readonly still: boolean;
  /** What each drawn die shows once at rest, read off how it is turned. */
  readonly shown: readonly string[];
  /** Whether the roll was a critical or a fumble, which the dice flash as they come to rest. */
  readonly outcome: DiceRollOutcome;
}

const BLANK_COLOR = '#202024';
/** The most a die laid down leans once its number is turned upright, in radians. */
const MAX_LEAN_KEPT = 0.15;
const NO_TURN: Quat = [0, 0, 0, 1];

/**
 * Throws the dice of a chat roll the room is told to throw.
 *
 * The device that rolled tells the room, and every device - the roller's own among them - throws
 * the dice once the line with the result has reached it, so long as the room shows rolls this
 * way, the line was just said, and this reader may see it: a secret roll is thrown for the one
 * who rolled it alone. A replay, which plays the room back cut off from it, throws nothing.
 *
 * Every device works the throw out from the line itself, so all of them see the dice tumble much
 * the same way and land on the numbers the roll came to.
 */
@Injectable({ providedIn: 'root' })
export class DiceThrowService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly objectStore = inject(ObjectStore);
  private readonly motion = inject(MotionService);
  private readonly placements = inject(DiceTrayPlacementService);
  private readonly state = signal<ReadonlyMap<string, DiceThrow>>(new Map());
  /** The lines already called to be thrown, kept beyond the throws themselves so none is thrown twice. */
  private readonly called = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Every throw kept, by the line whose dice it throws. */
  readonly throws: Signal<ReadonlyMap<string, DiceThrow>> = this.state.asReadonly();

  /** How many throws are being worked out or are tumbling. */
  readonly busy = computed(
    () => [...this.state().values()].filter((t) => t.phase === 'working' || t.phase === 'rolling').length
  );

  constructor() {
    diceThrow$.subscribe(
      (event) => void this.receive(event.messageIdentifier, event.speakerIdentifier ?? ''),
      this.destroyRef
    );
    this.destroyRef.onDestroy(() => this.timers.forEach((timer) => clearTimeout(timer)));
  }

  /** Gives up showing a throw, as when its dice cannot be drawn on this device. */
  fail(messageIdentifier: string): void {
    this.update(messageIdentifier, { phase: 'failed' });
  }

  private async receive(messageIdentifier: string, speakerIdentifier: string): Promise<void> {
    if (isNetworkIsolated() || this.called.has(messageIdentifier)) return;
    this.called.add(messageIdentifier);
    if (this.called.size > KEPT_THROWS * 4) this.called.delete(this.called.values().next().value!);

    const stage = this.config.diceStage;
    if (stage === 'off') return;
    const message = await this.arrivalOf(messageIdentifier);
    if (!message || !this.mayThrow(message)) return;
    const plan = throwPlanOf(message.rollDetail);
    if (plan.dice.length < 1) return;

    // A reader who keeps the screen still has nothing put on the table, which they are moving about on.
    if (stage === 'table' && !this.motion.enabled()) return;
    const placement = stage === 'table' ? this.placements.placementFor(speakerIdentifier, plan.dice.length) : null;
    if (stage === 'table' && !placement) return;
    const tray = placement?.tray ?? trayFor(plan.dice.length, frameAspectFor(plan.dice.length), FRAME_TRAY_AREA);
    const still = !this.motion.enabled() || this.busy() >= MAX_TUMBLING;
    const color = message.messColor?.length ? message.messColor : BLANK_COLOR;
    this.add({
      messageIdentifier,
      stage,
      placement,
      dice: plan.dice,
      overflow: plan.overflow,
      color,
      tray,
      aspect: tray.halfWidth / tray.halfDepth,
      phase: 'working',
      result: null,
      startedAt: 0,
      still,
      shown: [],
      outcome: message.rollDetail?.outcome ?? '',
    });

    const result = still
      ? laidDown(plan.dice, tray, messageIdentifier)
      : await this.worked(messageIdentifier, plan.dice, tray);
    if (!result || !this.state().has(messageIdentifier)) return;
    this.update(messageIdentifier, {
      phase: still ? 'settled' : 'rolling',
      result,
      startedAt: performance.now(),
      shown: shownBy(plan.dice, result),
    });
    if (!still) this.settleAfter(messageIdentifier, ((result.frameCount - 1) / FRAMES_PER_SECOND) * 1000);
  }

  /**
   * Has a throw come to rest as long after a moment as its dice take to stop, the moment it began
   * to play where it is drawn, which can be later than when it was worked out.
   */
  played(messageIdentifier: string, at: number): void {
    const diceThrow = this.state().get(messageIdentifier);
    if (diceThrow?.phase !== 'rolling' || !diceThrow.result) return;
    const total = ((diceThrow.result.frameCount - 1) / FRAMES_PER_SECOND) * 1000;
    this.settleAfter(messageIdentifier, Math.max(0, at + total - performance.now()));
  }

  private settleAfter(messageIdentifier: string, ms: number): void {
    clearTimeout(this.timers.get(messageIdentifier));
    this.timers.set(
      messageIdentifier,
      setTimeout(() => {
        this.timers.delete(messageIdentifier);
        this.update(messageIdentifier, { phase: 'settled' });
      }, ms)
    );
  }

  private get config(): Config {
    return this.objectStore.get<Config>('Config') ?? Config.instance;
  }

  /** The line, at once if it is here, or when it arrives within a few seconds. */
  private arrivalOf(identifier: string): Promise<ChatMessage | null> {
    const here = this.objectStore.get<ChatMessage>(identifier);
    if (here instanceof ChatMessage) return Promise.resolve(here);
    return new Promise((resolve) => {
      const done = (message: ChatMessage | null) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(message);
      };
      const unsubscribe = messageAdded$.subscribe((event) => {
        if (event.messageIdentifier !== identifier) return;
        const message = this.objectStore.get<ChatMessage>(identifier);
        done(message instanceof ChatMessage ? message : null);
      });
      const timer = setTimeout(() => done(null), LINE_WAIT_MS);
    });
  }

  private mayThrow(message: ChatMessage): boolean {
    if (!message.isDicebot) return false;
    if (Date.now() - message.timestamp > JUST_ROLLED_MS) return false;
    if (!message.isDisplayable) return false;
    if (message.isSecret && !message.isSendFromSelf) return false;
    const tab = this.objectStore.get<ChatTab>(message.tabIdentifier);
    return tab instanceof ChatTab && canRoleViewTab(tab, PeerCursor.myRole);
  }

  private async worked(key: string, dice: readonly DieToThrow[], tray: Tray): Promise<DiceThrowResult | null> {
    try {
      return await throwDice({
        key,
        shapes: dice.map((die) => die.shape),
        targets: dice.map((die) => die.target),
        tray,
        edge: 'left',
        away: [0, 1, 0],
      });
    } catch {
      this.fail(key);
      return null;
    }
  }

  private add(diceThrow: DiceThrow): void {
    const next = new Map(this.state());
    next.set(diceThrow.messageIdentifier, diceThrow);
    while (next.size > KEPT_THROWS) {
      const oldest = next.keys().next().value!;
      next.delete(oldest);
      clearTimeout(this.timers.get(oldest));
      this.timers.delete(oldest);
    }
    this.state.set(next);
  }

  private update(messageIdentifier: string, change: Partial<DiceThrow>): void {
    const current = this.state().get(messageIdentifier);
    if (!current) return;
    const next = new Map(this.state());
    next.set(messageIdentifier, { ...current, ...change });
    this.state.set(next);
  }
}

/** A recording of a single frame, the dice laid down side by side showing their numbers. */
function laidDown(dice: readonly DieToThrow[], tray: Tray, key: string): DiceThrowResult {
  const poses = restingLayout(dice, tray, throwSeedOf(key));
  const frames = new Float32Array(dice.length * FRAME_STRIDE);
  poses.forEach((pose, index) =>
    frames.set([...pose.position, ...readable(dice[index], pose.rotation)], index * FRAME_STRIDE)
  );
  return {
    frameCount: 1,
    restFrame: 0,
    frames,
    landed: dice.map((die) => die.target),
    corrections: dice.map(() => NO_TURN),
    attempt: 0,
    fault: null,
  };
}

/**
 * A die laid down turned about the upright so its number reads the right way up to the reader,
 * keeping a little of the lean it was laid with so a row of dice does not look stamped out.
 */
function readable(die: DieToThrow, rotation: Quat): Quat {
  if (polyhedronOf(die.shape).readsCorners) return rotation;
  const [x, y] = quatRotate(rotation, faceFramesOf(die.shape)[die.target].up);
  const lean = Math.atan2(-x, y);
  const kept = Math.sign(lean) * Math.min(Math.abs(lean), MAX_LEAN_KEPT);
  return quatMultiply(quatFromAxisAngle(UP, kept - lean), rotation);
}

/** What each die shows at the end of its recording, turned as it is drawn. */
function shownBy(dice: readonly DieToThrow[], result: DiceThrowResult): string[] {
  const last = result.frameCount - 1;
  return dice.map((die, index) => {
    const at = (last * dice.length + index) * FRAME_STRIDE + 3;
    const rest: Quat = [result.frames[at], result.frames[at + 1], result.frames[at + 2], result.frames[at + 3]];
    const poly = polyhedronOf(die.shape);
    return labelOf(die.shape, die.labels, upFace(poly, quatMultiply(rest, result.corrections[index])));
  });
}
