using System.Text.Json;
using CapSync.Core;

// Transitional headless entry point for the new engine. It plans and persists
// its private state only; there is deliberately no native adapter in this path.
internal static class EventObserver
{
    public static async Task<int> Run(string statePath, bool once)
    {
        statePath = Path.GetFullPath(statePath);
        using var lease = new FileStream(statePath + ".observer.lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        var store = new StateStore(statePath); var state = store.Load();
        if (state.Bindings.Count == 0) throw new InvalidOperationException("Configure explicit bindings before event-observe.");
        if (state.Bindings.Any(b => SourcePaths.Within(b.RootPath, statePath)))
            throw new InvalidDataException("Keep observer state outside source roots.");
        using var stopping = new CancellationTokenSource();
        ConsoleCancelEventHandler cancel = (_, args) => { args.Cancel = true; stopping.Cancel(); };
        Console.CancelKeyPress += cancel;
        using var stopWatch = new FileSystemWatcher(Path.GetDirectoryName(statePath)!, Path.GetFileName(statePath) + ".stop")
        { NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.CreationTime };
        void Stop(object? sender, FileSystemEventArgs args) => stopping.Cancel();
        stopWatch.Created += Stop; stopWatch.Changed += Stop;
        stopWatch.Renamed += Stop; stopWatch.Error += (_, _) => stopping.Cancel();
        stopWatch.EnableRaisingEvents = true;
        using var engine = new EventPlanningEngine(state);
        try
        {
            if (File.Exists(statePath + ".stop")) return 0;
            engine.Configure();
            while (!stopping.IsCancellationRequested)
            {
                var result = await engine.NextAsync(stopping.Token);
                store.Save(state);
                Console.WriteLine(JsonSerializer.Serialize(new {
                    mode = "event-observe-only", result.Sequence, result.Work, result.Watches,
                    sources = state.Sources.Count, pending = state.Pending.Count,
                    transfers = result.Transfers.Count, result.EditorBlocked, result.BlockedProjects,
                    result.Readiness,
                    editorCommands = 0, recurringScanTimers = 0
                }, new JsonSerializerOptions(StateStore.JsonOptions) { WriteIndented = false }));
                if (once) break;
            }
        }
        catch (OperationCanceledException) when (stopping.IsCancellationRequested) { }
        finally { Console.CancelKeyPress -= cancel; }
        return 0;
    }
}
