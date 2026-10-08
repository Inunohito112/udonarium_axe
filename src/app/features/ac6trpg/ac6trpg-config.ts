import { version as upstreamAxeVersion } from '@pkg';

/** AC6TRPG版と、その土台にしている本家Axeの識別情報。 */
export const AC6TRPG_CONFIG = {
  appName: 'AC6TRPG Axe',
  version: '0.1.0',
  upstream: {
    appName: 'Udonarium Axe',
    version: upstreamAxeVersion,
  },
} as const;

/** ブラウザのタブに表示するタイトル。 */
export const AC6TRPG_BROWSER_TITLE = `${AC6TRPG_CONFIG.appName} v${AC6TRPG_CONFIG.version} (Axe v${AC6TRPG_CONFIG.upstream.version})`;
