import { AC6TRPG_BROWSER_TITLE, AC6TRPG_CONFIG } from '@axe/features/ac6trpg/ac6trpg-config';
import { version as upstreamAxeVersion } from '@pkg';

describe('AC6TRPG_CONFIG', () => {
  it('records the AC6TRPG and upstream Axe versions separately', () => {
    expect(AC6TRPG_CONFIG.version).toBe('0.1.0');
    expect(AC6TRPG_CONFIG.upstream.version).toBe(upstreamAxeVersion);
  });

  it('builds a browser title that identifies both versions', () => {
    expect(AC6TRPG_BROWSER_TITLE).toBe(`AC6TRPG Axe v0.1.0 (Axe v${upstreamAxeVersion})`);
  });
});
