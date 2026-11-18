#!/usr/bin/env node
/**
 * Switches `better-sqlite3` between Electron's ABI and Node's ABI.
 *
 *     npm run rebuild        # Electron ABI  — required to run the app
 *     npm run rebuild:node   # Node ABI      — required to run `npm test`
 *
 * Why this script exists
 * ----------------------
 * `better-sqlite3` is a native module, and Electron embeds a *different*
 * Node/V8 ABI than the Node you install packages with. Only one binary can be
 * in place at a time, so the two workflows need opposite builds:
 *
 *   - `npm run dev` / `npm start` load it inside Electron → Electron ABI.
 *   - `npm test` runs Vitest under plain Node            → Node ABI.
 *
 * A wrong-ABI binary throws `NODE_MODULE_VERSION xxx` immediately, which is
 * easy to misread as a corrupt install.
 *
 * The obvious tool, `electron-rebuild`, goes straight to node-gyp — which on
 * Windows demands a Visual Studio C++ toolchain plus Python:
 *
 *     Error: Could not find any Visual Studio installation to use
 *
 * But `better-sqlite3` publishes **prebuilt** binaries for both runtimes, so
 * compiling is usually unnecessary. This script downloads first and only falls
 * back to a compile when no prebuild exists for the ABI in use.
 *
 * Which versions have prebuilds (better-sqlite3 12.11.1)
 * ------------------------------------------------------
 *   Node 20 (ABI 115)     → none; must compile
 *   Node 22 (ABI 127)     → yes
 *   Node 24 (ABI 137)     → yes
 *   Electron 42 (ABI 146) → yes (win32 x64/ia32/arm64, darwin, linux)
 *   Electron 43+ (148–150)→ none; must compile
 *
 * Hence `engines.node >= 22` and the Electron pin in package.json: together
 * they make the whole install compile-free on every platform.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = 'better-sqlite3';
const BINARY = path.join(root, 'node_modules', MODULE, 'build/Release/better_sqlite3.node');

const arg = process.argv.find((a) => a.startsWith('--runtime='));
const runtime = (arg ? arg.split('=')[1] : 'electron').toLowerCase();
if (!['electron', 'node'].includes(runtime)) {
  console.error(`✖ Unknown runtime "${runtime}". Use --runtime=electron or --runtime=node.`);
  process.exit(1);
}

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function abiFor(version, rt) {
  try {
    return require('node-abi').getAbi(version, rt);
  } catch {
    return 'unknown';
  }
}

// ── 1. Resolve the target runtime version ───────────────────────────────────
let target;
if (runtime === 'electron') {
  const electronPkg = readJson(path.join(root, 'node_modules/electron/package.json'));
  if (!electronPkg?.version) fail('Electron is not installed. Run `npm install` first.');
  target = electronPkg.version;
} else {
  target = process.versions.node;
}

const { platform, arch } = process;
console.log('Still native module switch');
console.log(`  module    ${MODULE}`);
console.log(`  runtime   ${runtime} ${target} (ABI ${abiFor(target, runtime)})`);
console.log(`  platform  ${platform}-${arch}`);
console.log(`  purpose   ${runtime === 'electron' ? 'run the app (npm run dev)' : 'run the tests (npm test)'}\n`);

const moduleDir = path.join(root, 'node_modules', MODULE);
if (!fs.existsSync(moduleDir)) fail(`${MODULE} is not installed. Run \`npm install\` first.`);

// ── 2. Fast path: download the matching prebuilt binary ─────────────────────
console.log('Trying prebuilt binary (no compiler needed)…');
let prebuildInstall;
try {
  prebuildInstall = require.resolve('prebuild-install/bin.js', { paths: [moduleDir, root] });
} catch {
  prebuildInstall = null;
}

let usedPrebuild = false;

if (prebuildInstall) {
  const res = spawnSync(
    process.execPath,
    [
      prebuildInstall,
      `--runtime=${runtime}`,
      `--target=${target}`,
      `--arch=${arch}`,
      `--platform=${platform}`,
    ],
    { cwd: moduleDir, stdio: 'inherit' },
  );
  if (res.status === 0 && fs.existsSync(BINARY)) {
    console.log('\n✔ Prebuilt binary in place — nothing was compiled.');
    usedPrebuild = true;
  }
}

// ── 3. Slow path: compile from source ───────────────────────────────────────
if (!usedPrebuild) {
console.log(`\nNo prebuild for ${runtime} ABI ${abiFor(target, runtime)} on ${platform}-${arch}.`);
console.log('Falling back to compiling from source…\n');

if (platform === 'win32') {
  console.log(`Compiling on Windows needs a one-time C++ toolchain install:

  winget install Microsoft.VisualStudio.2022.BuildTools --override ^
    "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

  (or: Visual Studio Installer → tick "Desktop development with C++")

Python 3 must also be on PATH.

Avoid it instead by using a combination that has prebuilds:
  Node 22 LTS  +  the Electron version pinned in package.json
then re-run:  npm install  &&  npm run rebuild
`);
}

let compile;
if (runtime === 'node') {
  compile = spawnSync('npm', ['rebuild', MODULE], {
    cwd: root,
    stdio: 'inherit',
    shell: platform === 'win32',
  });
} else {
  // Resolve @electron/rebuild's CLI directly. Relying on node_modules/.bin is
  // fragile: the bin link is not always created, depending on which of the
  // `electron-rebuild` shim or `@electron/rebuild` npm has materialised.
  let cli;
  try {
    cli = require.resolve('@electron/rebuild/lib/cli.js', { paths: [root] });
  } catch {
    fail('@electron/rebuild is not installed. Run `npm install` first.');
  }
  compile = spawnSync(process.execPath, [cli, '-f', '-w', MODULE], {
    cwd: root,
    stdio: 'inherit',
  });
}

if (compile.status !== 0) fail('Compilation failed — see the messages above.');
console.log('\n✔ Compiled from source.');
}

report();

// ── 4. Sanity-check the result ──────────────────────────────────────────────
function report() {
  if (!fs.existsSync(BINARY)) fail(`Expected binary missing: ${path.relative(root, BINARY)}`);
  const kb = fs.statSync(BINARY).size / 1024;
  console.log(`  ${path.relative(root, BINARY)} (${kb.toFixed(0)} kb)`);
  if (kb < 100) fail('Binary looks truncated (< 100 kb). Delete node_modules and reinstall.');

  if (runtime === 'node') {
    // Under Node we can actually load it and prove the ABI matches.
    try {
      const Database = require(path.join(moduleDir, 'lib/index.js'));
      const db = new Database(':memory:');
      const ok = db.prepare('SELECT 1 AS ok').get().ok === 1;
      db.close();
      console.log(`\n✔ Verified: loads under Node ${process.versions.node} and runs a query.`);
      if (!ok) fail('Module loaded but a trivial query failed.');
    } catch (err) {
      fail(`Module does not load under Node: ${String(err.message).split('\n')[0]}`);
    }
    console.log('\nNext: npm test');
  } else {
    console.log(
      '\nNote: this binary is for Electron and will NOT load under plain Node, so',
      '\n      `npm test` will fail until you run `npm run rebuild:node`.',
    );
    console.log('\nNext: npm run dev');
  }
}
