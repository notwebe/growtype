import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function main() {
  const exePath = path.join(ROOT_DIR, 'GrowType.exe');
  const icoPath = path.join(ROOT_DIR, 'assets', 'growtype.ico');

  if (!fs.existsSync(exePath)) {
    console.error(`[install-shortcuts] Missing ${exePath}. Run "npm run build" first.`);
    process.exit(1);
  }
  if (!fs.existsSync(icoPath)) {
    console.error(`[install-shortcuts] Missing ${icoPath}. Run "npm run build:icon" first.`);
    process.exit(1);
  }

  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    "$shell = New-Object -ComObject WScript.Shell",
    "$desktop = [Environment]::GetFolderPath('Desktop')",
    "$programs = [Environment]::GetFolderPath('Programs')",
    "$targets = @((Join-Path $desktop 'GrowType.lnk'), (Join-Path $programs 'GrowType.lnk'))",
    "foreach ($lnkPath in $targets) {",
    "  $sc = $shell.CreateShortcut($lnkPath)",
    "  $sc.TargetPath = $env:GROWTYPE_TARGET",
    "  $sc.WorkingDirectory = $env:GROWTYPE_WORKDIR",
    "  $sc.IconLocation = $env:GROWTYPE_ICON",
    "  $sc.Description = $env:GROWTYPE_DESCRIPTION",
    "  $sc.Save()",
    "  Write-Output $lnkPath",
    "}",
  ].join('\n');

  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        GROWTYPE_TARGET: exePath,
        GROWTYPE_WORKDIR: ROOT_DIR,
        GROWTYPE_ICON: `${icoPath},0`,
        GROWTYPE_DESCRIPTION: 'GrowType — Desktop Pixel Tree Widget',
      },
    }
  );

  if (result.error) {
    console.error(`[install-shortcuts] Failed to run PowerShell: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[install-shortcuts] PowerShell exited ${result.status}: ${result.stderr || result.stdout}`);
    process.exit(result.status ?? 1);
  }

  const created = (result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const shortcutPath of created) {
    console.log(`[install-shortcuts] Created shortcut: ${shortcutPath}`);
  }
}

main();
