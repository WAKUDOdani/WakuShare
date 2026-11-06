using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Channels;

// OUTOFCONTEXT window notifications are available without administrator rights.
// A notification is only a candidate; SDK modules/build/session are checked later.
// No process enumeration loop, timer, input, foreground or focus operation.
internal sealed class EditorProcessEvents : IDisposable
{
    private readonly Channel<int> _events = Channel.CreateBounded<int>(new BoundedChannelOptions(1) {
        SingleReader = true, SingleWriter = true, FullMode = BoundedChannelFullMode.DropOldest });
    private readonly Thread _thread;
    private readonly string _processName;
    private readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private uint _threadId;
    private bool _disposed;
    private delegate void Callback(nint hook, uint eventId, nint window, int objectId, int childId, uint eventThread, uint time);
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Message { public nint Window; public uint Id; public nuint WParam; public nint LParam; public uint Time; public Point Position; public uint Private; }
    [DllImport("user32.dll")] private static extern nint SetWinEventHook(uint first, uint last, nint module, Callback callback, uint processId, uint threadId, uint flags);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UnhookWinEvent(nint hook);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint window, out uint pid);
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint window, uint flags);
    [DllImport("user32.dll")] private static extern int GetMessageW(out Message message, nint window, uint min, uint max);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool PeekMessageW(out Message message, nint window, uint min, uint max, uint remove);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool PostThreadMessageW(uint threadId, uint message, nuint wParam, nint lParam);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();

    public EditorProcessEvents(string processName = "CapCut")
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        _processName = processName;
        _thread = new Thread(Observe) { IsBackground = true, Name = "WakuShare editor lifecycle" };
        _thread.Start();
    }
    public Task Ready => _ready.Task;
    public Task<int> ReadAsync() => _events.Reader.ReadAsync().AsTask();
    private void Observe()
    {
        var hooks = new List<nint>();
        Callback callback = (_, _, window, objectId, childId, _, _) => {
            if (window == 0 || objectId != 0 || childId != 0 || GetAncestor(window, 2) != window) return;
            GetWindowThreadProcessId(window, out var pid);
            if (pid == 0 || pid > int.MaxValue) return;
            try {
                using var process = Process.GetProcessById((int)pid);
                if (process.ProcessName.Equals(_processName, StringComparison.OrdinalIgnoreCase)) _events.Writer.TryWrite((int)pid);
            } catch (Exception error) when (error is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
        };
        try {
            _threadId = GetCurrentThreadId();
            PeekMessageW(out _, 0, 0, 0, 0); // Create a queue before publishing readiness.
            foreach (var id in new uint[] { 0x8000, 0x8002, 0x800c }) {
                var hook = SetWinEventHook(id, id, 0, callback, 0, 0, 0); // OUTOFCONTEXT, including our hidden fixture.
                if (hook == 0) throw new IOException("Editor process notification hook unavailable.");
                hooks.Add(hook);
            }
            _ready.SetResult();
            while (true) {
                var result = GetMessageW(out _, 0, 0, 0);
                if (result == 0) break;
                if (result < 0) throw new IOException("Editor process notification stream failed.");
                // WinEvent out-of-context callbacks are dispatched by GetMessage.
            }
        } catch (Exception error) {
            _ready.TrySetException(error); _events.Writer.TryComplete(error);
        } finally {
            foreach (var hook in hooks) UnhookWinEvent(hook);
            GC.KeepAlive(callback); _events.Writer.TryComplete();
        }
    }
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_threadId != 0) PostThreadMessageW(_threadId, 0x12, 0, 0);
        if (!_thread.Join(TimeSpan.FromSeconds(3))) throw new IOException("Editor process observer did not stop.");
    }
}
