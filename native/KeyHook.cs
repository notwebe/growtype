using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace GrowType.KeyHook
{
    internal static class Program
    {
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int WM_SYSKEYUP = 0x0105;
        private const uint WM_QUIT = 0x0012;
        private const uint PM_NOREMOVE = 0x0000;
        private const long StaleKeyTimeoutSeconds = 5;

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public UIntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public POINT pt;
        }

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool PeekMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TranslateMessage(ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage(ref MSG lpMsg);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool PostThreadMessage(uint idThread, uint Msg, UIntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        // Stored in a static field so the GC never collects the unmanaged callback delegate.
        private static readonly LowLevelKeyboardProc _proc = HookCallback;
        private static IntPtr _hookId = IntPtr.Zero;

        // Track currently held non-modifier keys in RAM only (with timestamp) to ignore OS auto-repeat.
        private static readonly Dictionary<int, long> _pressedKeys = new Dictionary<int, long>();
        private static readonly long _staleThresholdTicks = Stopwatch.Frequency * StaleKeyTimeoutSeconds;

        private static uint _mainThreadId;
        private static int _quitRequested;

        public static int Main(string[] args)
        {
            int parentPid = -1;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--parent-pid")
                {
                    if (i + 1 >= args.Length || !int.TryParse(args[i + 1], out parentPid) || parentPid <= 0)
                    {
                        Console.Error.Write("Invalid --parent-pid argument\n");
                        Console.Error.Flush();
                        return 1;
                    }
                    i++;
                }
            }

            _mainThreadId = GetCurrentThreadId();

            // Initialize the thread message queue before background threads can post WM_QUIT.
            MSG initMsg;
            PeekMessage(out initMsg, IntPtr.Zero, 0, 0, PM_NOREMOVE);

            _hookId = InstallHook(_proc);
            if (_hookId == IntPtr.Zero)
            {
                Console.Error.Write("Failed to install keyboard hook\n");
                Console.Error.Flush();
                return 1;
            }

            try
            {
                StartStdinEofMonitor();
                if (parentPid > 0)
                {
                    StartParentProcessMonitor(parentPid);
                }

                Console.Error.Write("READY\n");
                Console.Error.Flush();

                MSG msg;
                while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
                {
                    TranslateMessage(ref msg);
                    DispatchMessage(ref msg);
                }

                return 0;
            }
            finally
            {
                if (_hookId != IntPtr.Zero)
                {
                    UnhookWindowsHookEx(_hookId);
                    _hookId = IntPtr.Zero;
                }
                _pressedKeys.Clear();
            }
        }

        private static IntPtr InstallHook(LowLevelKeyboardProc proc)
        {
            using (Process curProcess = Process.GetCurrentProcess())
            using (ProcessModule curModule = curProcess.MainModule)
            {
                string moduleName = curModule != null ? curModule.ModuleName : null;
                return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(moduleName), 0);
            }
        }

        private static void StartStdinEofMonitor()
        {
            Thread thread = new Thread(() =>
            {
                try
                {
                    while (Console.In.ReadLine() != null)
                    {
                    }
                }
                catch (IOException)
                {
                }
                catch (ObjectDisposedException)
                {
                }
                finally
                {
                    RequestQuit();
                }
            });
            thread.IsBackground = true;
            thread.Start();
        }

        private static void StartParentProcessMonitor(int parentPid)
        {
            Thread thread = new Thread(() =>
            {
                try
                {
                    using (Process parent = Process.GetProcessById(parentPid))
                    {
                        parent.WaitForExit();
                    }
                }
                catch (ArgumentException)
                {
                    // Parent already exited.
                }
                catch (Exception)
                {
                    // Parent inaccessible or terminated.
                }
                finally
                {
                    RequestQuit();
                }
            });
            thread.IsBackground = true;
            thread.Start();
        }

        private static void RequestQuit()
        {
            if (Interlocked.Exchange(ref _quitRequested, 1) == 0 && _mainThreadId != 0)
            {
                PostThreadMessage(_mainThreadId, WM_QUIT, UIntPtr.Zero, IntPtr.Zero);
            }
        }

        private static bool IsModifierKey(int vkCode)
        {
            return vkCode == 0x10
                || vkCode == 0x11
                || vkCode == 0x12
                || vkCode == 0x14
                || vkCode == 0x5B
                || vkCode == 0x5C
                || (vkCode >= 0xA0 && vkCode <= 0xA5);
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && lParam != IntPtr.Zero)
            {
                int msg = wParam.ToInt32();
                KBDLLHOOKSTRUCT hookInfo = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                int vkCode = unchecked((int)hookInfo.vkCode);

                if (!IsModifierKey(vkCode))
                {
                    if (msg == WM_KEYUP || msg == WM_SYSKEYUP)
                    {
                        _pressedKeys.Remove(vkCode);
                    }
                    else if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN)
                    {
                        long now = Stopwatch.GetTimestamp();
                        long pressedAt;
                        if (!_pressedKeys.TryGetValue(vkCode, out pressedAt) || (now - pressedAt) >= _staleThresholdTicks)
                        {
                            _pressedKeys[vkCode] = now;
                            try
                            {
                                Console.Out.Write("K\n");
                                Console.Out.Flush();
                            }
                            catch (IOException)
                            {
                            }
                        }
                    }
                }
            }

            return CallNextHookEx(_hookId, nCode, wParam, lParam);
        }
    }
}
