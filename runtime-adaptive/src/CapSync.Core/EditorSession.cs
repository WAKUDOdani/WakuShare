using System.Security.Cryptography;
using System.Text;

namespace CapSync.Core;

/// <summary>The caller supplies a directory resolved by the native identity getter.</summary>
public sealed record ProjectKey
{
    public string DraftId { get; }
    public string Location { get; }
    public string Value { get; }
    private ProjectKey(string draftId, string location)
    {
        DraftId = draftId; Location = location;
        Value = "project-v1-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            draftId + "\0" + location.ToUpperInvariant()))).ToLowerInvariant();
    }
    public static ProjectKey FromCanonical(string draftId, string location)
    {
        if (!Guid.TryParseExact(draftId, "D", out var id) || id == Guid.Empty)
            throw new InvalidDataException("Invalid draft ID.");
        if (string.IsNullOrWhiteSpace(location) || location.Length > 8192 || location.Contains('\0') ||
            !Path.IsPathFullyQualified(location)) throw new InvalidDataException("Absolute canonical project directory required.");
        // Final-path resolution belongs at the native/filesystem boundary. Do
        // not require an offline project's directory to exist just to read its key.
        var normalized = SourcePaths.NormalizeRoot(location);
        return new(id.ToString("D").ToUpperInvariant(), normalized);
    }
    public bool SameProject(ProjectKey other) => Value == other.Value;
    public bool Equals(ProjectKey? other) => other?.Value == Value;
    public override int GetHashCode() => StringComparer.Ordinal.GetHashCode(Value);
}

public sealed record EditorObservation(long Sequence, string Status, string? DraftId, string? Location, long ViewEpoch);
public sealed record EditorLease(Guid ConnectionId, long Generation, int ProcessId, string ProjectKey);
public sealed record EditorSessionState(string Status, int ProcessId, Guid ConnectionId, long Generation,
    long Sequence, long ViewEpoch, ProjectKey? Project, string? Reason);

/// <summary>One transport owner; every gap/disconnect revokes the previous lease.</summary>
public sealed class EditorSessionTracker
{
    private readonly int _pid;
    private readonly Guid _connection;
    private long _generation, _sequence, _viewEpoch;
    private ProjectKey? _project;
    private string _status = "Connecting";
    private string? _reason;
    public EditorSessionTracker(int processId, Guid connectionId)
    {
        if (processId <= 0 || connectionId == Guid.Empty) throw new ArgumentException("Explicit editor process and connection required.");
        _pid = processId; _connection = connectionId;
    }
    public EditorSessionState State => new(_status, _pid, _connection, _generation, _sequence, _viewEpoch, _project, _reason);
    public void Apply(EditorObservation observation)
    {
        if (_status is "Disconnected" or "Faulted") throw new InvalidOperationException("Reconnect requires a new tracker and connection.");
        try
        {
            if (observation.Sequence < 1 || observation.Sequence > 9007199254740991 || observation.Sequence != _sequence + 1 ||
                observation.ViewEpoch < _viewEpoch || observation.ViewEpoch < 0 || observation.ViewEpoch > 9007199254740991)
                throw new InvalidDataException("Native event order or view epoch changed.");
            if (observation.Status is not ("Project" or "Home" or "Unavailable")) throw new InvalidDataException("Unknown editor state.");
            var project = observation.Status == "Project" ? ProjectKey.FromCanonical(
                observation.DraftId ?? "", observation.Location ?? "") : null;
            if (project == null && (observation.DraftId != null || observation.Location != null))
                throw new InvalidDataException("Non-project state cannot retain project ownership.");
            if (_status != observation.Status || _viewEpoch != observation.ViewEpoch ||
                project?.Value != _project?.Value) ++_generation;
            _sequence = observation.Sequence; _viewEpoch = observation.ViewEpoch;
            _project = project; _status = observation.Status; _reason = null;
        }
        catch (InvalidDataException)
        { Invalidate("Faulted", "InvalidNativeSequenceOrIdentity"); throw; }
    }
    public EditorLease? Lease() => _status == "Project" && _project != null
        ? new(_connection, _generation, _pid, _project.Value) : null;
    public bool Matches(EditorLease lease) => Lease() == lease;
    public void Disconnect(string reason = "NativeDisconnected") => Invalidate("Disconnected", reason);
    private void Invalidate(string status, string reason)
    { ++_generation; _project = null; _status = status; _reason = reason; }
}
