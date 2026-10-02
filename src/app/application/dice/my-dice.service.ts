import { Injectable, signal } from '@angular/core';
import {
  asDiceLook,
  decodeDiceLook,
  DiceLook,
  encodeDiceLook,
  PLAIN_DICE_LOOK,
} from '@axe/domain/dice/dice-3d/dice-look';

const STORAGE_KEY = 'my-dice';

/**
 * How this seat's dice look. Every line the seat says carries it, so everyone sees its rolls thrown
 * in it, and the dice bot's answer to a roll carries it on.
 *
 * It is the person's, not the room's or a character's: kept in this browser, and the same whoever
 * the seat speaks as.
 */
@Injectable({ providedIn: 'root' })
export class MyDiceService {
  private readonly current = signal<DiceLook>(storedLook());

  readonly look = this.current.asReadonly();

  /** Chooses a look, kept for the next visit where the browser allows. */
  set(look: DiceLook): void {
    const tidy = asDiceLook(look);
    this.current.set(tidy);
    try {
      localStorage.setItem(STORAGE_KEY, encodeDiceLook(tidy));
    } catch {
      // Private browsing refuses the write; the look still holds for this session.
    }
  }
}

function storedLook(): DiceLook {
  try {
    return decodeDiceLook(localStorage.getItem(STORAGE_KEY));
  } catch {
    return PLAIN_DICE_LOOK;
  }
}
