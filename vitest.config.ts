import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Explicit opt-in for environments without the Electron/Node native addon.
  resolve: process.env.STILL_TEST_SQLITE === 'node' ? {
    alias: { 'better-sqlite3': new URL('./src/main/test/sqlite-adapter.ts', import.meta.url).pathname },
  } : undefined,
  test: {
    // Node by default; renderer tests opt into jsdom with a file docblock.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/renderer/test/setup.ts'],
  },
});
