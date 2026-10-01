import { DestroyRef, effect, inject, Injectable, InjectionToken } from '@angular/core';
import { DiceThrow, DiceThrowService } from '@axe/application/dice/dice-throw.service';
import { RenderLiteService } from '@axe/application/ui/render-lite.service';
import { Logger } from '@axe/core/logging/logger';
import type { Dice3dEngine, PreparedThrow } from '@axe/infrastructure/dice-3d/dice-3d-engine';

/** What the dice are drawn with: the part of the 3D engine the page uses. */
export type DiceEngine = Pick<Dice3dEngine, 'canvas' | 'isLost' | 'prepare' | 'render' | 'dispose'>;

/** Starts the engine, loading it and the drawing library with it on first use. */
export const DICE_ENGINE_LOADER = new InjectionToken<() => Promise<DiceEngine>>('DICE_ENGINE_LOADER', {
  providedIn: 'root',
  factory: () => () =>
    import('@axe/infrastructure/dice-3d/dice-3d-engine').then(({ Dice3dEngine }) => Dice3dEngine.create()),
});

/** The sharpest the dice are drawn, in device pixels to a CSS pixel, and on a device drawn lightly. */
const MAX_PIXEL_RATIO = 2;
const LITE_PIXEL_RATIO = 1.5;

/** A canvas a throw is shown on, and how it stands now. */
export interface DiceStageHandle {
  /** Tells the stage its size in CSS pixels, which it is redrawn at. */
  resize(width: number, height: number): void;
  /** Takes the canvas off the stage. */
  release(): void;
}

interface Stage {
  readonly canvas: HTMLCanvasElement;
  readonly messageIdentifier: string;
  width: number;
  height: number;
  /** Whether the canvas holds a picture of the throw as it stands now. */
  drawn: boolean;
}

/**
 * Draws the dice of every throw on show.
 *
 * One engine draws them all, off screen, a throw at a time, and its picture is copied onto each
 * canvas the throw is shown on, so a line shown in two chat windows is drawn once. The drawing
 * library is loaded only when there is a throw to draw, and frames are drawn only while a throw
 * on show is tumbling; one at rest is drawn once and left.
 */
@Injectable({ providedIn: 'root' })
export class DiceRenderService {
  private readonly throws = inject(DiceThrowService);
  private readonly renderLite = inject(RenderLiteService);
  private readonly loadEngine = inject(DICE_ENGINE_LOADER);
  private readonly stages = new Set<Stage>();
  private readonly prepared = new Map<string, { result: DiceThrow['result']; prepared: PreparedThrow }>();
  private engine: DiceEngine | null = null;
  private starting: Promise<DiceEngine | null> | null = null;
  private broken = false;
  private frame = 0;

  constructor() {
    // A throw worked out, come to rest or dropped is drawn afresh wherever it is on show.
    effect(() => {
      this.throws.throws();
      for (const stage of this.stages) stage.drawn = false;
      this.wake();
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.engine?.dispose();
    });
  }

  /** Shows a throw on a canvas until the handle is released. */
  register(canvas: HTMLCanvasElement, messageIdentifier: string): DiceStageHandle {
    const stage: Stage = { canvas, messageIdentifier, width: 0, height: 0, drawn: false };
    this.stages.add(stage);
    this.wake();
    return {
      resize: (width, height) => {
        if (width === stage.width && height === stage.height) return;
        stage.width = width;
        stage.height = height;
        stage.drawn = false;
        this.wake();
      },
      release: () => this.stages.delete(stage),
    };
  }

  /** Has the stages drawn again on the next frame, as when a throw on show has moved on. */
  wake(): void {
    if (this.frame || this.broken || this.stages.size < 1) return;
    this.frame = requestAnimationFrame((now) => this.draw(now));
  }

  private draw(now: number): void {
    this.frame = 0;
    const engine = this.engine;
    if (!engine) {
      void this.start();
      return;
    }
    if (engine.isLost) {
      this.giveUp();
      return;
    }

    const throws = this.throws.throws();
    for (const id of this.prepared.keys()) if (!throws.has(id)) this.prepared.delete(id);

    let tumbling = false;
    for (const [id, stages] of this.byThrow()) {
      const diceThrow = throws.get(id);
      if (!diceThrow?.result || diceThrow.phase === 'failed') continue;
      const prepared = this.preparedFor(engine, diceThrow);
      const seconds = diceThrow.still ? prepared.totalSeconds : (now - diceThrow.startedAt) / 1000;
      const moving = seconds < prepared.totalSeconds;
      tumbling ||= moving;
      const due = stages.filter((stage) => moving || !stage.drawn).filter((stage) => stage.width > 0);
      if (due.length < 1) continue;

      const width = Math.max(...due.map((stage) => stage.width));
      const height = Math.max(...due.map((stage) => stage.height));
      const pixelRatio = Math.min(devicePixelRatio || 1, this.renderLite.active() ? LITE_PIXEL_RATIO : MAX_PIXEL_RATIO);
      engine.render(
        prepared,
        Math.min(seconds, prepared.totalSeconds),
        { kind: 'frame' },
        { width, height, pixelRatio }
      );
      for (const stage of due) copy(engine.canvas, stage, pixelRatio);
    }
    if (tumbling) this.wake();
  }

  private start(): Promise<DiceEngine | null> {
    this.starting ??= this.loadEngine()
      .then((engine) => {
        this.engine = engine;
        this.wake();
        return engine;
      })
      .catch((error: unknown) => {
        Logger.warn('The 3D dice could not be drawn on this device', error);
        this.giveUp();
        return null;
      });
    return this.starting;
  }

  /** Stops drawing for good, and has every throw on show put away. */
  private giveUp(): void {
    this.broken = true;
    for (const id of this.throws.throws().keys()) this.throws.fail(id);
  }

  private preparedFor(engine: DiceEngine, diceThrow: DiceThrow): PreparedThrow {
    const kept = this.prepared.get(diceThrow.messageIdentifier);
    if (kept && kept.result === diceThrow.result) return kept.prepared;
    const prepared = engine.prepare({
      dice: diceThrow.dice,
      color: diceThrow.color,
      tray: diceThrow.tray,
      result: diceThrow.result!,
    });
    this.prepared.set(diceThrow.messageIdentifier, { result: diceThrow.result, prepared });
    return prepared;
  }

  private byThrow(): Map<string, Stage[]> {
    const grouped = new Map<string, Stage[]>();
    for (const stage of this.stages) {
      const list = grouped.get(stage.messageIdentifier) ?? [];
      list.push(stage);
      grouped.set(stage.messageIdentifier, list);
    }
    return grouped;
  }
}

/** Copies the engine's picture onto a stage's canvas, sized to the stage. */
function copy(source: HTMLCanvasElement, stage: Stage, pixelRatio: number): void {
  const width = Math.max(1, Math.round(stage.width * pixelRatio));
  const height = Math.max(1, Math.round(stage.height * pixelRatio));
  if (stage.canvas.width !== width) stage.canvas.width = width;
  if (stage.canvas.height !== height) stage.canvas.height = height;
  const context = stage.canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  stage.drawn = true;
}
