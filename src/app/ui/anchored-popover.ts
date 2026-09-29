/** How far a popover keeps from the edge of the window. */
const VIEWPORT_MARGIN = 8;

/** How far a popover sits from what it hangs off. */
const ANCHOR_GAP = 6;

/** Where a popover would like to sit against the thing it hangs off. */
export interface PopoverFit {
  /** The width it would like, narrowed where the window is narrower. */
  width: number;
  /** The least height worth opening at, so that a short window still shows something. */
  minHeight: number;
  /** Whether it lines up with the left edge of the anchor or sits centred on it. */
  align?: 'start' | 'center';
}

/** The window a popover has to fit inside, which the tests hand over rather than read. */
export interface PopoverViewport {
  width: number;
  height: number;
}

/** Where a popover ends up: its size, and its corner in the window. */
export interface PopoverPlacement {
  width: number;
  maxHeight: number;
  left: number;
  top: number;
  /** Whether it opens upward, which happens when there is more room above than below. */
  opensUpward: boolean;
}

/**
 * Works out where a popover goes for the room the window has.
 *
 * It opens downward where there is room and upward where there is more room above, keeps a margin
 * from every edge, and is never given less than the height it says it needs, so a popover in a
 * short window overflows rather than collapsing to nothing.
 */
export function fitPopover(anchor: DOMRect, fit: PopoverFit, view: PopoverViewport, height: number): PopoverPlacement {
  const width = Math.min(fit.width, view.width - VIEWPORT_MARGIN * 2);
  const roomAbove = anchor.top - VIEWPORT_MARGIN - ANCHOR_GAP;
  const roomBelow = view.height - anchor.bottom - VIEWPORT_MARGIN - ANCHOR_GAP;
  const opensUpward = roomBelow < roomAbove;
  const left = fit.align === 'start' ? anchor.left : anchor.left + anchor.width / 2 - width / 2;
  const top = opensUpward ? anchor.top - ANCHOR_GAP - height : anchor.bottom + ANCHOR_GAP;
  return {
    width,
    maxHeight: Math.max(fit.minHeight, opensUpward ? roomAbove : roomBelow),
    left: clamp(left, VIEWPORT_MARGIN, view.width - width - VIEWPORT_MARGIN),
    top: clamp(top, VIEWPORT_MARGIN, view.height - height - VIEWPORT_MARGIN),
    opensUpward,
  };
}

/**
 * Puts a popover where it fits, against the thing it hangs off.
 *
 * The popover is measured where it stands before it is moved, since how tall it grows depends on
 * the width it is given.
 */
export function placePopover(popover: HTMLElement, anchor: DOMRect, fit: PopoverFit): void {
  const view = { width: window.innerWidth, height: window.innerHeight };
  popover.style.width = `${Math.min(fit.width, view.width - VIEWPORT_MARGIN * 2)}px`;
  popover.style.left = '0px';
  popover.style.top = '0px';

  const origin = popover.getBoundingClientRect();
  const placed = fitPopover(anchor, fit, view, origin.height);
  popover.style.width = `${placed.width}px`;
  popover.style.maxHeight = `${placed.maxHeight}px`;
  popover.style.left = `${placed.left - origin.left}px`;
  popover.style.top = `${placed.top - origin.top}px`;
}

function clamp(value: number, lowest: number, highest: number): number {
  return Math.max(lowest, Math.min(value, highest));
}
