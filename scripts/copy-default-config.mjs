#!/usr/bin/env node
// AC6TRPG版の設定があればそれを、なければサンプル設定を
// `dist/assets/config.json`として配置する。
// 配布物がそのまま動くことと、上流版の従来動作を両立する。
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const projectConfig = resolve(root, 'src/assets/config.json');
const exampleConfig = resolve(root, 'src/assets/config.json.example');
const src = existsSync(projectConfig) ? projectConfig : exampleConfig;
const dst = resolve(root, 'dist/assets/config.json');

if (!existsSync(src)) {
  console.error(`[copy-default-config] source not found: ${projectConfig} or ${exampleConfig}`);
  process.exit(1);
}

mkdirSync(dirname(dst), { recursive: true });
copyFileSync(src, dst);
console.log(`[copy-default-config] ${src} -> ${dst}`);
