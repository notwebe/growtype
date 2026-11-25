import { describe, expect, it } from 'vitest';
import { KeyHookBridge, KeyTickParser, extractKeyTicks } from '../keyHookBridge';

describe('extractKeyTicks / KeyTickParser', () => {
  it('extracts single and multiple K lines with LF or CRLF', () => {
    expect(extractKeyTicks('K\n')).toEqual({ ticks: 1, remainder: '' });
    expect(extractKeyTicks('K\r\nK\r\nK\n')).toEqual({ ticks: 3, remainder: '' });
  });

  it('buffers partial stdout chunks across boundaries', () => {
    const parser = new KeyTickParser();

    expect(parser.push('K')).toBe(0);
    expect(parser.push('\n')).toBe(1);

    // Split CRLF across chunks
    expect(parser.push('K\r')).toBe(0);
    expect(parser.push('\nK')).toBe(1);
    expect(parser.push('\r\n')).toBe(1);

    // Multiple chunks forming mixed noise and K
    expect(parser.push('NO')).toBe(0);
    expect(parser.push('ISE\nK')).toBe(0);
    expect(parser.push('\n')).toBe(1);
  });

  it('ignores blank lines and non-tick noise', () => {
    const res = extractKeyTicks('\n\r\nREADY\nFOO\nKK\n  \nK\nBAR\n');
    expect(res.ticks).toBe(1);
    expect(res.remainder).toBe('');
  });
});

describe('KeyHookBridge', () => {
  it('reports missing executable cleanly via onError without throwing', async () => {
    const errors: Error[] = [];
    const bridge = new KeyHookBridge({
      exePath: 'C:\\nonexistent\\path\\KeyHook.exe',
      onTick: () => {},
      onError: (err) => errors.push(err),
    });

    bridge.start();
    expect(bridge.isRunning()).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('not found');
    await bridge.stop();
  });
});
