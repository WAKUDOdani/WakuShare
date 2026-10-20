using System.Text.Json;
using CapSync.Core;

// JSON is a process protocol; it must not depend on the current Windows code page.
Console.OutputEncoding=System.Text.Encoding.UTF8;
try { return await Run(args); }
catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException or
    InvalidOperationException or ArgumentException or JsonException)
{ Console.Error.WriteLine(error.Message); return 1; }

static async Task<int> Run(string[] args)
{
    if (args.Length == 0 || args[0] is "help" or "--help")
    {
        Console.WriteLine("""
        CapSync.Observer — наблюдатель; sync-lab включает лабораторное автодобавление.
        catalog --project <каталог проекта>
        bind --project <каталог проекта> --folder-id <ID папки медиатеки> --root <папка источников> [--state <файл>]
        scan [--state <файл>]
        watch [--state <файл>]
        event-observe --state <частный файл> [--once true]
        event-worker --state <частный файл> [--editor-pid <PID>]
        sync-lab --project <каталог тестового проекта> --bridge-root <каталог CapSync> [--state <файл>] [--updates-only true] [--recover-only true] [--delete-unused true] [--restore-removed true] [--move-files true] [--photo-paths true] [--refresh-jpeg true] [--refresh-png true]
        status [--state <файл>]
        folder-view --bridge-root <каталог CapSync>
        sync-lab: --cross-binding true разрешает межкорневой PNG/JPEG-перенос с --photo-paths true; --once true выполняет один проход, --folder-view false пропускает настройку списка.
        watch только планирует. sync-lab добавляет PNG/JPEG/GIF, WAV/MP3, MP4/MOV из AutoAddLab в лабораторном проекте.
        event-observe: новое событийное ядро без периодического опроса; только планирование, без команд редактору.
        event-worker: JSON Lines protocol v1 по stdin/stdout, стартует на паузе; только планирование.
        """); return 0;
    }
    var command = args[0];
    var options = new Dictionary<string,string>(StringComparer.Ordinal);
    for (var i = 1; i < args.Length; i += 2)
    {
        if (!args[i].StartsWith("--",StringComparison.Ordinal) || i + 1 >= args.Length || !options.TryAdd(args[i],args[i+1]))
            throw new ArgumentException("Use unique --option value pairs.");
    }
    string Required(string key) => options.TryGetValue(key,out var value) ? value : throw new ArgumentException($"Required: {key}");
    void Print(object value) => Console.WriteLine(JsonSerializer.Serialize(value,StateStore.JsonOptions));
    if(command=="folder-view") {Print(await PythonAddAdapter.EnsureFolderViewAsync(Path.GetFullPath(Required("--bridge-root"))));return 0;}
    var statePath = options.GetValueOrDefault("--state") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CapSync","state.json");
    if (command == "catalog") { Print(CapCutCatalog.Read(Required("--project"))); return 0; }
    if (command == "event-worker")
    {
        if (options.Keys.Any(key => key is not ("--state" or "--editor-pid" or "--native-root" or "--native-mode"))) throw new ArgumentException("Unsupported event-worker option.");
        int? editorPid = null;
        if (options.TryGetValue("--editor-pid", out var text)) {
            if (!int.TryParse(text, out var parsedPid) || parsedPid <= 0) throw new ArgumentException("--editor-pid must be positive.");
            editorPid = parsedPid;
        }
        var nativeRoot = options.GetValueOrDefault("--native-root");
        var nativeMode = options.GetValueOrDefault("--native-mode") ?? "laboratory";
        if (nativeMode is not ("laboratory" or "product") || (nativeMode == "product" && nativeRoot == null)) throw new ArgumentException("Invalid native mode.");
        if (nativeRoot != null) { nativeRoot = Path.GetFullPath(nativeRoot); editorPid ??= ExplorerNativeAdapter.FindEditor(); }
        return await EventWorker.Run(Required("--state"), editorPid, nativeRoot, nativeMode == "product");
    }
    var store = new StateStore(statePath);
    var state = store.Load();
    if (command == "bind")
    {
        var catalog = CapCutCatalog.Read(Required("--project"));
        var root = Path.GetFullPath(Required("--root"));
        var folderId = Required("--folder-id");
        var imports = catalog.AdoptedImports(folderId,root,out var warnings);
        // An ambiguous adoption is never converted silently into a new-material operation.
        if (warnings.Any(w=>!w.StartsWith("This physical path",StringComparison.Ordinal) &&
            !w.StartsWith("Source outside the selected root excluded:",StringComparison.Ordinal)))
            throw new InvalidDataException(string.Join(Environment.NewLine,warnings));
        var binding = new Binding { ProjectId=catalog.ProjectId,MediaFolderId=folderId,RootPath=root,InitialImports=imports };
        SourcePaths.AddBinding(state,binding); store.Save(state);
        Print(new { mode="observe-only",binding,adoptedImports=imports.Count,warnings }); return 0;
    }
    if (command == "status") { Print(new { mode="observe-only",state }); return 0; }
    if (command == "event-observe")
    {
        if (!options.ContainsKey("--state")) throw new ArgumentException("event-observe requires an explicit private --state path.");
        var eventOnce = options.GetValueOrDefault("--once") switch { null or "false" => false, "true" => true,
            _ => throw new ArgumentException("--once must be true or false.") };
        return await EventObserver.Run(statePath, eventOnce);
    }
    if (command is not ("scan" or "watch" or "sync-lab")) throw new ArgumentException("Unknown command.");
    if (state.Bindings.Count == 0) throw new InvalidOperationException("No bindings. Run bind after selecting a real media folder.");
    if (state.Bindings.Any(b=>SourcePaths.Within(b.RootPath,statePath)))
        throw new InvalidDataException("Keep the observer state outside watched source roots.");
    using var stopping = new CancellationTokenSource();
    Console.CancelKeyPress += (_, e) => { e.Cancel=true; stopping.Cancel(); };
    using var signals = new FolderSignals();
    AddExecutor? executor=null;
    UpdateExecutor? updates=null;
    PresenceTracker? presence=null;
    DeleteExecutor? deletes=null;
    RestoreExecutor? restores=null;
    TransferExecutor? transfers=null;
    var once=options.GetValueOrDefault("--once") switch {null or "false"=>false,"true"=>true,_=>throw new ArgumentException("--once must be true or false.")};
    var recoverOnly=options.GetValueOrDefault("--recover-only") switch {
        null or "false"=>false,"true"=>true,_=>throw new ArgumentException("--recover-only must be true or false.")
    };
    if(recoverOnly && command!="sync-lab")throw new ArgumentException("--recover-only requires sync-lab.");
    if (command=="sync-lab")
    {
        const string labId="582F1BF9-2B25-4cf2-B83F-3528F1B868B2";
        var workspace=Path.GetFullPath(Required("--bridge-root"));
        var project=Path.GetFullPath(Required("--project"));
        var catalog=CapCutCatalog.Read(project);
        var root=Path.Combine(workspace,"research","fixtures","AutoAddLab");
        var crossBinding=options.GetValueOrDefault("--cross-binding") switch {null or "false"=>false,"true"=>true,_=>throw new ArgumentException("--cross-binding must be true or false.")};
        if (catalog.ProjectId!=labId || catalog.Name!="CapSync-Lab-20261013-001" ||
            state.Bindings.Any(b=>b.ProjectId!=labId || (crossBinding?!SourcePaths.Within(root,b.RootPath):!SourcePaths.Comparer.Equals(b.RootPath,root))))
            throw new InvalidDataException("sync-lab is restricted to AutoAddLab and the isolated lab project.");
        var journal=Path.Combine(Path.GetDirectoryName(Path.GetFullPath(statePath))!,"add-journal");
        var formats=new HashSet<string>(StringComparer.OrdinalIgnoreCase){".png",".jpg",".jpeg",".gif",".wav",".mp3",".mp4",".mov"};
        var refreshJpeg=options.GetValueOrDefault("--refresh-jpeg") switch {
            null or "false"=>false,"true"=>true,_=>throw new ArgumentException("--refresh-jpeg must be true or false.")
        };
        var refreshPng=options.GetValueOrDefault("--refresh-png") switch {
            null or "false"=>false,"true"=>true,_=>throw new ArgumentException("--refresh-png must be true or false.")
        };
        var photoPaths=options.GetValueOrDefault("--photo-paths") switch {
            null or "false"=>false,"true"=>true,_=>throw new ArgumentException("--photo-paths must be true or false.")
        };
        if(photoPaths)
        {
            using var proof=JsonDocument.Parse(File.ReadAllBytes(Path.Combine(workspace,"artifacts","GeneralPhotoPathLab","journal.json")));
            if(proof.RootElement.GetProperty("stage").GetString()!="generalPhotoPathsAccepted" ||
               !proof.RootElement.GetProperty("accepted").GetBoolean())throw new InvalidOperationException("General photo paths are not accepted.");
        }
        if(crossBinding && !photoPaths)throw new ArgumentException("--cross-binding requires --photo-paths true.");
        var adapter=new PythonAddAdapter(workspace,journal,refreshJpeg,refreshPng,recoverOnly,photoPaths,crossBinding);
        if(crossBinding)transfers=new(adapter,project);
        var folderView=options.GetValueOrDefault("--folder-view") switch {
            null or "true"=>true,"false"=>false,_=>throw new ArgumentException("--folder-view must be true or false.")
        };
        // Receipt recovery must remain read-only, including UI observer setup.
        if(!recoverOnly && folderView)await PythonAddAdapter.EnsureFolderViewAsync(workspace);
        var updatesOnly=options.GetValueOrDefault("--updates-only") switch {
            null or "false" => false,
            "true" => true,
            _ => throw new ArgumentException("--updates-only must be true or false.")
        };
        if (!updatesOnly || recoverOnly)
            executor=new(adapter,project,(_,p)=>
                !formats.Contains(Path.GetExtension(p.RelativePath)) ? "WaitingForFormatAdapter" : null);
        var moveFiles=options.GetValueOrDefault("--move-files") switch {
            null or "false"=>false,"true"=>true,_=>throw new ArgumentException("--move-files must be true or false.")
        };
        updates=moveFiles||photoPaths?new(adapter,project,adapter,(_,p)=>
            photoPaths && new[]{".png",".jpg",".jpeg"}.Contains(Path.GetExtension(p.RelativePath),StringComparer.OrdinalIgnoreCase) ||
            moveFiles && (p.MaterialId=="92AA99ED-8EF3-45E7-8EEC-AD9EB27C6A53" &&
            p.PreviousPath=="metadata-path-control-root-jpeg-synced.jpg" &&
            p.RelativePath=="ReleaseCheck/Shared/metadata-path-control-root-jpeg-synced.jpg" ||
            p.MaterialId=="4195482C-1347-423E-8A4A-34771C25E21E" &&
            p.PreviousPath=="ReleaseCheck/metadata-path-control-still-png-renamed.png" &&
            p.RelativePath=="NestedAlpha/Shared/metadata-path-control-still-png-renamed.png")?null:"WaitingForFileMoveAdapter"):
            new(adapter,project);
        presence=new(adapter,project);
        var deleteUnused=options.GetValueOrDefault("--delete-unused") switch {
            null or "false"=>false,"true"=>true,_=>throw new ArgumentException("--delete-unused must be true or false.")
        };
        if(deleteUnused)deletes=new(adapter,project,(_,p)=>p.MaterialId=="feda0376-f183-40ba-8a95-246a4e783749" &&
            p.RelativePath=="release-probe.wav"?null:"WaitingForDeleteAdapter");
        var restoreRemoved=options.GetValueOrDefault("--restore-removed") switch {
            null or "false"=>false,"true"=>true,_=>throw new ArgumentException("--restore-removed must be true or false.")
        };
        if(restoreRemoved)restores=new(adapter,project,(_,p)=>p.MaterialId=="feda0376-f183-40ba-8a95-246a4e783749" &&
            p.RelativePath=="release-probe.wav"?null:"WaitingForRestoreAdapter");
    }
    using var executionLock=executor==null && updates==null ? null : new FileStream(Path.GetFullPath(statePath)+".executor.lock",
        FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
    var scanner = new InventoryScanner();
    var forceHash = true;
    string[] dirty = [];
    var fullHashAt = DateTimeOffset.MinValue;
    var lastSummary = "";
    try
    {
        do
        {
            if ((executor!=null || updates!=null) && File.Exists(Path.GetFullPath(statePath)+".stop")) break;
            signals.Refresh(state.Bindings);
            var now = DateTimeOffset.UtcNow;
            forceHash |= now - fullHashAt >= TimeSpan.FromMinutes(15);
            var warnings = new List<string>();
            var inventories = new Dictionary<Guid,Inventory>();
            foreach (var binding in state.Bindings)
            {
                var inventory = await scanner.ScanAsync(binding,state.Sources,forceHash,dirty,stopping.Token);
                warnings.AddRange(inventory.Warnings);
                inventories.Add(binding.Id,inventory);
            }
            var crossBindingMoves=ProjectReconciler.Apply(state,inventories,now);
            var projectBlocked=ProjectReconciler.BlocksEditor(state);
            if (forceHash) fullHashAt=now;
            store.Save(state);
            if(recoverOnly)
            {
                // Read completed receipts only, then stop. Do not let pending
                // new files enter an adapter while recovering prior ownership.
                if(transfers!=null)await transfers.RunAsync(state,[],()=>store.Save(state),stopping.Token,true);
                if(updates!=null && !TransferExecutor.HasUnresolved(state))await updates.RunAsync(state,()=>store.Save(state),stopping.Token,true);
                if(executor!=null && !TransferExecutor.HasUnresolved(state) && !UpdateExecutor.HasUnresolved(state) && !RestoreExecutor.HasUnresolved(state) && !DeleteExecutor.HasUnresolved(state))
                    await executor.RunAsync(state,()=>store.Save(state),stopping.Token,true);
                store.Save(state);
                Print(new {mode="receipt-recovery-only",transfers=state.TransferAttempts.Select(a=>new{a.Job.Id,a.Status,a.Reason}),updates=state.UpdateAttempts.Select(a=>new{a.Job.Id,a.Status,a.Reason}),
                    imports=state.AddAttempts.Select(a=>new{a.Job.Id,a.Status,a.Reason}),newEditorCommands=0});
                break;
            }
            if(transfers!=null)await transfers.RunAsync(state,crossBindingMoves,()=>store.Save(state),stopping.Token);
            projectBlocked|=TransferExecutor.HasUnresolved(state);
            // Observations cannot change the editor or resolve an uncertain
            // update. Keep them out of the native mutation attempt queue.
            if(!projectBlocked && presence!=null)await presence.RunAsync(state,()=>store.Save(state),stopping.Token);
            if(!projectBlocked && restores!=null && !UpdateExecutor.HasUnresolved(state) && !DeleteExecutor.HasUnresolved(state) && !state.AddAttempts.Any(a=>a.Status is not ("Completed" or "Abandoned")))
                await restores.RunAsync(state,()=>store.Save(state),stopping.Token);
            if(!projectBlocked && deletes!=null && !RestoreExecutor.HasUnresolved(state) && !UpdateExecutor.HasUnresolved(state) && !state.AddAttempts.Any(a=>a.Status is not ("Completed" or "Abandoned")))
                await deletes.RunAsync(state,()=>store.Save(state),stopping.Token);
            if (!projectBlocked && updates!=null && !RestoreExecutor.HasUnresolved(state) && !DeleteExecutor.HasUnresolved(state) && !state.AddAttempts.Any(a=>a.Status is not ("Completed" or "Abandoned")))
                await updates.RunAsync(state,()=>store.Save(state),stopping.Token);
            if (!projectBlocked && executor!=null && !RestoreExecutor.HasUnresolved(state) && !UpdateExecutor.HasUnresolved(state) && !DeleteExecutor.HasUnresolved(state)) await executor.RunAsync(state,()=>store.Save(state),stopping.Token);
            var summary = JsonSerializer.Serialize(new {
                mode=executor!=null ? "live-add-lab" : updates!=null ? "live-update-lab" : "observe-only",bindings=state.Bindings.Select(b=>new { b.Id,b.Status }),
                sources=state.Sources.Count,pending=state.Pending.Select(p=>new { p.Id,p.Flags,p.RelativePath,p.Status,p.Reason }),
                attempts=state.AddAttempts.Select(a=>new { a.Job.Id,a.Status,a.MaterialId,a.Reason }),
                folders=state.ManagedFolders.Select(f=>new { f.Job.RelativePath,f.Job.FolderId,f.Status,f.Reason }),warnings,crossBindingMoves
                ,updates=state.UpdateAttempts.Select(a=>new{a.Job.Id,a.Job.RelativePath,a.Status,a.Reason})
                ,deletions=state.DeleteAttempts.Select(a=>new{a.Job.Id,a.Job.RelativePath,a.Status,a.Reason})
                ,restorations=state.RestoreAttempts.Select(a=>new{a.Job.Import.Id,a.Status,a.MaterialId,a.Reason})
                ,transfers=state.TransferAttempts.Select(a=>new{a.Job.Id,a.Status,a.Reason})
            },StateStore.JsonOptions);
            if (summary!=lastSummary) { Console.WriteLine(summary); lastSummary=summary; }
            if (command == "scan" || once) break;
            (forceHash,dirty) = await signals.WaitAsync(TimeSpan.FromSeconds(5),stopping.Token);
        } while (!stopping.IsCancellationRequested);
    }
    catch (OperationCanceledException) when (stopping.IsCancellationRequested) { }
    return 0;
}
