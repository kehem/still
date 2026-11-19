import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const projectRoot = process.cwd();

/**
 * Production Content Security Policy, injected as a <meta> tag.
 *
 * The main process also sets CSP response headers, but `onHeadersReceived`
 * does not reliably fire for `file://` loads — which is exactly how the
 * packaged app is served. The meta tag guarantees the policy applies in both
 * dev (served over http) and production (loaded from disk). No remote origins
 * are permitted anywhere: Still talks to no server (spec §3).
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  // XLSX decompression uses local blob workers; no remote scripts are allowed.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function injectCsp(): Plugin {
  return {
    name: 'still:inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  root: path.join(projectRoot, 'src/renderer'),
  // Relative base so the production build loads correctly from file:// inside Electron.
  base: './',
  plugins: [react(), tailwindcss(), injectCsp()],
  server: {
    // Bind to all interfaces so the sandboxed live preview can proxy to it.
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    outDir: path.join(projectRoot, 'dist/renderer'),
    emptyOutDir: true,
  },
});
