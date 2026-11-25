using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace GrowType.Launcher
{
    internal static class Program
    {
        private const uint MB_OK = 0x00000000;
        private const uint MB_ICONERROR = 0x00000010;

        [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "MessageBoxW")]
        private static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);

        private static string QuoteArg(string arg)
        {
            if (string.IsNullOrEmpty(arg))
            {
                return "\"\"";
            }
            if (arg.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
            {
                return arg;
            }
            string escaped = arg.Replace("\\", "\\\\").Replace("\"", "\\\"");
            return "\"" + escaped + "\"";
        }

        [STAThread]
        public static int Main(string[] args)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string electronExe = Path.Combine(baseDir, "node_modules", "electron", "dist", "electron.exe");
            string mainJs = Path.Combine(baseDir, "dist", "electron", "main.js");

            if (!File.Exists(electronExe))
            {
                MessageBox(
                    IntPtr.Zero,
                    "Electron runtime was not found at:\n" + electronExe + "\n\nRun \"npm install\" inside the GrowType folder first.",
                    "GrowType — Missing Runtime",
                    MB_OK | MB_ICONERROR
                );
                return 1;
            }

            if (!File.Exists(mainJs))
            {
                MessageBox(
                    IntPtr.Zero,
                    "GrowType build files were not found at:\n" + mainJs + "\n\nRun \"npm run build\" inside the GrowType folder first.",
                    "GrowType — Build Required",
                    MB_OK | MB_ICONERROR
                );
                return 1;
            }

            try
            {
                List<string> argList = new List<string>();
                argList.Add(QuoteArg(baseDir));
                if (args != null)
                {
                    foreach (string a in args)
                    {
                        argList.Add(QuoteArg(a));
                    }
                }

                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = electronExe,
                    Arguments = string.Join(" ", argList.ToArray()),
                    WorkingDirectory = baseDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");

                Process proc = Process.Start(psi);
                if (proc == null)
                {
                    MessageBox(
                        IntPtr.Zero,
                        "Unable to start GrowType.",
                        "GrowType — Launch Failed",
                        MB_OK | MB_ICONERROR
                    );
                    return 1;
                }

                return 0;
            }
            catch (Exception ex)
            {
                MessageBox(
                    IntPtr.Zero,
                    "Failed to launch GrowType:\n" + ex.Message,
                    "GrowType — Launch Error",
                    MB_OK | MB_ICONERROR
                );
                return 1;
            }
        }
    }
}
