import { DEFAULT_AMBIENCE_DENSITY } from '@axe/domain/effect/ambience/ambience-kind';
import { parseCellKey } from '@axe/domain/tabletop/cell-key';
import { CellRect, largestRectangles } from '@axe/domain/tabletop/cell-rectangles';
import {
  AmbienceBlock,
  BlockChange,
  blockChange,
  DEFAULT_FUNCTION_SPEC,
  FunctionPaintPlan,
  MapFunctionRole,
  MaskBlock,
  MoveCostBlock,
  TerrainBlock,
  TriggerBlock,
} from '@axe/domain/tabletop/function-paint';
import { hazardPresetOf } from '@axe/domain/tabletop/hazard-presets';
import { isHexGrid } from '@axe/domain/tabletop/hex-geometry';
import { TableSnapshot } from '@axe/domain/tabletop/table-snapshot';
import { FunctionLayer, MapScene } from '@axe/features/map-editor/model/scene';

export type { BlockChange, FunctionPaintPlan };

/**
 * The cells one role holds across the whole scene.
 *
 * A layer that has been hidden counts all the same. Hiding is a way of getting a look at
 * what is underneath, and a table losing its walls because somebody closed an eye on them
 * would be a poor trade for that.
 */
export function cellsForRole(scene: MapScene, role: MapFunctionRole): string[] {
  const held = new Set<string>();
  for (const layer of scene.layers) {
    if (layer.kind !== 'function') continue;
    if ((layer as FunctionLayer).role !== role) continue;
    for (const key of Object.keys((layer as FunctionLayer).cells)) held.add(key);
  }
  return [...held];
}

/**
 * The blocks a role's painting comes to, layer by layer.
 *
 * Each layer is cut on its own and keeps the look it carries, so two walls of different
 * stone stay two walls of different stone rather than collapsing into whichever came first.
 *
 * Layers are walked from the bottom up, and a cell already built on carries the next layer
 * that high: paint a wall over a wall and it becomes a second storey rather than the two
 * standing inside one another. Cells of a layer that start at different heights are cut
 * apart, since one block can only begin at one height.
 */
/**
 * The cells of a layer, gathered into as few blocks as will stand for them.
 *
 * On squares a run of cells is a rectangle and one block stands for a dozen. A terrain on a
 * hex board is drawn as a flower of `min(width, depth)` cells across, so a block standing for
 * a run of five would paint one and leave four bare: there, every cell is its own block.
 */
function blockRectsOf(cells: readonly string[], hex: boolean): CellRect[] {
  if (!hex) return largestRectangles(cells);
  const rects: CellRect[] = [];
  for (const key of cells) {
    const cell = parseCellKey(key);
    if (cell) rects.push({ col: cell.col, row: cell.row, width: 1, height: 1 });
  }
  return rects;
}

function terrainBlocksOf(scene: MapScene, cellPx: number, hex: boolean): TerrainBlock[] {
  const blocks: TerrainBlock[] = [];
  const standing = new Map<string, number>();
  for (const layer of functionLayersOf(scene, 'terrain')) {
    const spec = layer.spec.terrain;
    const cells = Object.keys(layer.cells);
    const byLevel = new Map<number, string[]>();
    for (const key of cells) {
      const level = standing.get(key) ?? 0;
      const group = byLevel.get(level);
      if (group) group.push(key);
      else byLevel.set(level, [key]);
    }
    for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
      const raised = level === 0 ? spec : { ...spec, altitude: spec.altitude + level * cellPx };
      for (const rect of blockRectsOf(byLevel.get(level) ?? [], hex)) {
        blocks.push({ ...rect, spec: raised });
      }
    }
    const tall = Math.max(0, Math.round(spec.height));
    for (const key of cells) standing.set(key, (standing.get(key) ?? 0) + tall);
  }
  return blocks;
}

function maskBlocksOf(scene: MapScene, hex: boolean): MaskBlock[] {
  const blocks: MaskBlock[] = [];
  for (const layer of functionLayersOf(scene, 'mask')) {
    for (const rect of blockRectsOf(Object.keys(layer.cells), hex)) {
      blocks.push({ ...rect, spec: layer.spec.mask });
    }
  }
  return blocks;
}

function triggerBlocksOf(scene: MapScene, hex: boolean): TriggerBlock[] {
  const blocks: TriggerBlock[] = [];
  for (const layer of functionLayersOf(scene, 'trigger')) {
    for (const rect of blockRectsOf(Object.keys(layer.cells), hex)) {
      blocks.push({ ...rect, spec: layer.spec.trigger });
    }
  }
  return blocks;
}

function moveCostBlocksOf(scene: MapScene, hex: boolean): MoveCostBlock[] {
  const blocks: MoveCostBlock[] = [];
  for (const layer of functionLayersOf(scene, 'moveCost')) {
    if (layer.spec.moveCost.blocks) continue;
    for (const rect of blockRectsOf(Object.keys(layer.cells), hex)) {
      blocks.push({ ...rect, spec: layer.spec.moveCost });
    }
  }
  return blocks;
}

/**
 * What the dangerous-ground brush comes to, sorted into the three things it lays.
 *
 * One stroke is a look, a going and a thing that happens, and the table carries the three
 * apart. The sorting is done here so that everything downstream sees the same three kinds of
 * block it always saw, whether a master laid them one at a time or all at once.
 */
function hazardBlocksOf(
  scene: MapScene,
  hex: boolean
): { ambience: AmbienceBlock[]; moveCost: MoveCostBlock[]; trigger: TriggerBlock[] } {
  const ambience: AmbienceBlock[] = [];
  const moveCost: MoveCostBlock[] = [];
  const trigger: TriggerBlock[] = [];
  for (const layer of functionLayersOf(scene, 'hazard')) {
    const spec = layer.spec.hazard;
    const preset = hazardPresetOf(spec.kind);
    const taken = spec.element.trim();
    for (const rect of blockRectsOf(Object.keys(layer.cells), hex)) {
      ambience.push({
        ...rect,
        spec: {
          kind: preset.ambience,
          color: '',
          density: DEFAULT_AMBIENCE_DENSITY,
          blocksSight: preset.blocksSight,
        },
      });
      if (preset.blocks || preset.extraCost > 0) {
        moveCost.push({
          ...rect,
          spec: { blocks: preset.blocks, extraCost: Math.max(1, preset.extraCost), color: preset.color },
        });
      }
      // Ground that takes nothing and leaves no mark needs nothing to happen on it: laying a
      // trap that does nothing would put an object on the table for every cell of a fog bank.
      if ((taken.length > 0 && preset.amount.length > 0) || preset.ailment.length > 0) {
        trigger.push({
          ...rect,
          spec: {
            ...DEFAULT_FUNCTION_SPEC.trigger,
            name: layer.name,
            moment: preset.moment,
            open: true,
            color: preset.color,
            element: preset.amount.length > 0 ? taken : '',
            amount: preset.amount.length > 0 ? preset.amount : '',
            ailment: preset.ailment,
          },
        });
      }
    }
  }
  return { ambience, moveCost, trigger };
}

/**
 * The cells the one brush shuts outright, as against the ones it merely puts a price on.
 *
 * The table carries the two differently — a map of shut cells, and a block apiece for the rest —
 * so what was painted with one brush is sorted back into two here and nowhere else.
 */
function blockedCellsOf(scene: MapScene): string[] {
  const held = new Set<string>();
  for (const layer of functionLayersOf(scene, 'moveCost')) {
    if (!layer.spec.moveCost.blocks) continue;
    for (const key of Object.keys(layer.cells)) held.add(key);
  }
  return [...held];
}

/**
 * Whether the scene says anything at all about what the table's cells do.
 *
 * A plan built from a scene holding none of these is a plan to take away everything the table
 * has, which is the right answer for somebody who deleted their layers and the wrong one for
 * somebody who only ever drew a floor.
 */
export function sceneCarriesFunctions(scene: MapScene, role?: MapFunctionRole): boolean {
  return scene.layers.some(
    (layer) => layer.kind === 'function' && (role === undefined || (layer as FunctionLayer).role === role)
  );
}

function functionLayersOf(scene: MapScene, role: MapFunctionRole): FunctionLayer[] {
  return scene.layers.filter(
    (layer): layer is FunctionLayer => layer.kind === 'function' && (layer as FunctionLayer).role === role
  );
}

/**
 * What laying the painted cells on the table would come to.
 *
 * Nothing is touched here: the answer is a list of what to add and what to take away, so
 * what the editor would do to a table can be read without a table to do it to.
 *
 * A scene on a different grid answers with nothing rather than guessing where its cells
 * would land. The cells were painted against one grid, and there is no honest way to hang
 * them on another.
 */
export function planFunctionPaint(scene: MapScene, table: TableSnapshot): FunctionPaintPlan | null {
  if (scene.cols !== table.cols || scene.rows !== table.rows || scene.gridType !== table.gridType) return null;
  const hex = isHexGrid(table.gridType);
  // Dangerous ground is laid as three ordinary things, so it is taken apart before anything
  // downstream is asked to work out what changed.
  const hazard = hazardBlocksOf(scene, hex);
  const laysHazards = sceneCarriesFunctions(scene, 'hazard');

  // A role the scene has no layer for is a role it has said nothing about, and saying nothing
  // is not the same as saying none. Emptying a layer still speaks — the layer is there — but a
  // scene that only ever had walls painted on it must not take the table's masks away with them.
  return {
    blocked: sceneCarriesFunctions(scene, 'moveCost') ? blockedCellsOf(scene) : [...table.blockedCells],
    moveCost:
      sceneCarriesFunctions(scene, 'moveCost') || laysHazards
        ? blockChange([...moveCostBlocksOf(scene, hex), ...hazard.moveCost], table.moveCostBlocks)
        : { add: [], remove: [] },
    ambience: laysHazards ? blockChange(hazard.ambience, table.ambienceBlocks) : { add: [], remove: [] },
    terrain: sceneCarriesFunctions(scene, 'terrain')
      ? blockChange(terrainBlocksOf(scene, table.cellPx, hex), table.terrainBlocks)
      : { add: [], remove: [] },
    mask: sceneCarriesFunctions(scene, 'mask')
      ? blockChange(maskBlocksOf(scene, hex), table.maskBlocks)
      : { add: [], remove: [] },
    trigger:
      sceneCarriesFunctions(scene, 'trigger') || laysHazards
        ? blockChange([...triggerBlocksOf(scene, hex), ...hazard.trigger], table.triggerBlocks)
        : { add: [], remove: [] },
  };
}
