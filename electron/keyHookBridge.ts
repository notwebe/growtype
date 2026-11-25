import { type ChildProcessByStdio, spawn } from 'node:child_process';
import fs from 'node:fs';
import type { Readable, Writable } from 'node:stream';

export interface KeyTickParseResult {
  ticks: number;
  remainder: string;
}

export function extractKeyTicks(chunk: string, remainder = ''): KeyTickParseResult {
  const combined = remainder + chunk;
  const lines = combined.split(/\r?\n/);
  const nextRemainder = lines.pop() ?? '';

  let ticks = 0;
  for (const line of lines) {
    if (line.trim() === 'K') {
      ticks += 1;
    }
  }

  return { ticks, remainder: nextRemainder };
}

export class KeyTickParser {
  private remainder = '';

  push(chunk: string): number {
    const result = extractKeyTicks(chunk, this.remainder);
    this.remainder = result.remainder;
    return result.ticks;
  }

  reset(): void {
    this.remainder = '';
  }
}

export interface KeyHookBridgeOptions {
  exePath: string;
  onTick: () => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
  maxRestarts?: number;
  killTimeoutMs?: number;
}

export class KeyHookBridge {
  private readonly exePath: string;
  private readonly onTick: () => void;
  private readonly onReady?: () => void;
  private readonly onError?: (error: Error) => void;
  private readonly maxRestarts: number;
  private readonly killTimeoutMs: number;

  private child: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
  private active = false;
  private stopping = false;
  private restartCount = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly stdoutParser = new KeyTickParser();
  private stderrRemainder = '';

  constructor(options: KeyHookBridgeOptions) {
    this.exePath = options.exePath;
    this.onTick = options.onTick;
    this.onReady = options.onReady;
    this.onError = options.onError;
    this.maxRestarts = options.maxRestarts ?? 5;
    this.killTimeoutMs = options.killTimeoutMs ?? 500;
  }

  isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  start(): void {
    if (this.active && (this.isRunning() || this.restartTimer !== null)) {
      return;
    }

    this.active = true;
    this.stopping = false;
    this.restartCount = 0;
    this.spawnHook();
  }

  private spawnHook(): void {
    if (!this.active || this.stopping) {
      return;
    }

    if (!fs.existsSync(this.exePath)) {
      this.active = false;
      this.onError?.(new Error(`Native key hook binary not found: ${this.exePath}`));
      return;
    }

    this.stdoutParser.reset();
    this.stderrRemainder = '';

    const child = spawn(this.exePath, ['--parent-pid', String(process.pid)], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdin.on('error', () => {
      // Ignore EPIPE when child terminates concurrently with stdin close.
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (!this.active || this.stopping) {
        return;
      }
      const ticks = this.stdoutParser.push(chunk);
      for (let i = 0; i < ticks; i++) {
        this.onTick();
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const combined = this.stderrRemainder + chunk;
      const lines = combined.split(/\r?\n/);
      this.stderrRemainder = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        if (line === 'READY') {
          this.restartCount = 0;
          this.onReady?.();
        } else if (!this.stopping) {
          this.onError?.(new Error(`KeyHook stderr: ${line}`));
        }
      }
    });

    child.on('error', (err) => {
      if (!this.stopping) {
        this.onError?.(err);
      }
    });

    child.on('exit', (code, signal) => {
      if (this.child === child) {
        this.child = null;
      }

      if (this.stopping || !this.active) {
        return;
      }

      if (this.restartCount < this.maxRestarts) {
        const backoffMs = Math.min(8000, 500 * Math.pow(2, this.restartCount));
        this.restartCount += 1;
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this.spawnHook();
        }, backoffMs);
      } else {
        this.active = false;
        this.onError?.(
          new Error(
            `KeyHook exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'}); reached max restarts (${this.maxRestarts}).`
          )
        );
      }
    });
  }

  stop(): Promise<void> {
    this.stopping = true;
    this.active = false;

    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const child = this.child;
    if (!child || child.exitCode !== null) {
      this.child = null;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(killTimer);
        if (this.child === child) {
          this.child = null;
        }
        resolve();
      };

      const killTimer = setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          try {
            child.kill();
          } catch {
            // Ignore if already gone.
          }
        }
        finish();
      }, this.killTimeoutMs);

      child.once('exit', finish);

      try {
        child.stdin.end();
      } catch {
        // Fallback to timer / kill if stdin is already closed.
      }
    });
  }
}
