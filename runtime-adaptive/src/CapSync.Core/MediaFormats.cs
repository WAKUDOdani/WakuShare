namespace CapSync.Core;

// Import candidates proven with actual files in CapCut 9.6.0.4097. A suffix
// does not prove an individual file's codec or integrity; native preflight does.
public static class MediaFormats
{
    private static readonly Dictionary<string, string> Kinds = new(StringComparer.OrdinalIgnoreCase)
    {
        [".png"]="photo", [".jpg"]="photo", [".jpeg"]="photo", [".bmp"]="photo",
        [".webp"]="photo", [".tif"]="photo", [".tiff"]="photo", [".ico"]="photo", [".avif"]="photo",
        [".gif"]="gif", [".wav"]="music", [".mp3"]="music", [".m4a"]="music", [".aac"]="music",
        [".flac"]="music", [".ogg"]="music", [".opus"]="music", [".wma"]="music",
        [".mp4"]="video", [".mov"]="video", [".m4v"]="video", [".mkv"]="video", [".avi"]="video",
        [".webm"]="video", [".mpg"]="video", [".mpeg"]="video", [".ts"]="video", [".mts"]="video",
        [".wmv"]="video", [".flv"]="video"
    };
    public static bool IsCandidate(string path) => Kinds.ContainsKey(Path.GetExtension(path));
    public static string? Kind(string path) => Kinds.GetValueOrDefault(Path.GetExtension(path));
}
