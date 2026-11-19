import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { readSheet } from 'read-excel-file/browser';
it('reads a real XLSX first sheet into the mapping table', async () => {
  const bytes = readFileSync(new URL('./fixtures/contacts.xlsx', import.meta.url));
  const table = await readSheet(new Uint8Array(bytes), 1);
  expect(table).toEqual([['Email', 'Subject', 'Body'], ['reader@example.com', 'Hello', 'Hello from Excel']]);
});
it('allows local XLSX blob workers in production and Electron dev CSP without permitting inline production scripts', () => {
  const vite = readFileSync('vite.config.ts', 'utf8');
  const main = readFileSync('src/main/index.ts', 'utf8');
  expect(vite).toContain("worker-src 'self' blob:");
  expect(main).toContain("worker-src 'self' blob:");
  expect(vite).toContain('"script-src \'self\'"');
});
