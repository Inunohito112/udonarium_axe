import { GameCharacter } from '@axe/domain/character/game-character';
import { CellBits } from '@axe/domain/tabletop/fog/cell-bits';
import { CellGrid, cellIndexAt, forEachCellInBox } from '@axe/domain/tabletop/fog/cell-grid';
import { pieceCornerOn } from '@axe/domain/tabletop/move/piece-on-grid';

/**
 * Whether a piece standing on a cell would fit there, with every cell it covers clear.
 *
 * A reach is worked out one cell at a time, and that cell is where a piece's middle would be.
 * A piece one cell across is that cell and nothing else, but a golem three across covers nine:
 * a reach that asked only about the middle one would offer it a doorway it cannot enter and a
 * ledge two thirds of it would hang off.
 *
 * Nothing comes back for a piece that covers a single cell, since there is nothing to ask of it,
 * and the reach is then left exactly as fast as it was.
 */
export function pieceFitsOn(
  grid: CellGrid,
  piece: GameCharacter,
  gridSize: number,
  blocked: CellBits
): ((cell: number) => boolean) | null {
  const span = Math.max(1, Math.round(piece.size));
  if (span < 2 || gridSize <= 0) return null;

  return (cell: number): boolean => {
    const { x, y } = pieceCornerOn(grid, piece, gridSize, cell);
    const far = { x: x + span * gridSize - 1, y: y + span * gridSize - 1 };
    // Ground that runs off the edge is ground a piece cannot stand on either, and the cells
    // beyond the border are not blocked so much as absent. The corners of the footprint are
    // asked for directly, since a box that hangs over the edge simply yields fewer cells.
    if (cellIndexAt(grid, x, y) < 0 || cellIndexAt(grid, far.x, far.y) < 0) return false;
    if (cellIndexAt(grid, far.x, y) < 0 || cellIndexAt(grid, x, far.y) < 0) return false;

    let fits = true;
    forEachCellInBox(grid, x, y, far.x, far.y, (held) => {
      if (blocked.get(held)) fits = false;
    });
    return fits;
  };
}
