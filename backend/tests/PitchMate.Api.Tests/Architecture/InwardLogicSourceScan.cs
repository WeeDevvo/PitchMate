using System.Text.RegularExpressions;

namespace PitchMate.Api.Tests.Architecture;

/// <summary>
/// The source-level half of the inward-logic rule: Requirement 11.6, the provisional classification
/// stays the Domain rule, so nothing in <c>PitchMate.Api</c> or <c>PitchMate.Infrastructure</c>
/// compares a σ against a threshold of its own.
/// <para>
/// <b>Validates: Requirements 11.6, 11.7</b>
/// </para>
/// <para>
/// Reflection cannot see an inline comparison, so this half is a scan of the production C# source.
/// It lives here, beside <see cref="InwardLogicRule"/>, because two tests apply it:
/// <see cref="ProvisionalClassificationSourceScanTests"/> asserts it over the production source, and
/// Property 21 (<see cref="ApiInwardLogicProperties"/>) quantifies over the same discovered file set
/// <i>and</i> over the allow-listed file as a positive control. One scanner, both callers.
/// </para>
/// <para>
/// <b>The one declared exception, and why it exists.</b> The rule the scan protects is declared in
/// <c>PitchMate.Domain</c> — the threshold is <c>RatingEngineConfig.ProvisionalThreshold</c> and the
/// contract is <c>IRatingEngine.GetState</c>, both Domain types — but per the project structure the
/// engine that <em>implements</em> that Domain contract ships in <c>PitchMate.Infrastructure</c>
/// (<c>PlackettLuceRatingEngine</c>). That single file is therefore the one legitimate home of the
/// comparison, and it is named in <see cref="SigmaComparisonAllowList"/>. Scanning it is what makes the
/// negative assertions non-vacuous: if the patterns matched nothing anywhere, they would match nothing
/// in the Api too.
/// </para>
/// </summary>
internal static class InwardLogicSourceScan
{
    /// <summary>The production projects scanned: the transport layer and the layer holding the standing source.</summary>
    public static readonly IReadOnlyList<string> ScannedProjects =
    [
        "PitchMate.Api",
        "PitchMate.Infrastructure",
    ];

    /// <summary>
    /// The explicit allow-list — the only source files permitted to compare a σ against the
    /// Domain-declared provisional threshold, because they implement the Domain-declared
    /// <c>IRatingEngine.GetState</c> contract. Paths are relative to <c>backend/</c>.
    /// </summary>
    public static readonly IReadOnlyList<string> SigmaComparisonAllowList =
    [
        Path.Combine("src", "PitchMate.Infrastructure", "Rating", "PlackettLuceRatingEngine.cs"),
    ];

    /// <summary>
    /// A σ-threshold comparison: a relational comparison with a σ-valued expression on either side.
    /// Whitespace is required on the operator's outer side so that lambda arrows (<c>=&gt;</c>),
    /// expression-bodied members, and generic argument lists are not mistaken for comparisons.
    /// </summary>
    private static readonly Regex[] SigmaComparisonPatterns =
    [
        new(@"[\w\.]*(?:[Ss]igma|σ)\s*(?:<=|>=|<|>)(?=\s)", RegexOptions.Compiled),
        new(@"(?<=\s)(?:<=|>=|<|>)\s*[\w\.]*(?:[Ss]igma|σ)\b", RegexOptions.Compiled),
    ];

    /// <summary>
    /// The Domain-declared threshold itself. Reading it outside the engine that implements the Domain
    /// contract is the first step of re-implementing the classification, so its mere appearance in the
    /// scanned projects is an offence.
    /// </summary>
    private static readonly Regex ProvisionalThresholdPattern =
        new(@"\bProvisionalThreshold\b", RegexOptions.Compiled);

    /// <summary>Returns whether the line compares a σ-valued expression against something.</summary>
    /// <param name="line">The comment-stripped source line.</param>
    /// <returns><see langword="true"/> when the line holds a σ comparison.</returns>
    public static bool HasSigmaComparison(string line)
    {
        ArgumentNullException.ThrowIfNull(line);

        return SigmaComparisonPatterns.Any(pattern => pattern.IsMatch(line));
    }

    /// <summary>Returns whether the line reads the Domain-declared provisional threshold.</summary>
    /// <param name="line">The comment-stripped source line.</param>
    /// <returns><see langword="true"/> when the line names the threshold.</returns>
    public static bool ReadsProvisionalThreshold(string line)
    {
        ArgumentNullException.ThrowIfNull(line);

        return ProvisionalThresholdPattern.IsMatch(line);
    }

    /// <summary>
    /// Applies the rule to one scanned file: a file outside the allow-list may neither compare a σ
    /// against a threshold nor read the Domain-declared threshold at all.
    /// </summary>
    /// <param name="file">The file to judge.</param>
    /// <returns>One message per offending line, each naming the file, the line number and the line.</returns>
    public static IReadOnlyList<string> Violations(ProductionSourceFile file)
    {
        ArgumentNullException.ThrowIfNull(file);

        if (file.IsSigmaComparisonAllowListed)
        {
            return [];
        }

        var violations = new List<string>();

        for (int index = 0; index < file.Lines.Count; index++)
        {
            string line = file.Lines[index];

            if (HasSigmaComparison(line))
            {
                violations.Add(
                    $"{file.RelativePath}:{index + 1} - {line.Trim()} "
                        + "(sigma-threshold comparison; the classification is IRatingEngine.GetState, "
                        + "Requirement 11.6)");
            }
            else if (ReadsProvisionalThreshold(line))
            {
                violations.Add(
                    $"{file.RelativePath}:{index + 1} - {line.Trim()} "
                        + "(reads the Domain-declared provisional threshold, Requirement 11.6)");
            }
        }

        return violations;
    }

    /// <summary>
    /// Applies the rule across a set of files, gathering every offender so the message is a worklist
    /// rather than a single first failure.
    /// </summary>
    /// <param name="files">The files to judge.</param>
    /// <returns>One message per violation across the whole set.</returns>
    public static IReadOnlyList<string> Violations(IEnumerable<ProductionSourceFile> files)
    {
        ArgumentNullException.ThrowIfNull(files);

        return [.. files.SelectMany(Violations)];
    }

    /// <summary>
    /// Returns whether the file holds the σ-threshold comparison the Domain rule declares — a σ
    /// compared against the Domain-declared threshold on one line. Used as the positive control.
    /// </summary>
    /// <param name="file">The file to inspect.</param>
    /// <returns><see langword="true"/> when the Domain-declared comparison is present.</returns>
    public static bool HasDomainDeclaredClassification(ProductionSourceFile file)
    {
        ArgumentNullException.ThrowIfNull(file);

        return file.Lines.Any(line => HasSigmaComparison(line) && ReadsProvisionalThreshold(line));
    }

    /// <summary>
    /// Every production C# source file of the scanned projects, comments already stripped, each
    /// flagged with whether it is allow-listed. Generated output (<c>bin</c>/<c>obj</c>) is excluded so
    /// only authored source is scanned.
    /// </summary>
    /// <returns>The discovered files, ordered by relative path so failures read deterministically.</returns>
    /// <exception cref="DirectoryNotFoundException">A scanned project directory is missing.</exception>
    public static IReadOnlyList<ProductionSourceFile> DiscoverProductionSource()
    {
        string backendRoot = FindBackendRoot();
        var allowed = SigmaComparisonAllowList
            .Select(path => Path.Combine(backendRoot, path))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var files = new List<ProductionSourceFile>();

        foreach (string project in ScannedProjects)
        {
            string projectDir = Path.Combine(backendRoot, "src", project);

            if (!Directory.Exists(projectDir))
            {
                throw new DirectoryNotFoundException(
                    $"Production project directory not found: {projectDir}");
            }

            foreach (string file in Directory
                .EnumerateFiles(projectDir, "*.cs", SearchOption.AllDirectories)
                .Where(static path => !IsUnderGeneratedOutput(path)))
            {
                files.Add(new ProductionSourceFile(
                    Project: project,
                    RelativePath: Path.GetRelativePath(backendRoot, file),
                    AbsolutePath: file,
                    IsSigmaComparisonAllowListed: allowed.Contains(file),
                    Lines: StripCommentsPreservingLines(File.ReadAllText(file))));
            }
        }

        return [.. files.OrderBy(static file => file.RelativePath, StringComparer.Ordinal)];
    }

    /// <summary>
    /// Reads one allow-listed file by its <c>backend/</c>-relative path, for the positive control.
    /// </summary>
    /// <param name="relativePath">The path relative to <c>backend/</c>.</param>
    /// <returns>The file, with its comments stripped.</returns>
    /// <exception cref="FileNotFoundException">The file is missing.</exception>
    public static ProductionSourceFile ReadAllowListedFile(string relativePath)
    {
        ArgumentNullException.ThrowIfNull(relativePath);

        string backendRoot = FindBackendRoot();
        string path = Path.Combine(backendRoot, relativePath);

        if (!File.Exists(path))
        {
            throw new FileNotFoundException($"Allow-listed source file not found: {path}", path);
        }

        return new ProductionSourceFile(
            Project: ScannedProjects.FirstOrDefault(
                project => relativePath.Contains(project, StringComparison.Ordinal)) ?? "(unknown)",
            RelativePath: relativePath,
            AbsolutePath: path,
            IsSigmaComparisonAllowListed: true,
            Lines: StripCommentsPreservingLines(File.ReadAllText(path)));
    }

    /// <summary>
    /// Removes block comments and line/XML-doc comments while preserving line numbering, so the
    /// documentary "compares no σ against any threshold" notes in the production source are not
    /// flagged and offenders can still be reported by line.
    /// </summary>
    /// <param name="source">The source text.</param>
    /// <returns>The comment-stripped lines.</returns>
    public static string[] StripCommentsPreservingLines(string source)
    {
        ArgumentNullException.ThrowIfNull(source);

        string withoutBlocks = Regex.Replace(
            source,
            @"/\*.*?\*/",
            static match => new string('\n', match.Value.Count(static c => c == '\n')),
            RegexOptions.Singleline);

        return [.. withoutBlocks
            .Replace("\r", string.Empty, StringComparison.Ordinal)
            .Split('\n')
            .Select(static line => Regex.Replace(line, @"//.*$", " "))];
    }

    /// <summary>
    /// Walks up from the test assembly location to the <c>backend</c> directory, identified by the
    /// solution file. Throws rather than returning silently if it cannot be found, so a relocated test
    /// layout surfaces immediately instead of skipping the scan.
    /// </summary>
    /// <returns>The absolute path of <c>backend/</c>.</returns>
    /// <exception cref="DirectoryNotFoundException">The backend root could not be located.</exception>
    public static string FindBackendRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);

        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "PitchMate.slnx")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new DirectoryNotFoundException(
            "Could not locate the backend root (the directory containing PitchMate.slnx) from "
                + AppContext.BaseDirectory);
    }

    /// <summary>Returns true when the path lives under a <c>bin</c> or <c>obj</c> output directory.</summary>
    private static bool IsUnderGeneratedOutput(string path)
    {
        string[] segments = path.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

        return segments.Any(static segment =>
            string.Equals(segment, "bin", StringComparison.OrdinalIgnoreCase)
            || string.Equals(segment, "obj", StringComparison.OrdinalIgnoreCase));
    }
}

/// <summary>
/// One production C# source file as the scan sees it: its project, its <c>backend/</c>-relative path
/// (what offender messages name), its absolute path, whether it is allow-listed, and its
/// comment-stripped lines with original line numbering preserved.
/// </summary>
/// <param name="Project">The scanned project the file belongs to.</param>
/// <param name="RelativePath">The path relative to <c>backend/</c>.</param>
/// <param name="AbsolutePath">The absolute path on disk.</param>
/// <param name="IsSigmaComparisonAllowListed">Whether the file may hold the Domain-declared comparison.</param>
/// <param name="Lines">The comment-stripped source lines.</param>
internal sealed record ProductionSourceFile(
    string Project,
    string RelativePath,
    string AbsolutePath,
    bool IsSigmaComparisonAllowListed,
    IReadOnlyList<string> Lines);
