import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const CSC_CANDIDATES = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
];

function findCscCompiler() {
  for (const candidate of CSC_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function main() {
  const force = process.argv.includes('--force');
  const csPath = path.join(ROOT_DIR, 'native', 'KeyHook.cs');
  const exePath = path.join(ROOT_DIR, 'native', 'KeyHook.exe');

  if (!fs.existsSync(csPath)) {
    console.error(`[build-hook] Missing source file: ${csPath}`);
    process.exit(1);
  }

  if (!force && fs.existsSync(exePath)) {
    const csStat = fs.statSync(csPath);
    const exeStat = fs.statSync(exePath);
    if (exeStat.mtimeMs >= csStat.mtimeMs) {
      console.log('[build-hook] native/KeyHook.exe is up to date.');
      return;
    }
  }

  const cscPath = findCscCompiler();
  if (!cscPath) {
    console.error(
      `[build-hook] Could not find .NET Framework 4.x csc.exe in:\n  - ${CSC_CANDIDATES.join('\n  - ')}`
    );
    process.exit(1);
  }

  console.log(`[build-hook] Compiling native/KeyHook.cs using ${cscPath}...`);
  const result = spawnSync(
    cscPath,
    ['/nologo', '/optimize+', '/target:exe', `/out:${exePath}`, csPath],
    {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      windowsHide: true,
    }
  );

  if (result.error) {
    console.error(`[build-hook] Failed to run csc.exe: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[build-hook] Compilation failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }

  console.log('[build-hook] Built native/KeyHook.exe successfully.');
}

main();
