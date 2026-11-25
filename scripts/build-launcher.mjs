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
  const csPath = path.join(ROOT_DIR, 'native', 'GrowTypeLauncher.cs');
  const icoPath = path.join(ROOT_DIR, 'assets', 'growtype.ico');
  const exePath = path.join(ROOT_DIR, 'GrowType.exe');

  if (!fs.existsSync(csPath)) {
    console.error(`[build-launcher] Missing source file: ${csPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(icoPath)) {
    console.error(`[build-launcher] Missing icon file: ${icoPath}. Run "npm run build:icon" first.`);
    process.exit(1);
  }

  if (!force && fs.existsSync(exePath)) {
    const csStat = fs.statSync(csPath);
    const icoStat = fs.statSync(icoPath);
    const exeStat = fs.statSync(exePath);
    const latestInput = Math.max(csStat.mtimeMs, icoStat.mtimeMs);
    if (exeStat.mtimeMs >= latestInput) {
      console.log('[build-launcher] GrowType.exe is up to date.');
      return;
    }
  }

  const cscPath = findCscCompiler();
  if (!cscPath) {
    console.error(
      `[build-launcher] Could not find .NET Framework 4.x csc.exe in:\n  - ${CSC_CANDIDATES.join('\n  - ')}`
    );
    process.exit(1);
  }

  console.log(`[build-launcher] Compiling native/GrowTypeLauncher.cs using ${cscPath}...`);
  const result = spawnSync(
    cscPath,
    [
      '/nologo',
      '/optimize+',
      '/target:winexe',
      `/win32icon:${icoPath}`,
      `/out:${exePath}`,
      csPath,
    ],
    {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      windowsHide: true,
    }
  );

  if (result.error) {
    console.error(`[build-launcher] Failed to run csc.exe: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[build-launcher] Compilation failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }

  console.log('[build-launcher] Built GrowType.exe successfully.');
}

main();
