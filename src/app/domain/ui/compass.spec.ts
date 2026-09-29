import { COMPASS_POINTS, compassPointOf, northNeedleAngle, screenBearingOf } from '@axe/domain/ui/compass';

describe('reading the table as a compass', () => {
  describe('which way the screen looks', () => {
    it('looks north up a table that has not been turned', () => {
      expect(screenBearingOf(0)).toBe(0);
    });

    it('reads the turn backwards, the table having carried its north round', () => {
      expect(screenBearingOf(90)).toBe(270);
      expect(screenBearingOf(-90)).toBe(90);
    });

    it('answers within one turn however many times the table has been round', () => {
      expect(screenBearingOf(730)).toBe(350);
      expect(screenBearingOf(-730)).toBe(10);
    });
  });

  describe('where the rose is drawn', () => {
    it('sits where the table put it', () => {
      expect(northNeedleAngle(0)).toBe(0);
      expect(northNeedleAngle(90)).toBe(90);
    });

    it('comes back round rather than counting on past a turn', () => {
      expect(northNeedleAngle(-90)).toBe(270);
      expect(northNeedleAngle(450)).toBe(90);
    });

    it('stands opposite the way the screen looks, bar the one they share', () => {
      for (const turn of [0, 10, 45, 123, 270, -37]) {
        expect((northNeedleAngle(turn) + screenBearingOf(turn)) % 360).toBe(0);
      }
    });
  });

  describe('naming a bearing', () => {
    it('names each of the eight points at its own bearing', () => {
      expect(COMPASS_POINTS.map((_, at) => compassPointOf(at * 45))).toEqual([...COMPASS_POINTS]);
    });

    it('gives each point the forty-five degrees around it', () => {
      expect(compassPointOf(22)).toBe('n');
      expect(compassPointOf(23)).toBe('ne');
      expect(compassPointOf(337)).toBe('nw');
      expect(compassPointOf(338)).toBe('n');
    });

    it('reads north again rather than a ninth point at the far end', () => {
      expect(compassPointOf(359)).toBe('n');
      expect(compassPointOf(360)).toBe('n');
      expect(compassPointOf(-1)).toBe('n');
    });
  });
});
