import { DestroyRef, effect, inject, Injectable, InjectionToken } from '@angular/core';
import { DiceThrow, DiceThrowService } from '@axe/application/dice/dice-throw.service';
import { CoordinateService } from '@axe/application/input/coordinate.service';
import { RenderLiteService } from '@axe/application/ui/render-lite.service';
import { Logger } from '@axe/core/logging/logger';
import { clipMatrixOf, columnsOf, eyeOf, multiply, Point3, transform } from '@axe/core/transform/css-clip-matrix';
import type { Tray } from '@axe/domain/dice/dice-3d/throw-validation';
import type { Dice3dEngine, DrawnRegion, PreparedThrow } from '@axe/infrastructure/dice-3d/dice-3d-engine';

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
/** How long dice at rest stay on the table before they fade, and how long they take to, in seconds. */
export const TABLE_HOLD_SECONDS = 2.5;
export const TABLE_FADE_SECONDS = 0.6;
/**
 * How far around its tray a throw on the table is drawn, in the tray's units: high enough for the
 * dice as they come in, outside the edge they come in over, and out to where their shadows fall.
 */
const TABLE_REACH_UP = 6;
const TABLE_REACH_IN = 3;
const TABLE_REACH_SHADOW = 6;
/** How often the table's view is read again while it seems to stand still, in milliseconds. */
const STILL_VIEW_MS = 1000;

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

interface TableStage {
  readonly canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/**
 * Draws the dice of every throw on show.
 *
 * One engine draws them all, off screen, a throw at a time, and its picture is copied onto each
 * canvas the throw is shown on: a line's frame, however many chat windows show the line, or the
 * sheet laid over the table. The drawing library is loaded only when there is a throw to draw,
 * and frames are drawn only while a throw on show is moving; one at rest in a frame is drawn once
 * and left, and one on the table stays a while and fades.
 */
@Injectable({ providedIn: 'root' })
export class DiceRenderService {
  private readonly throws = inject(DiceThrowService);
  private readonly renderLite = inject(RenderLiteService);
  private readonly coordinates = inject(CoordinateService);
  private readonly loadEngine = inject(DICE_ENGINE_LOADER);
  private readonly stages = new Set<Stage>();
  private table: TableStage | null = null;
  private readonly prepared = new Map<string, { result: DiceThrow['result']; prepared: PreparedThrow }>();
  private engine: DiceEngine | null = null;
  private starting: Promise<DiceEngine | null> | null = null;
  private broken = false;
  private frame = 0;
  private view: { key: string; columns: number[] } | null = null;

  constructor() {
    // A throw worked out, come to rest or dropped is drawn afresh wherever it is on show.
    effect(() => {
      this.throws.throws();
      for (const stage of this.stages) stage.drawn = false;
      this.wake();
    });
    // So is the table's sheet when the table is turned or moved under it.
    effect(() => {
      this.coordinates.tabletopTransformVersion();
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

  /** Shows the throws on the table on a canvas laid over it, until the handle is released. */
  registerTable(canvas: HTMLCanvasElement): DiceStageHandle {
    const stage: TableStage = { canvas, width: 0, height: 0 };
    this.table = stage;
    this.wake();
    return {
      resize: (width, height) => {
        stage.width = width;
        stage.height = height;
        this.wake();
      },
      release: () => {
        if (this.table === stage) this.table = null;
      },
    };
  }

  /** Has the stages drawn again on the next frame, as when a throw on show has moved on. */
  wake(): void {
    if (this.frame || this.broken || (this.stages.size < 1 && !this.table)) return;
    this.frame = requestAnimationFrame((now) => this.draw(now));
  }

  private draw(now: number): void {
    this.frame = 0;
    const throws = this.throws.throws();
    const onTable = [...throws.values()].some((t) => t.stage === 'table' && t.result && t.phase !== 'failed');
    if (this.stages.size < 1 && !onTable) {
      this.clearTable();
      return;
    }
    const engine = this.engine;
    if (!engine) {
      void this.start();
      return;
    }
    if (engine.isLost) {
      this.giveUp();
      return;
    }

    for (const id of this.prepared.keys()) if (!throws.has(id)) this.prepared.delete(id);
    const pixelRatio = Math.min(devicePixelRatio || 1, this.renderLite.active() ? LITE_PIXEL_RATIO : MAX_PIXEL_RATIO);

    let moving = false;
    for (const [id, stages] of this.byThrow()) {
      const diceThrow = throws.get(id);
      if (!diceThrow?.result || diceThrow.phase === 'failed' || diceThrow.stage !== 'frame') continue;
      const prepared = this.preparedFor(engine, diceThrow);
      const seconds = diceThrow.still ? prepared.totalSeconds : (now - diceThrow.startedAt) / 1000;
      const tumbling = seconds < prepared.totalSeconds;
      moving ||= tumbling;
      const due = stages.filter((stage) => (tumbling || !stage.drawn) && stage.width > 0);
      if (due.length < 1) continue;

      const width = Math.max(...due.map((stage) => stage.width));
      const height = Math.max(...due.map((stage) => stage.height));
      const region = engine.render(
        prepared,
        Math.min(seconds, prepared.totalSeconds),
        { kind: 'frame' },
        { width, height, pixelRatio }
      );
      for (const stage of due) copy(engine.canvas, region, stage, pixelRatio);
    }
    if (this.drawTable(engine, throws, now, pixelRatio)) moving = true;
    if (moving) this.wake();
  }

  /**
   * Draws the throws on the table over it, each where its tray lies as the table is seen now, and
   * says whether any is still on show.
   */
  private drawTable(
    engine: DiceEngine,
    throws: ReadonlyMap<string, DiceThrow>,
    now: number,
    pixelRatio: number
  ): boolean {
    const table = this.table;
    if (!table) return false;
    const showing = [...throws.values()].filter((diceThrow) => this.isOnTable(engine, diceThrow, now));
    const context = this.clearTable(showing.length > 0 ? pixelRatio : 0);
    if (!context || showing.length < 1) return false;

    const host = table.canvas.getBoundingClientRect();
    for (const diceThrow of showing) {
      const prepared = this.preparedFor(engine, diceThrow);
      const seconds = (now - diceThrow.startedAt) / 1000;
      const total = diceThrow.still ? 0 : prepared.totalSeconds;
      const fadeFrom = total + TABLE_HOLD_SECONDS;
      const shot = this.shotOf(diceThrow.placement!.model, diceThrow.tray, host, now);
      if (!shot) continue;
      const region = engine.render(
        prepared,
        diceThrow.still ? prepared.totalSeconds : Math.min(seconds, total),
        { kind: 'table', projection: shot.clip, eye: shot.eye },
        { width: shot.width, height: shot.height, pixelRatio }
      );
      context.globalAlpha = seconds <= fadeFrom ? 1 : Math.max(0, 1 - (seconds - fadeFrom) / TABLE_FADE_SECONDS);
      context.drawImage(
        engine.canvas,
        region.x,
        region.y,
        region.width,
        region.height,
        (shot.left - host.left) * pixelRatio,
        (shot.top - host.top) * pixelRatio,
        shot.width * pixelRatio,
        shot.height * pixelRatio
      );
    }
    context.globalAlpha = 1;
    return true;
  }

  /** Whether a throw is on the table and still to be seen there: tumbling, at rest a while, or fading. */
  private isOnTable(engine: DiceEngine, diceThrow: DiceThrow, now: number): boolean {
    if (diceThrow.stage !== 'table' || !diceThrow.result || !diceThrow.placement) return false;
    if (diceThrow.phase === 'failed') return false;
    const total = diceThrow.still ? 0 : this.preparedFor(engine, diceThrow).totalSeconds;
    return (now - diceThrow.startedAt) / 1000 < total + TABLE_HOLD_SECONDS + TABLE_FADE_SECONDS;
  }

  /**
   * Empties the table's sheet and sizes it to its stage, or with no pixel ratio shrinks it to
   * nothing, so a sheet with no dice on it holds no picture the size of the screen.
   */
  private clearTable(pixelRatio = 0): CanvasRenderingContext2D | null {
    const table = this.table;
    if (!table) return null;
    const width = pixelRatio > 0 ? Math.max(1, Math.round(table.width * pixelRatio)) : 1;
    const height = pixelRatio > 0 ? Math.max(1, Math.round(table.height * pixelRatio)) : 1;
    if (table.canvas.width !== width) table.canvas.width = width;
    if (table.canvas.height !== height) table.canvas.height = height;
    const context = table.canvas.getContext('2d');
    context?.clearRect(0, 0, width, height);
    return context;
  }

  /**
   * How a tray on the table is drawn: the part of the screen its dice can reach, and the matrix and
   * eye that lay the dice over the table there. Null when none of it is on the screen.
   */
  private shotOf(model: readonly number[], tray: Tray, host: DOMRect, now: number) {
    const toPage = multiply(this.tableView(now), model);
    const bounds: Point3[] = [
      -tray.halfWidth - Math.max(TABLE_REACH_IN, TABLE_REACH_SHADOW),
      tray.halfWidth + TABLE_REACH_SHADOW,
    ].flatMap((x) =>
      [-tray.halfDepth - TABLE_REACH_SHADOW, tray.halfDepth + TABLE_REACH_SHADOW].flatMap((y) =>
        [0, TABLE_REACH_UP].map((z): Point3 => [x, y, z])
      )
    );
    const corners = bounds.map((point) => transform(toPage, point));
    if (corners.some(([, , , w]) => w <= 0)) return null;
    const xs = corners.map(([x, , , w]) => x / w);
    const ys = corners.map(([, y, , w]) => y / w);
    const left = Math.floor(Math.max(host.left, Math.min(...xs)));
    const top = Math.floor(Math.max(host.top, Math.min(...ys)));
    const right = Math.ceil(Math.min(host.right, Math.max(...xs)));
    const bottom = Math.ceil(Math.min(host.bottom, Math.max(...ys)));
    if (right - left < 1 || bottom - top < 1) return null;
    const rect = { left, top, width: right - left, height: bottom - top };
    const clip = clipMatrixOf(toPage, rect, bounds);
    return { ...rect, clip, eye: eyeOf(clip) };
  }

  /**
   * The table's matrix onto the page, read again when the view has been written out and now and
   * then while it stands still, since reading it lays the page out.
   */
  private tableView(now: number): number[] {
    const key = `${this.coordinates.tabletopTransformVersion()}:${Math.floor(now / STILL_VIEW_MS)}`;
    if (this.view?.key !== key) this.view = { key, columns: columnsOf(this.coordinates.tabletopSceneMatrix()) };
    return this.view.columns;
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
    this.clearTable();
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
function copy(source: HTMLCanvasElement, region: DrawnRegion, stage: Stage, pixelRatio: number): void {
  const width = Math.max(1, Math.round(stage.width * pixelRatio));
  const height = Math.max(1, Math.round(stage.height * pixelRatio));
  if (stage.canvas.width !== width) stage.canvas.width = width;
  if (stage.canvas.height !== height) stage.canvas.height = height;
  const context = stage.canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, width, height);
  context.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, width, height);
  stage.drawn = true;
}
