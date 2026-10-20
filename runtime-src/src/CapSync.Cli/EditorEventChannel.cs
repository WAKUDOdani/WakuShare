using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CapSync.Core;
using Microsoft.Win32.SafeHandles;

// Private read-only channel. It accepts a single verified editor PID, not an
// arbitrary local client. Closing it is the native observer's stop signal.
internal sealed class EditorEventChannel : IDisposable
{
    private readonly NamedPipeServerStream _pipe;
    private readonly CancellationTokenSource _stopping = new();
    private readonly EditorSessionTracker _tracker;
    private bool _disposed;
    public string PipeName { get; } = "wakushare-explorer-" + Guid.NewGuid().ToString("N");
    public string Token { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    public Guid ConnectionId { get; } = Guid.NewGuid();
    public int ProcessId { get; }
    public EditorSessionState State => _tracker.State;
    public EditorLease? Lease() => _tracker.Lease();
    public bool Matches(EditorLease lease) => _tracker.Matches(lease);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint processId);

    public EditorEventChannel(int processId)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Native editor events currently require Windows.");
        ProcessId = processId; _tracker = new(processId, ConnectionId);
        _pipe = new(PipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly, 16384, 16384);
    }

    // Return one state at a time. The worker's actor applies it before its next
    // action, so the tracker and its lease are never mutated on a reader thread.
    public async Task<EditorObservation?> ReadAsync()
    {
        var cancellation = _stopping.Token;
        if (!_pipe.IsConnected)
        {
            await _pipe.WaitForConnectionAsync(cancellation);
            if (!GetNamedPipeClientProcessId(_pipe.SafePipeHandle, out var pid) || pid != ProcessId)
                throw new InvalidDataException("Native pipe client is not the expected editor process.");
        }
        var bytes = new List<byte>(); var one = new byte[1];
        while (await _pipe.ReadAsync(one, cancellation) != 0)
        {
            if (one[0] == 10) return Parse(bytes.ToArray());
            if (bytes.Count >= 32768) throw new InvalidDataException("Native frame exceeds limit.");
            bytes.Add(one[0]);
        }
        if (bytes.Count > 0) throw new InvalidDataException("Incomplete native frame.");
        return null;
    }
    public void Apply(EditorObservation observation) => _tracker.Apply(observation);
    public void Disconnect(string reason) => _tracker.Disconnect(reason);
    private EditorObservation Parse(byte[] bytes)
    {
        using var document = JsonDocument.Parse(new UTF8Encoding(false, true).GetString(bytes), new JsonDocumentOptions { MaxDepth = 8 });
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Native object required.");
        var allowed = new HashSet<string>(["protocolVersion", "token", "processId", "build", "sequence", "status", "draftId", "location", "viewEpoch"], StringComparer.Ordinal);
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in root.EnumerateObject())
            if (!allowed.Contains(property.Name) || !names.Add(property.Name)) throw new InvalidDataException("Native fields are unknown or duplicated.");
        if (names.Count != allowed.Count || root.GetProperty("protocolVersion").GetInt32() != 1 ||
            root.GetProperty("token").GetString() != Token || root.GetProperty("processId").GetInt32() != ProcessId ||
            root.GetProperty("build").GetString() != "9.6.0.4097") throw new InvalidDataException("Native handshake differs.");
        return new(root.GetProperty("sequence").GetInt64(), root.GetProperty("status").GetString() ?? "",
            root.GetProperty("draftId").GetString(), root.GetProperty("location").GetString(), root.GetProperty("viewEpoch").GetInt64());
    }
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true; _stopping.Cancel(); _pipe.Dispose(); _stopping.Dispose();
    }
}
