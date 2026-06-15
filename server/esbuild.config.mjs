import { build } from 'esbuild';
import { cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Production-сборка сервера. tsc для продакшна не используется (server/tsconfig.json
// стоит noEmit; tsc оставлен только для typecheck). esbuild бандлит API и раннер
// миграций, внешние npm-зависимости остаются external (резолвятся из node_modules
// в рантайме), а @estimat/shared инлайнится из исходников — так нет проблем с
// рантайм-резолвом workspace-алиаса. Dev-режим (tsx/vite) этим не затрагивается.

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, 'dist');
const sharedEntry = resolve(__dirname, '../shared/src/index.ts');

await rm(distDir, { recursive: true, force: true });

await build({
  entryPoints: [
    resolve(__dirname, 'src/index.ts'),
    resolve(__dirname, 'src/db/migrate.ts'),
  ],
  outdir: distDir,
  outbase: resolve(__dirname, 'src'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  alias: { '@estimat/shared': sharedEntry },
  // Shim для CJS-зависимостей, использующих require внутри ESM-выхода.
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});

// SQL-миграции читаются в рантайме migrate.ts по относительному пути dist/db/migrations.
await cp(resolve(__dirname, 'src/db/migrations'), resolve(distDir, 'db/migrations'), {
  recursive: true,
});

console.log('Server build complete → dist/');
