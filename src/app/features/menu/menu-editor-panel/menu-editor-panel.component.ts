import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TRANSLATE_FN } from '@axe/application/i18n/translate.token';
import { ConfirmService } from '@axe/application/ui/confirm.service';
import { MenuLayoutService } from '@axe/application/ui/menu-layout.service';
import { downloadBlob } from '@axe/core/util/download-blob';
import { PeerRole } from '@axe/domain/peer/peer-role';
import { MENU_SURFACES, MenuCommand, menuCommandOf, menuCommandsFor, MenuSurface } from '@axe/domain/ui/menu-command';
import { isMenuGroup, MenuGroup, MenuLayout, MenuNode } from '@axe/domain/ui/menu-layout';
import {
  addMenuGroup,
  addMenuItem,
  MenuParent,
  moveMenuNode,
  moveMenuNodeInto,
  parentOfMenuNode,
  removeMenuNode,
  renameMenuNode,
  setMenuNodeIcon,
} from '@axe/domain/ui/menu-layout-edit';
import { encodeMenuLayoutFile, MENU_LAYOUT_FILE_NAME, parseMenuLayoutFile } from '@axe/domain/ui/menu-layout-file';
import { MenuCommandService } from '@axe/features/menu/menu-command.service';
import { TranslocoModule } from '@jsverse/transloco';

/** One row of the arrangement being edited, at whichever level it sits. */
interface EditorRow {
  node: MenuNode;
  /** Which small menu it sits in, for the picker that moves it elsewhere. */
  parent: MenuParent;
  /** Drawn a step in where it sits inside a small menu. */
  nested: boolean;
  /** The command it stands for, or null for a small menu and for a command this version lost. */
  command: MenuCommand | null;
  /** What it is called now, ready to show. */
  name: string;
  /** The mark it wears now. */
  icon: string;
  /** Whether the command it names is one this version no longer has. */
  lost: boolean;
}

/** Somewhere an entry can be carried to. */
interface MoveTarget {
  value: string;
  name: string;
}

/**
 * Arranging the drawer and the two toolbars.
 *
 * What is arranged here belongs to this browser: the room never sees it, and neither does anybody
 * else at the table. Every menu can be emptied outright and put back the way it came, so there is
 * nothing here somebody can break and not undo.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-menu-editor-panel',
  templateUrl: './menu-editor-panel.component.html',
  imports: [FormsModule, TranslocoModule],
})
export class MenuEditorPanelComponent {
  private readonly layouts = inject(MenuLayoutService);
  private readonly commands = inject(MenuCommandService);
  private readonly confirm = inject(ConfirmService);
  private readonly t = inject(TRANSLATE_FN);

  /** Which menu is being arranged. */
  readonly surface = signal<MenuSurface>('fab');

  /** The menus this seat may arrange; a player has no master's bar to arrange and the other way about. */
  protected readonly surfaces = computed<MenuSurface[]>(() => {
    const role = this.commands.role();
    return MENU_SURFACES.filter((held) => {
      if (held === 'gmToolbar') return role === PeerRole.GameMaster;
      if (held === 'plToolbar') return role === PeerRole.Player;
      return true;
    });
  });

  private readonly layout = computed<MenuLayout>(() => this.layouts.layoutOf(this.surface())());

  /** Whether this screen has arranged this menu itself, which is what there is to put back. */
  protected readonly arranged = computed(() => {
    this.layout();
    return this.layouts.isArranged(this.surface());
  });

  /** The arrangement as rows, the small menus with what is in them beneath. */
  protected readonly rows = computed<EditorRow[]>(() => {
    const rows: EditorRow[] = [];
    for (const node of this.layout().nodes) {
      rows.push(this.rowOf(node, null));
      if (isMenuGroup(node)) for (const item of node.items) rows.push(this.rowOf(item, node.id));
    }
    return rows;
  });

  /** The commands this seat may still put on this menu, those already on it left out. */
  protected readonly offered = computed<MenuCommand[]>(() => {
    const used = new Set(
      this.rows()
        .map((row) => row.command?.key)
        .filter((key): key is string => key !== undefined)
    );
    return menuCommandsFor(this.surface(), this.commands.role()).filter((command) => !used.has(command.key));
  });

  /** Where an entry may be carried: onto the menu itself, or into one of its small menus. */
  protected readonly targets = computed<MoveTarget[]>(() => [
    { value: '', name: this.t('feature.menuEditor.topLevel') },
    ...this.layout()
      .nodes.filter(isMenuGroup)
      .map((group) => ({ value: group.id, name: this.nameOfGroup(group) })),
  ]);

  protected readonly chosenCommand = signal('');
  protected readonly newGroupName = signal('');

  protected choose(surface: MenuSurface): void {
    this.surface.set(surface);
  }

  protected surfaceLabelKey(surface: MenuSurface): string {
    return `feature.menuEditor.surface.${surface}`;
  }

  protected isGroupRow(row: EditorRow): boolean {
    return isMenuGroup(row.node);
  }

  protected add(): void {
    const key = this.chosenCommand();
    if (!key) return;
    this.write(addMenuItem(this.layout(), key, null));
    this.chosenCommand.set('');
  }

  protected addGroup(): void {
    const name = this.newGroupName().trim();
    if (name.length < 1) return;
    this.write(addMenuGroup(this.layout(), name));
    this.newGroupName.set('');
  }

  protected remove(row: EditorRow): void {
    this.write(removeMenuNode(this.layout(), row.node.id));
  }

  protected rename(row: EditorRow, label: string): void {
    this.write(renameMenuNode(this.layout(), row.node.id, label));
  }

  protected setIcon(row: EditorRow, icon: string): void {
    this.write(setMenuNodeIcon(this.layout(), row.node.id, icon));
  }

  protected move(row: EditorRow, delta: number): void {
    this.write(moveMenuNode(this.layout(), row.node.id, delta));
  }

  protected moveInto(row: EditorRow, target: string): void {
    this.write(moveMenuNodeInto(this.layout(), row.node.id, target.length > 0 ? target : null));
  }

  /** Puts this menu back the way it came, once whoever asked has said they mean it. */
  protected async reset(): Promise<void> {
    if (!(await this.confirm.ask(this.t('feature.menuEditor.resetConfirm')))) return;
    this.layouts.reset(this.surface());
  }

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  /** Whether there is anything to write out: a screen that has arranged nothing has nothing to carry. */
  protected readonly hasArrangements = computed(() => {
    this.layout();
    return Object.keys(this.layouts.arrangements()).length > 0;
  });

  /** Writes out every menu this screen has arranged, for carrying to another screen. */
  protected writeOut(): void {
    const written = encodeMenuLayoutFile(this.layouts.arrangements());
    downloadBlob(new Blob([written], { type: 'application/json' }), MENU_LAYOUT_FILE_NAME);
  }

  protected chooseFile(): void {
    this.fileInput()?.nativeElement.click();
  }

  /** Takes the arrangements out of a file, leaving the menus it says nothing about alone. */
  protected async readIn(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const layouts = parseMenuLayoutFile(await file.text());
    if (!layouts) {
      this.failed.set(true);
      return;
    }
    this.failed.set(false);
    this.layouts.adopt(layouts);
  }

  /** Whether the last file offered could not be read as an arrangement. */
  protected readonly failed = signal(false);

  private write(layout: MenuLayout): void {
    this.layouts.save(this.surface(), layout);
  }

  private rowOf(node: MenuNode, parent: MenuParent): EditorRow {
    const group = isMenuGroup(node);
    const command = group ? null : menuCommandOf(node.command);
    return {
      node,
      parent: group ? null : parent,
      nested: parent !== null,
      command,
      name: group ? this.nameOfGroup(node) : this.nameOfItem(node.label, command),
      icon: group ? node.icon : (node.icon ?? command?.icon ?? 'help_outline'),
      lost: !group && command === null,
    };
  }

  private nameOfGroup(group: MenuGroup): string {
    return group.label ?? (group.labelKey ? this.t(group.labelKey) : this.t('feature.menuEditor.unnamedGroup'));
  }

  private nameOfItem(label: string | undefined, command: MenuCommand | null): string {
    if (label) return label;
    if (!command) return this.t('feature.menuEditor.lost');
    return this.t(command.labelKey);
  }

  /** Where the row sits among the ones it sits with, so the ends know not to offer a move. */
  protected placeOf(row: EditorRow): { index: number; count: number } {
    const siblings = this.rows().filter((held) => held.parent === row.parent && held.nested === row.nested);
    return { index: siblings.indexOf(row), count: siblings.length };
  }

  protected parentValue(row: EditorRow): string {
    return parentOfMenuNode(this.layout(), row.node.id) ?? '';
  }
}
