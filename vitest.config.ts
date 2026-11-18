import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node by default; renderer tests opt into jsdom with a file docblock.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/renderer/test/setup.ts'],
  },
});
