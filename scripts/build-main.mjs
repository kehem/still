import * as esbuild from 'esbuild';
import path from 'node:path';

const root = process.cwd();

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  external: ['electron', 'better-sqlite3'],
};

await esbuild.build({
  ...common,
  entryPoints: [path.join(root, 'src/main/index.ts')],
  outfile: path.join(root, 'dist/main/index.cjs'),
});

await esbuild.build({
  ...common,
  entryPoints: [path.join(root, 'src/preload/index.ts')],
  outfile: path.join(root, 'dist/preload/index.cjs'),
});
