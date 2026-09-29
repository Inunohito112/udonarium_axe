import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { UiSignalService } from '@axe/application/ui/ui-signal.service';
import { WIDGET_COMPASS } from '@axe/application/ui/widget-place';
import { WidgetVisibilityService } from '@axe/application/ui/widget-visibility.service';
import { compassPointOf, northNeedleAngle, screenBearingOf } from '@axe/domain/ui/compass';
import { DraggableDirective } from '@axe/ui/directives/draggable.directive';
import { WidgetPlaceDirective } from '@axe/ui/directives/widget-place.directive';
import { TranslocoModule } from '@jsverse/transloco';

/**
 * Which way the table is facing, drawn as a compass.
 *
 * The table is turned about the vertical far more often than anybody keeps track of, and a room
 * described as "the door is on the north wall" is no use once the view has been dragged round.
 * The rose turns with the table, so north on the table is north on the compass.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-compass',
  templateUrl: './compass.component.html',
  imports: [DraggableDirective, WidgetPlaceDirective, TranslocoModule],
})
export class CompassComponent {
  protected readonly widgets = inject(WidgetVisibilityService);
  private readonly uiSignal = inject(UiSignalService);

  protected readonly widgetName = WIDGET_COMPASS;
  protected readonly fallback = (el: HTMLElement) => ({
    left: Math.max(8, window.innerWidth - el.offsetWidth - 8),
    top: 96,
  });

  /** How far round the rose is drawn, which is how far the table has been turned. */
  protected readonly roseAngle = computed(() => northNeedleAngle(this.uiSignal.tableViewRotationZ()));

  /** Which way the top of the screen looks, in whole degrees. */
  protected readonly bearing = computed(() => Math.round(screenBearingOf(this.uiSignal.tableViewRotationZ())) % 360);

  /** What that bearing is called. */
  protected readonly pointKey = computed(() => `feature.compass.point.${compassPointOf(this.bearing())}`);

  protected close(): void {
    this.widgets.compass.set(false);
  }
}
