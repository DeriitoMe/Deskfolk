using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Principal;
using System.Threading;
using System.Web.Script.Serialization;

// No renderer, network, task-state guesses, or console window. Run as the user.
internal static class CodexLauncher {
    private sealed class Configuration {
        public bool enabled { get; set; }
        public string executable { get; set; }
    }
    internal static bool IsDesktopPath(string path) {
        if (String.IsNullOrEmpty(path)) return false;
        path = path.Replace('/', '\\');
        return path.IndexOf("\\OpenAI.Codex_", StringComparison.OrdinalIgnoreCase) >= 0 &&
               path.IndexOf("\\app\\", StringComparison.OrdinalIgnoreCase) >= 0 ||
               path.IndexOf("\\OpenAI\\Codex\\", StringComparison.OrdinalIgnoreCase) >= 0 &&
               path.IndexOf("\\app\\", StringComparison.OrdinalIgnoreCase) >= 0;
    }
    private static bool PetRunning(string executable) {
        foreach (Process p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(executable))) {
            using (p) { try { if (String.Equals(p.MainModule.FileName, executable, StringComparison.OrdinalIgnoreCase)) return true; } catch { } }
        }
        return false;
    }
    private static bool Launch(Configuration config) {
        if (PetRunning(config.executable)) return true;
        try {
            var info = new ProcessStartInfo(config.executable, "--started-with-codex") {
                UseShellExecute = false, CreateNoWindow = true,
                WorkingDirectory = Path.GetDirectoryName(config.executable)
            };
            using (Process p = Process.Start(info)) { }
            return true;
        } catch { return false; }
    }
    private static Configuration Read(string file) {
        for (int attempt=0; attempt<3; attempt++) {
            if (!File.Exists(file)) return null;
            try {
                using (var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))
                using (var reader=new StreamReader(stream)) {
                    var config=new JavaScriptSerializer().Deserialize<Configuration>(reader.ReadToEnd());
                    if(config!=null)return config;
                }
            } catch { }
            if(attempt<2) Thread.Sleep(20);
        }
        return null;
    }
    private static int Watch(string file) {
        var seen = new HashSet<string>();
        while (true) {
            var config = Read(file);
            if (config == null || !config.enabled || !File.Exists(config.executable)) return 0;
            var alive = new HashSet<string>();
            foreach (string name in new string[] { "ChatGPT", "Codex" }) {
                foreach (Process p in Process.GetProcessesByName(name)) {
                    using (p) { try {
                        if (!IsDesktopPath(p.MainModule.FileName)) continue;
                        var identity = p.Id + ":" + p.StartTime.ToUniversalTime().Ticks;
                        alive.Add(identity);
                        // Electron children cannot trigger repeated starts. A
                        // minimized main window still retains its native handle.
                        if (p.MainWindowHandle == IntPtr.Zero || seen.Contains(identity)) continue;
                        if (Launch(config)) seen.Add(identity);
                    } catch { } }
                }
            }
            seen.RemoveWhere(identity => !alive.Contains(identity));
            Thread.Sleep(750);
        }
    }
    private static int SelfTest(string output) {
        bool packaged = IsDesktopPath(@"C:\Program Files\WindowsApps\OpenAI.Codex_1_x64\app\ChatGPT.exe");
        bool portable = IsDesktopPath(@"C:\Users\Example\AppData\Local\OpenAI\Codex\version\app\ChatGPT.exe");
        bool cliExcluded = !IsDesktopPath(@"C:\Users\Example\AppData\Local\OpenAI\Codex\bin\version\codex.exe");
        bool otherExcluded = !IsDesktopPath(@"C:\Other\ChatGPT.exe");
        File.WriteAllText(output, new JavaScriptSerializer().Serialize(new { passed=packaged && portable && cliExcluded && otherExcluded, packaged, portable, cliExcluded, otherExcluded }));
        return packaged && portable && cliExcluded && otherExcluded ? 0 : 1;
    }
    private static int Main(string[] args) {
        if (args.Length == 2 && args[0] == "--self-test") return SelfTest(args[1]);
        if (args.Length == 2 && args[0] == "--probe") {
            int windows=0;
            foreach (string name in new string[] { "ChatGPT", "Codex" }) foreach (Process p in Process.GetProcessesByName(name)) {
                using(p) { try { if(IsDesktopPath(p.MainModule.FileName) && p.MainWindowHandle!=IntPtr.Zero) windows++; } catch { } }
            }
            File.WriteAllText(args[1],new JavaScriptSerializer().Serialize(new { officialDesktopWindows=windows, detected=windows>0 }));return windows>0?0:1;
        }
        if (args.Length != 2 || args[0] != "--watch") return 2;
        bool created;
        using (var mutex = new Mutex(true, "Local\\DeskfolkCodexCompanion-" + WindowsIdentity.GetCurrent().User.Value, out created)) {
            if (!created) return 0;
            return Watch(Path.GetFullPath(args[1]));
        }
    }
}
