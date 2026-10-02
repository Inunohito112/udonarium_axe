import { TestBed } from '@angular/core/testing';
import { MyDiceService } from '@axe/application/dice/my-dice.service';
import { PLAIN_DICE_LOOK } from '@axe/domain/dice/dice-3d/dice-look';
import { TEST_PROVIDERS } from '@axe/testing/test-providers';

describe('MyDiceService', () => {
  beforeEach(() => {
    localStorage.removeItem('my-dice');
    TestBed.configureTestingModule({ providers: [...TEST_PROVIDERS] });
  });

  afterEach(() => localStorage.removeItem('my-dice'));

  it('starts with the plain look in a browser that has kept none', () => {
    expect(TestBed.inject(MyDiceService).look()).toEqual(PLAIN_DICE_LOOK);
  });

  it('keeps the look chosen for the next visit', () => {
    TestBed.inject(MyDiceService).set({ material: 'metal', body: '#b08d57', ink: '' });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [...TEST_PROVIDERS] });

    expect(TestBed.inject(MyDiceService).look()).toEqual({ material: 'metal', body: '#b08d57', ink: '' });
  });

  it('reads a kept look it cannot make sense of as the plain one', () => {
    localStorage.setItem('my-dice', '{"material":');

    expect(TestBed.inject(MyDiceService).look()).toEqual(PLAIN_DICE_LOOK);
  });

  it('tidies a look as it is chosen', () => {
    const service = TestBed.inject(MyDiceService);

    service.set({ material: 'glass', body: '#AABBCC', ink: 'nonsense' });

    expect(service.look()).toEqual({ material: 'glass', body: '#aabbcc', ink: '' });
  });
});
