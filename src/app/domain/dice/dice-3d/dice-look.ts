/** What a die is made of, which sets how it takes the light. */
export const DICE_MATERIALS = ['resin', 'marble', 'metal', 'glass'] as const;
export type DiceMaterial = (typeof DICE_MATERIALS)[number];

/**
 * How the one who rolls wants their dice to look, which everyone sees them in.
 *
 * An empty body is the colour the roll was said in, and an empty ink is worked out to stand out
 * from the body, so a look that sets neither changes nothing but the material.
 */
export interface DiceLook {
  readonly material: DiceMaterial;
  /** The colour of the dice, as `#rrggbb`, or empty for the colour of the roll. */
  readonly body: string;
  /** The colour of their numbers, as `#rrggbb`, or empty for one that stands out from the body. */
  readonly ink: string;
}

/** The dice as they were before anyone chose otherwise: resin, in the colour of the roll. */
export const PLAIN_DICE_LOOK: DiceLook = { material: 'resin', body: '', ink: '' };

const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** Whether a look is the plain one, which a line has no need to carry. */
export function isPlainDiceLook(look: DiceLook): boolean {
  return look.material === 'resin' && look.body === '' && look.ink === '';
}

/** A look as a line carries it: nothing for the plain one, and only what differs from it otherwise. */
export function encodeDiceLook(look: DiceLook): string {
  const tidy = asDiceLook(look);
  if (isPlainDiceLook(tidy)) return '';
  const written: Record<string, string> = { material: tidy.material };
  if (tidy.body) written['body'] = tidy.body;
  if (tidy.ink) written['ink'] = tidy.ink;
  return JSON.stringify(written);
}

/**
 * Reads the look a line carries. Nothing, as on a line said before looks were offered, is the plain
 * look; so is anything that cannot be read. A material this version does not know, from a later
 * one, is read as resin, and a colour that is not one is left to the default.
 */
export function decodeDiceLook(raw: unknown): DiceLook {
  if (typeof raw !== 'string' || raw.length < 1) return PLAIN_DICE_LOOK;
  try {
    return asDiceLook(JSON.parse(raw));
  } catch {
    return PLAIN_DICE_LOOK;
  }
}

/** Anything at all read as a look, keeping what makes sense of it and the default for the rest. */
export function asDiceLook(raw: unknown): DiceLook {
  if (!raw || typeof raw !== 'object') return PLAIN_DICE_LOOK;
  const fields = raw as Record<string, unknown>;
  const material = DICE_MATERIALS.find((known) => known === fields['material']) ?? 'resin';
  return { material, body: colorOf(fields['body']), ink: colorOf(fields['ink']) };
}

function colorOf(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const color = raw.trim().toLowerCase();
  return HEX_COLOR.test(color) ? color : '';
}
