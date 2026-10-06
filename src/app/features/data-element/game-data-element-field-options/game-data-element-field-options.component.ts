import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TRANSLATE_FN } from '@axe/application/i18n/translate.token';
import { ObjectChangeService } from '@axe/application/sync/object-change.service';
import {
  playsEffectOnChange,
  playsSoundOnChange,
  RESOURCE_SOUND_SET_OPTIONS,
  ResourceSoundSet,
  soundSetOnChange,
} from '@axe/domain/character/resource-feedback';
import { showsResourceSlider } from '@axe/domain/character/resource-slider';
import { DataElement, DataElementAttribute } from '@axe/domain/data/data-element';
import {
  isTableCellField,
  tableCellLineage,
} from '@axe/features/data-element/game-data-element/game-data-element-utils';
import { TranslocoModule } from '@jsverse/transloco';

/**
 * The settings of one sheet row, or of a group or section shown as a table.
 *
 * A field's settings depend on its kind: choices, a formula, a unit, bounds, how a resource shows
 * and sounds, and the column it makes in a table. A table's settings are its row heading and how
 * judgement runs over it. Every change is written to the element at once.
 */
@Component({
  selector: 'game-data-element-field-options',
  templateUrl: './game-data-element-field-options.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslocoModule],
  host: { class: 'contents' },
})
export class GameDataElementFieldOptionsComponent {
  private readonly objectChange = inject(ObjectChangeService);
  private readonly t = inject(TRANSLATE_FN);

  readonly element = input.required<DataElement>();
  /** Whether these are the settings of a field, or of a group or section shown as a table. */
  readonly kind = input<'field' | 'container'>('field');

  readonly soundSetOptions = RESOURCE_SOUND_SET_OPTIONS;

  /** The kind of field the element is. */
  fieldType(): string {
    const element = this.element();
    this.objectChange.versionOf(element.identifier)();
    return element.fieldType;
  }

  /** Whether the field is a cell of a table, which gives it a column heading and a gap setting. */
  isTableCellField(): boolean {
    const element = this.element();
    for (const node of tableCellLineage(element)) this.objectChange.versionOf(node.identifier)();
    return isTableCellField(element);
  }

  /** The choices a select field offers, as written. Setting blank text removes them. */
  get choicesText(): string {
    return this.attrText(DataElementAttribute.CHOICES);
  }
  set choicesText(value: string) {
    this.setFieldAttribute(DataElementAttribute.CHOICES, value);
  }

  /** The formula a calculated field works its result out from. */
  get formulaText(): string {
    return this.attrText(DataElementAttribute.FORMULA);
  }
  set formulaText(value: string) {
    this.setFieldAttribute(DataElementAttribute.FORMULA, value);
  }

  /** The unit shown after a number or resource field's value. Setting blank text removes it. */
  get unitText(): string {
    return this.attrText(DataElementAttribute.UNIT);
  }
  set unitText(value: string) {
    this.setFieldAttribute(DataElementAttribute.UNIT, value);
  }

  /** The lowest value a number field takes; empty for no limit. */
  get minText(): string {
    return this.attrText(DataElementAttribute.MIN);
  }
  set minText(value: string | number | null | undefined) {
    this.setFieldAttribute(DataElementAttribute.MIN, value);
  }

  /** The highest value a number field takes; empty for no limit. */
  get maxText(): string {
    return this.attrText(DataElementAttribute.MAX);
  }
  set maxText(value: string | number | null | undefined) {
    this.setFieldAttribute(DataElementAttribute.MAX, value);
  }

  /**
   * A resource's minimum before its correction is added, reading the plain minimum where no base is
   * set. Setting blank text removes it.
   */
  get minBaseText(): string {
    return this.attrText(DataElementAttribute.MIN_BASE, DataElementAttribute.MIN);
  }
  set minBaseText(value: string | number | null | undefined) {
    this.setFieldAttribute(DataElementAttribute.MIN_BASE, value);
  }

  /** The amount added to a resource's minimum base; empty for none. */
  get minCorrectionText(): string {
    return this.attrText(DataElementAttribute.MIN_CORRECTION);
  }
  set minCorrectionText(value: string | number | null | undefined) {
    this.setFieldAttribute(DataElementAttribute.MIN_CORRECTION, value);
  }

  /**
   * A resource's maximum before its correction is added, reading the plain maximum where no base is
   * set. Setting it also moves the resource's maximum to the new effective one.
   */
  get maxBaseText(): string {
    return this.attrText(DataElementAttribute.MAX_BASE, DataElementAttribute.MAX);
  }
  set maxBaseText(value: string | number | null | undefined) {
    this.setFieldAttribute(DataElementAttribute.MAX_BASE, value);
    this.syncMaxToEffective();
  }

  /**
   * The amount added to a resource's maximum base. Setting it also moves the resource's maximum to
   * the new effective one.
   */
  get maxCorrectionText(): string {
    return this.attrText(DataElementAttribute.MAX_CORRECTION);
  }
  set maxCorrectionText(value: string | number | null | undefined) {
    this.setFieldAttribute(DataElementAttribute.MAX_CORRECTION, value);
    this.syncMaxToEffective();
  }

  /** The label a check field in a table carries beside its box. Setting blank text removes it. */
  get tableCellText(): string {
    return this.attrText(DataElementAttribute.CELL_TEXT);
  }
  set tableCellText(value: string) {
    this.setFieldAttribute(DataElementAttribute.CELL_TEXT, value);
  }

  /** The heading of the column this field makes in a table. Setting blank text removes it. */
  get columnLabelText(): string {
    return this.attrText(DataElementAttribute.COLUMN_LABEL);
  }
  set columnLabelText(value: string) {
    this.setFieldAttribute(DataElementAttribute.COLUMN_LABEL, value);
  }

  /**
   * The heading that gathers this field's column together with its neighbours above a table's
   * column headings.
   */
  get columnGroupText(): string {
    return this.attrText(DataElementAttribute.COLUMN_GROUP);
  }
  set columnGroupText(value: string) {
    this.setFieldAttribute(DataElementAttribute.COLUMN_GROUP, value);
  }

  /**
   * Whether this table field is a gap cell, which makes its column a gap between skill columns in
   * judgement. Turning it on gives the field a default column heading where it has none.
   */
  get isGapCell(): boolean {
    return this.attrText(DataElementAttribute.CELL_KIND) === 'gap';
  }
  set isGapCell(value: boolean) {
    const element = this.element();
    if (value) {
      element.setAttribute(DataElementAttribute.CELL_KIND, 'gap');
      if (!element.getAttribute(DataElementAttribute.COLUMN_LABEL).trim()) {
        element.setAttribute(DataElementAttribute.COLUMN_LABEL, this.t('feature.dataElement.defaults.gapCellLabel'));
      }
    } else {
      element.removeAttribute(DataElementAttribute.CELL_KIND);
    }
    this.objectChange.notifyChanged(element.identifier);
  }

  /** Whether the element is a numeric resource, the only kind with a bar, a slider or change feedback. */
  canShowPieceGauge(): boolean {
    return this.element().isNumberResource;
  }

  /** Whether the resource is shown as a bar on the piece on the table. */
  isPieceGauge(): boolean {
    return this.hasFlag(DataElementAttribute.PIECE_GAUGE);
  }

  /** Shows the resource as a bar on the piece, or takes the bar away. */
  togglePieceGauge(): void {
    if (this.canShowPieceGauge()) this.toggleFlag(DataElementAttribute.PIECE_GAUGE);
  }

  /** Whether the resource grows worse as it rises, so the bar on the piece reads the other way round. */
  isGaugeInverted(): boolean {
    return this.hasFlag(DataElementAttribute.GAUGE_INVERTED);
  }

  /** Turns reading the resource as one that grows worse as it rises on or off. */
  toggleGaugeInverted(): void {
    if (this.canShowPieceGauge()) this.toggleFlag(DataElementAttribute.GAUGE_INVERTED);
  }

  /** Whether the resource is moved with a slider as well as typed. */
  hasResourceSlider(): boolean {
    const element = this.element();
    this.objectChange.versionOf(element.identifier)();
    return showsResourceSlider(element);
  }

  /** Moves the resource with a slider as well, or stops. */
  toggleResourceSlider(): void {
    if (this.canShowPieceGauge()) this.toggleFlag(DataElementAttribute.RESOURCE_SLIDER);
  }

  /** Whether the element can play an effect or a sound when it changes, which only a resource can. */
  canShowChangeFeedback(): boolean {
    return this.element().isNumberResource;
  }

  /** Whether a change to the resource plays an effect on the piece. */
  playsEffectOnChange(): boolean {
    const element = this.element();
    this.objectChange.versionOf(element.identifier)();
    return playsEffectOnChange(element);
  }

  /** Whether a change to the resource plays a sound. */
  playsSoundOnChange(): boolean {
    const element = this.element();
    this.objectChange.versionOf(element.identifier)();
    return playsSoundOnChange(element);
  }

  /** Turns the effect played when the resource changes on or off. Does nothing for anything else. */
  toggleChangeEffect(): void {
    if (!this.canShowChangeFeedback()) return;
    const element = this.element();
    element.setAttribute(DataElementAttribute.CHANGE_EFFECT, this.playsEffectOnChange() ? 'false' : 'true');
    this.objectChange.notifyChanged(element.identifier);
  }

  /** Turns the sound played when the resource changes on or off. Does nothing for anything else. */
  toggleChangeSound(): void {
    if (!this.canShowChangeFeedback()) return;
    const element = this.element();
    element.setAttribute(DataElementAttribute.CHANGE_SOUND, this.playsSoundOnChange() ? 'false' : 'true');
    this.objectChange.notifyChanged(element.identifier);
  }

  /** Which set of sounds a change to the resource plays. */
  soundSetOnChange(): ResourceSoundSet {
    const element = this.element();
    this.objectChange.versionOf(element.identifier)();
    return soundSetOnChange(element);
  }

  /**
   * Chooses the set of sounds a change to the resource plays, anything but `mech` being taken as
   * `flesh`. Does nothing for anything but a resource.
   */
  setSoundSetOnChange(value: string): void {
    if (!this.canShowChangeFeedback()) return;
    const element = this.element();
    element.setAttribute(DataElementAttribute.CHANGE_SOUND_SET, value === 'mech' ? 'mech' : 'flesh');
    this.objectChange.notifyChanged(element.identifier);
  }

  /** Whether an image field's picture is shown at full size in the popup. */
  isImagePopupOriginal(): boolean {
    return this.hasFlag(DataElementAttribute.IMAGE_POPUP_ORIGINAL);
  }

  /** Turns showing an image field's picture at full size in the popup on or off. */
  toggleImagePopupOriginal(event?: Event): void {
    event?.stopPropagation();
    this.toggleFlag(DataElementAttribute.IMAGE_POPUP_ORIGINAL);
  }

  /** The heading over the column of row names while the group or section is shown as a table. */
  get rowHeaderLabelText(): string {
    return this.attrText(DataElementAttribute.ROW_HEADER_LABEL);
  }
  set rowHeaderLabelText(value: string) {
    this.setFieldAttribute(DataElementAttribute.ROW_HEADER_LABEL, value);
  }

  /** Whether the table offers judgement. */
  isJudgeModeEnabled(): boolean {
    return this.hasFlag(DataElementAttribute.JUDGE_MODE);
  }

  /** Turns judgement on or off for the table. */
  toggleJudgeModeEnabled(): void {
    this.toggleFlag(DataElementAttribute.JUDGE_MODE);
  }

  /** How much distance each ticked gap column adds in judgement; empty counts as 1. */
  get gapDistanceText(): string {
    return this.attrText(DataElementAttribute.GAP_DISTANCE);
  }
  set gapDistanceText(value: string) {
    this.setFieldAttribute(DataElementAttribute.GAP_DISTANCE, value);
  }

  /** The target a judgement roll starts from before the distance is added; empty counts as 5. */
  get baseDifficultyText(): string {
    return this.attrText(DataElementAttribute.BASE_DIFFICULTY);
  }
  set baseDifficultyText(value: string) {
    this.setFieldAttribute(DataElementAttribute.BASE_DIFFICULTY, value);
  }

  /** Whether distance in judgement runs on from the table's last column round to its first. */
  get loopHorizontal(): boolean {
    return this.attrText(DataElementAttribute.LOOP_HORIZONTAL) === 'true';
  }
  /** Turns judgement distance running round from the last column to the first on or off. */
  toggleLoopHorizontal(): void {
    this.toggleFlag(DataElementAttribute.LOOP_HORIZONTAL);
  }

  /** Whether distance in judgement runs on from the table's last row round to its first. */
  get loopVertical(): boolean {
    return this.attrText(DataElementAttribute.LOOP_VERTICAL) === 'true';
  }
  /** Turns judgement distance running round from the last row to the first on or off. */
  toggleLoopVertical(): void {
    this.toggleFlag(DataElementAttribute.LOOP_VERTICAL);
  }

  /**
   * Moves a resource's maximum to the effective one after its base or correction changes, so the
   * shown "/X" follows the settings.
   */
  private syncMaxToEffective(): void {
    const element = this.element();
    const effectiveMax = element.effectiveMax;
    if (effectiveMax == null || element.value === effectiveMax) return;
    element.value = effectiveMax;
  }

  private hasFlag(attribute: string): boolean {
    const element = this.element();
    this.objectChange.versionOf(element.identifier)();
    return element.getAttribute(attribute) === 'true';
  }

  private toggleFlag(attribute: string): void {
    const element = this.element();
    if (this.hasFlag(attribute)) element.removeAttribute(attribute);
    else element.setAttribute(attribute, 'true');
    this.objectChange.notifyChanged(element.identifier);
  }

  private attrText(attribute: string, fallback?: string): string {
    const element = this.element();
    this.objectChange.versionOf(element.identifier)();
    // An attribute may hold a number, and testing it for truth would count a zero as empty.
    const value = String(element.getAttribute(attribute) ?? '');
    if (value.length > 0 || fallback === undefined) return value;
    return String(element.getAttribute(fallback) ?? '');
  }

  private setFieldAttribute(attribute: string, value: string | number | null | undefined): void {
    const element = this.element();
    const normalizedValue = value == null ? '' : String(value).trim();
    if (normalizedValue.length > 0) element.setAttribute(attribute, normalizedValue);
    else element.removeAttribute(attribute);
    this.objectChange.notifyChanged(element.identifier);
  }
}
