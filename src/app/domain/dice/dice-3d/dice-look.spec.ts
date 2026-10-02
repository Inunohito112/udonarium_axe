import {
  asDiceLook,
  decodeDiceLook,
  DiceLook,
  encodeDiceLook,
  isPlainDiceLook,
  PLAIN_DICE_LOOK,
} from '@axe/domain/dice/dice-3d/dice-look';

describe('dice look', () => {
  it('writes nothing for the plain look, which a line has no need to carry', () => {
    expect(encodeDiceLook(PLAIN_DICE_LOOK)).toBe('');
    expect(isPlainDiceLook(PLAIN_DICE_LOOK)).toBe(true);
  });

  it('reads back what it writes', () => {
    const looks: DiceLook[] = [
      { material: 'marble', body: '', ink: '' },
      { material: 'resin', body: '#1e6b52', ink: '' },
      { material: 'metal', body: '#b08d57', ink: '#1a1a1a' },
      { material: 'glass', body: '#3b5bdb', ink: '#f6f3ec' },
    ];

    for (const look of looks) expect(decodeDiceLook(encodeDiceLook(look))).toEqual(look);
  });

  it('writes only what differs from the plain look', () => {
    expect(JSON.parse(encodeDiceLook({ material: 'resin', body: '#1e6b52', ink: '' }))).toEqual({
      material: 'resin',
      body: '#1e6b52',
    });
  });

  describe('a line said before looks were offered, or by another version', () => {
    it('reads nothing at all as the plain look, never as some material', () => {
      expect(decodeDiceLook('')).toEqual(PLAIN_DICE_LOOK);
      expect(decodeDiceLook(undefined)).toEqual(PLAIN_DICE_LOOK);
      expect(decodeDiceLook(null)).toEqual(PLAIN_DICE_LOOK);
    });

    it('reads what it cannot make sense of as the plain look', () => {
      expect(decodeDiceLook('{not json')).toEqual(PLAIN_DICE_LOOK);
      expect(decodeDiceLook('"marble"')).toEqual(PLAIN_DICE_LOOK);
      expect(decodeDiceLook('[1,2]')).toEqual(PLAIN_DICE_LOOK);
    });

    it('reads a material it does not know as resin, keeping the colours', () => {
      expect(decodeDiceLook('{"material":"bone","body":"#aabbcc","sparkle":true}')).toEqual({
        material: 'resin',
        body: '#aabbcc',
        ink: '',
      });
    });

    it('leaves a colour that is not one to the default', () => {
      expect(asDiceLook({ material: 'metal', body: 'red', ink: '#12345' })).toEqual({
        material: 'metal',
        body: '',
        ink: '',
      });
      expect(asDiceLook({ material: 'glass', body: ' #AABBCC ' }).body).toBe('#aabbcc');
    });
  });
});
