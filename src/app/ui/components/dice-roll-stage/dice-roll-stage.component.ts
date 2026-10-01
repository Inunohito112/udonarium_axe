import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  viewChild,
} from '@angular/core';
import { DiceRenderService } from '@axe/application/dice/dice-render.service';
import { DiceThrowService } from '@axe/application/dice/dice-throw.service';

/** How near the foot of a scrolling log counts as at it. */
const AT_FOOT_PX = 24;

/**
 * The dice of a chat roll tumbling in the frame of the line that answered it.
 *
 * It shows only for a roll this device is throwing, and takes its height from the start, so a
 * log that was at its foot when it opened is kept at its foot.
 */
@Component({
  selector: 'dice-roll-stage',
  templateUrl: './dice-roll-stage.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class DiceRollStageComponent {
  /** The dice bot's answer whose dice are shown. */
  readonly messageIdentifier = input.required<string>();

  private readonly throws = inject(DiceThrowService);
  private readonly renderer = inject(DiceRenderService);
  private readonly injector = inject(Injector);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  /** The throw on show here, or null when there is none to show. */
  protected readonly diceThrow = computed(() => {
    const diceThrow = this.throws.throws().get(this.messageIdentifier());
    return diceThrow && diceThrow.stage === 'frame' && diceThrow.phase !== 'failed' ? diceThrow : null;
  });

  constructor() {
    effect((onCleanup) => {
      const canvas = this.canvas()?.nativeElement;
      if (!canvas) return;
      const handle = this.renderer.register(canvas, this.messageIdentifier());
      const observer =
        typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(([entry]) => handle.resize(entry.contentRect.width, entry.contentRect.height));
      observer?.observe(canvas);
      if (!observer) handle.resize(canvas.clientWidth, canvas.clientHeight);
      afterNextRender(() => keepAtFoot(canvas), { injector: this.injector });
      onCleanup(() => {
        observer?.disconnect();
        handle.release();
      });
    });
  }
}

/** Scrolls the log a stage opened in back to its foot, if it was there before the stage took its room. */
function keepAtFoot(stage: HTMLElement): void {
  const log = scrollingAncestorOf(stage);
  if (!log) return;
  const below = log.scrollHeight - log.clientHeight - log.scrollTop;
  if (below - stage.getBoundingClientRect().height <= AT_FOOT_PX) log.scrollTop = log.scrollHeight;
}

function scrollingAncestorOf(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const overflow = getComputedStyle(at).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && at.scrollHeight > at.clientHeight) return at;
  }
  return null;
}
