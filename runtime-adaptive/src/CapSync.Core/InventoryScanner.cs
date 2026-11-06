using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

namespace CapSync.Core;

public sealed class InventoryScanner
{
    // Candidates only: actual codec/container acceptance belongs to the media adapter.
    public TimeSpan Stabilization { get; init; } = TimeSpan.FromMilliseconds(350);
    public static bool IsCandidate(string path) => MediaFormats.IsCandidate(path);
    public ScanWorkMetrics LastWork { get; private set; } = new(0, 0, 0, 0);
    private int _metadataEntries, _hashedFiles;
    private long _hashedBytes;
    private sealed record Stamp(string Relative, string FullPath, long Size, long Ticks, string? Identity);

    public async Task<Inventory> ScanAsync(Binding binding, IReadOnlyList<Source> cache,
        bool forceHash = false, IReadOnlyList<string>? dirtyPaths = null, CancellationToken cancellation = default)
    {
        _metadataEntries = 0; _hashedFiles = 0; _hashedBytes = 0; LastWork = new(0, 0, 0, 0);
        if (!Directory.Exists(binding.RootPath)) return new(false, false, [], ["Root is unavailable; deletion detection is suspended."]);
        var warnings = new List<string>();
        var complete = true;
        var before = Enumerate(binding.RootPath, warnings, ref complete);
        await Task.Delay(Stabilization, cancellation);
        if (!Directory.Exists(binding.RootPath)) {
            LastWork = new(1, _metadataEntries, _hashedFiles, _hashedBytes);
            return new(false, false, [], ["Root disappeared during scan."]);
        }
        var after = Enumerate(binding.RootPath, warnings, ref complete);
        var cached = cache.Where(s => s.BindingId == binding.Id).ToDictionary(s => s.RelativePath, SourcePaths.Comparer);
        var files = new List<FileSnapshot>();
        foreach (var (relative, stamp) in after)
        {
            cancellation.ThrowIfCancellationRequested();
            if (!before.TryGetValue(relative, out var first) || stamp != first)
            { files.Add(new(relative, stamp.Size, stamp.Ticks, stamp.Identity, null, false)); continue; }
            try
            {
                var dirty = forceHash || dirtyPaths?.Any(p => SourcePaths.Comparer.Equals(p, stamp.FullPath) || SourcePaths.Within(p, stamp.FullPath)) == true;
                string hash;
                if (!dirty && cached.TryGetValue(relative, out var old) && old.Hash.Length > 0 &&
                    old.Presence == Presence.Present && old.Size == stamp.Size && old.LastWriteTicks == stamp.Ticks && old.FileIdentity == stamp.Identity)
                    hash = old.Hash;
                else
                {
                    // Deny concurrent writing while hashing; allow readers and atomic replacement.
                    await using var input = new FileStream(stamp.FullPath, FileMode.Open, FileAccess.Read,
                        FileShare.Read | FileShare.Delete, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
                    hash = Convert.ToHexString(await SHA256.HashDataAsync(input, cancellation));
                    ++_hashedFiles; _hashedBytes += input.Position;
                }
                if (ReadStamp(binding.RootPath, stamp.FullPath) != stamp)
                    files.Add(new(relative, stamp.Size, stamp.Ticks, stamp.Identity, null, false));
                else files.Add(new(relative, stamp.Size, stamp.Ticks, stamp.Identity, hash));
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                warnings.Add($"Not ready: {relative}: {error.Message}");
                files.Add(new(relative, stamp.Size, stamp.Ticks, stamp.Identity, null, false));
            }
        }
        LastWork = new(1, _metadataEntries, _hashedFiles, _hashedBytes);
        return new(true, complete, files, warnings);
    }

    private Dictionary<string, Stamp> Enumerate(string root, List<string> warnings, ref bool complete)
    {
        var result = new Dictionary<string, Stamp>(SourcePaths.Comparer);
        var directories = new Stack<string>(); directories.Push(root);
        while (directories.TryPop(out var directory))
        {
            try
            {
                if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
                { warnings.Add($"Skipped linked directory: {directory}"); complete = false; continue; }
                foreach (var item in Directory.EnumerateFileSystemEntries(directory))
                {
                    try
                    {
                        var attributes = File.GetAttributes(item);
                        if ((attributes & FileAttributes.ReparsePoint) != 0)
                        { warnings.Add($"Skipped linked path: {item}"); complete = false; continue; }
                        if ((attributes & FileAttributes.Directory) != 0) { directories.Push(item); continue; }
                        if (!IsCandidate(item)) continue;
                        var stamp = ReadStamp(root, item);
                        result.Add(stamp.Relative, stamp);
                    }
                    catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                    { complete = false; warnings.Add($"Incomplete entry: {item}: {error.Message}"); }
                }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            { complete = false; warnings.Add($"Incomplete directory: {directory}: {error.Message}"); }
        }
        return result;
    }

    private Stamp ReadStamp(string root, string path)
    {
        ++_metadataEntries;
        var info = new FileInfo(path);
        return new(SourcePaths.Relative(Path.GetRelativePath(root, path)), Path.GetFullPath(path),
            info.Length, info.LastWriteTimeUtc.Ticks, FileIdentity.Read(path));
    }
}

internal static class FileIdentity
{
    // File identity is an extra rename proof, never the global logical asset identity.
    [StructLayout(LayoutKind.Sequential)] private struct FileTime { public uint Low, High; }
    [StructLayout(LayoutKind.Sequential)] private struct FileInformation
    {
        public uint Attributes;
        public FileTime CreationTime, LastAccessTime, LastWriteTime;
        public uint VolumeSerial, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation info);
    public static string? Read(string path)
    {
        if (!OperatingSystem.IsWindows()) return null;
        try
        {
            using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (!GetFileInformationByHandle(input.SafeFileHandle, out var info)) return null;
            if (info.IndexHigh == 0 && info.IndexLow == 0) return null;
            return $"{info.VolumeSerial:X8}:{info.IndexHigh:X8}{info.IndexLow:X8}";
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return null; }
    }
}
