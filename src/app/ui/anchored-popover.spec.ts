import { fitPopover } from '@axe/ui/anchored-popover';

describe('placing a popover against what it hangs off', () => {
  const view = { width: 1000, height: 800 };
  const fit = { width: 300, minHeight: 176 };

  function anchor(top: number, height = 20, left = 400, width = 40): DOMRect {
    return { top, bottom: top + height, left, right: left + width, width, height } as DOMRect;
  }

  it('opens downward where the room below is the greater', () => {
    const placed = fitPopover(anchor(100), fit, view, 200);

    expect(placed.opensUpward).toBe(false);
    expect(placed.top).toBe(126);
  });

  it('opens upward where the room above is the greater', () => {
    const placed = fitPopover(anchor(700), fit, view, 200);

    expect(placed.opensUpward).toBe(true);
    expect(placed.top).toBe(700 - 6 - 200);
  });

  it('sits centred on what it hangs off', () => {
    expect(fitPopover(anchor(100), fit, view, 200).left).toBe(400 + 20 - 150);
  });

  it('lines up with the left edge where it is asked to', () => {
    expect(fitPopover(anchor(100), { ...fit, align: 'start' }, view, 200).left).toBe(400);
  });

  it('keeps a margin from the edges of the window', () => {
    expect(fitPopover(anchor(100, 20, 0, 10), fit, view, 200).left).toBe(8);
    expect(fitPopover(anchor(100, 20, 995, 5), fit, view, 200).left).toBe(1000 - 300 - 8);
  });

  it('narrows to the window rather than hanging off it', () => {
    expect(fitPopover(anchor(100), fit, { width: 240, height: 800 }, 200).width).toBe(224);
  });

  it('is never given less height than it says it needs', () => {
    expect(fitPopover(anchor(380, 20), fit, { width: 1000, height: 420 }, 200).maxHeight).toBe(366);
    expect(fitPopover(anchor(200, 20), fit, { width: 1000, height: 240 }, 200).maxHeight).toBe(186);
  });
});
