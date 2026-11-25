import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const DEV_SERVER_URL = 'http://127.0.0.1:5173';

function runStepSync(label, command, args) {
  console.log(`[dev] Running ${label}...`);
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`[dev] Failed ${label}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[dev] ${label} exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function checkHttpReady(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForVite(url, viteProc, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (viteProc.exitCode !== null) {
      throw new Error(`Vite exited early with code ${viteProc.exitCode}`);
    }
    if (await checkHttpReady(url)) {
      return;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for Vite dev server at ${url}`);
}

function terminateChild(child) {
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }
  try {
    child.kill();
  } catch {
    // Ignore errors when process already exited.
  }
}

async function main() {
  runStepSync('build-hook', process.execPath, [path.resolve(ROOT_DIR, 'scripts', 'build-hook.mjs')]);
  runStepSync('generate-icon', process.execPath, [path.resolve(ROOT_DIR, 'scripts', 'generate-icon.mjs')]);
  runStepSync('tsc (electron)', process.execPath, [
    path.resolve(ROOT_DIR, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p',
    'tsconfig.electron.json',
  ]);

  console.log('[dev] Starting Vite dev server...');
  const viteProc = spawn(
    process.execPath,
    [path.resolve(ROOT_DIR, 'node_modules', 'vite', 'bin', 'vite.js')],
    {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    }
  );

  let electronProc = null;
  let shuttingDown = false;

  const shutdown = (exitCode = 0) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    terminateChild(electronProc);
    terminateChild(viteProc);
    process.exit(exitCode);
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  viteProc.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[dev] Vite exited unexpectedly (code ${code ?? 'null'}).`);
      shutdown(code ?? 1);
    }
  });

  try {
    await waitForVite(DEV_SERVER_URL, viteProc);
  } catch (err) {
    console.error(`[dev] ${err instanceof Error ? err.message : String(err)}`);
    shutdown(1);
    return;
  }

  const electronBinary = require('electron');
  const electronEnv = {
    ...process.env,
    VITE_DEV_SERVER_URL: DEV_SERVER_URL,
  };
  delete electronEnv.ELECTRON_RUN_AS_NODE;

  console.log('[dev] Launching Electron...');
  electronProc = spawn(electronBinary, ['.'], {
    cwd: ROOT_DIR,
    env: electronEnv,
    stdio: 'inherit',
  });

  electronProc.on('exit', (code) => {
    shutdown(code ?? 0);
  });

  electronProc.on('error', (err) => {
    console.error(`[dev] Failed to launch Electron: ${err.message}`);
    shutdown(1);
  });
}

main();
