using System.Reflection;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using PitchMate.Infrastructure;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// Structural smoke tests for the migration-execution policy (task 7.4). These assertions need
/// no database: they inspect the production source of the startup path and the compiled
/// Infrastructure migrations assembly.
/// <list type="bullet">
/// <item>No <c>Migrate()</c>/<c>MigrateAsync()</c>/<c>EnsureCreated()</c>/<c>EnsureCreatedAsync()</c>
/// call exists on the production startup path (<see cref="DependencyInjection.AddInfrastructure"/>
/// in <c>PitchMate.Infrastructure</c> and the <c>PitchMate.Api</c> startup) — Req 12.1, 12.2. The
/// test-only <see cref="PostgreSqlContainerFixture"/> legitimately uses <c>EnsureCreatedAsync</c>,
/// so only the production projects are scanned.</item>
/// <item>The initial schema baseline migration exists in the <see cref="PitchMateDbContext"/>
/// migrations assembly and is the <em>earliest</em> migration, with no predecessor — Req 11.1.
/// Later feature specs add further migrations after the baseline, so these tests assert the
/// baseline is present and first rather than that it is the only migration.</item>
/// </list>
/// <para>Validates: Requirements 11.1, 12.1, 12.2.</para>
/// </summary>
public sealed class MigrationPolicySmokeTests
{
    /// <summary>The expected initial schema baseline migration id (the earliest migration, no predecessor).</summary>
    private const string InitialMigrationId = "20260625201240_InitialCreate";

    /// <summary>
    /// The forbidden EF Core schema-mutating calls that must never appear on the production startup
    /// path: applying migrations or creating the schema from the model bypasses the explicit,
    /// out-of-process migration runner (Req 12.1) and would migrate on startup (Req 12.2).
    /// </summary>
    private static readonly string[] ForbiddenCalls =
    [
        "Migrate",
        "MigrateAsync",
        "EnsureCreated",
        "EnsureCreatedAsync",
    ];

    // Requirement 12.1, 12.2 — the production startup path applies no migrations and creates no schema.
    /// <summary>
    /// Scans every C# source file of the two production projects on the startup path
    /// (<c>PitchMate.Infrastructure</c> and <c>PitchMate.Api</c>), with comments stripped so that the
    /// documentary "No Migrate()/EnsureCreated() runs here" notes are not mistaken for calls, and
    /// asserts none of them invoke a schema-mutating EF Core operation.
    /// </summary>
    [Fact]
    public void ProductionStartupPathContainsNoMigrateOrEnsureCreatedCall()
    {
        var backendRoot = FindBackendRoot();

        string[] productionProjects =
        [
            Path.Combine(backendRoot, "src", "PitchMate.Infrastructure"),
            Path.Combine(backendRoot, "src", "PitchMate.Api"),
        ];

        var violations = new List<string>();

        foreach (var projectDir in productionProjects)
        {
            Assert.True(Directory.Exists(projectDir), $"Production project directory not found: {projectDir}");

            foreach (var file in EnumerateProductionSourceFiles(projectDir))
            {
                var code = StripCommentsAndDocComments(File.ReadAllText(file));

                foreach (var call in ForbiddenCalls)
                {
                    // Match an actual invocation: the method name immediately followed by '(' (optional
                    // whitespace). A leading word boundary avoids matching longer identifiers that merely
                    // end with the name. The async/sync variants are listed explicitly in ForbiddenCalls.
                    var pattern = $@"\b{Regex.Escape(call)}\s*\(";
                    if (Regex.IsMatch(code, pattern))
                    {
                        violations.Add($"{call} invoked in {file}");
                    }
                }
            }
        }

        Assert.True(
            violations.Count == 0,
            "The production startup path must not apply migrations or create the schema "
                + "(migrations run only through the out-of-process runner — Req 12.1, 12.2). Violations: "
                + Environment.NewLine
                + string.Join(Environment.NewLine, violations));
    }

    // Requirement 11.1 — the initial baseline migration exists in the DbContext's migrations assembly
    // and is the earliest one (no predecessor). Later specs add further migrations after it.
    /// <summary>
    /// Resolves the EF Core migrations assembly for <see cref="PitchMateDbContext"/> (constructed via
    /// the design-time factory, which opens no database connection) and asserts the initial baseline
    /// migration is present and is the earliest migration in id order — so nothing precedes it.
    /// </summary>
    [Fact]
    public void MigrationsAssemblyContainsInitialBaselineMigrationAsEarliest()
    {
        using var context = new PitchMateDbContextFactory().CreateDbContext([]);

        var migrationsAssembly = context.GetService<IMigrationsAssembly>();
        var migrationIds = migrationsAssembly.Migrations.Keys.ToList();

        Assert.Contains(InitialMigrationId, migrationIds);
        Assert.Equal(
            InitialMigrationId,
            migrationIds.OrderBy(id => id, StringComparer.Ordinal).First());
    }

    // Requirement 11.1 — cross-check via the [Migration] attribute that the initial baseline migration
    // type ships and is the earliest declared migration (no predecessor).
    /// <summary>
    /// Independently of EF's migrations-assembly view, reflects over the Infrastructure assembly for
    /// concrete <see cref="Migration"/> types carrying the <see cref="MigrationAttribute"/> and asserts
    /// the initial baseline is among them and is the earliest by id — so no preceding migration exists.
    /// </summary>
    [Fact]
    public void InfrastructureAssemblyDeclaresInitialBaselineMigrationTypeAsEarliest()
    {
        var infrastructureAssembly = typeof(PitchMateDbContext).Assembly;

        var migrationIds = infrastructureAssembly.GetTypes()
            .Where(t => typeof(Migration).IsAssignableFrom(t)
                && !t.IsAbstract
                && t.GetCustomAttribute<MigrationAttribute>() is not null)
            .Select(t => t.GetCustomAttribute<MigrationAttribute>()!.Id)
            .ToList();

        Assert.Contains(InitialMigrationId, migrationIds);
        Assert.Equal(
            InitialMigrationId,
            migrationIds.OrderBy(id => id, StringComparer.Ordinal).First());
    }

    /// <summary>
    /// Enumerates the buildable C# source of a production project, excluding generated output
    /// (<c>bin</c>/<c>obj</c>) so only real source on the startup path is scanned.
    /// </summary>
    private static IEnumerable<string> EnumerateProductionSourceFiles(string projectDir) =>
        Directory.EnumerateFiles(projectDir, "*.cs", SearchOption.AllDirectories)
            .Where(path => !IsUnderGeneratedOutput(path));

    /// <summary>Returns true when the path lives under a <c>bin</c> or <c>obj</c> output directory.</summary>
    private static bool IsUnderGeneratedOutput(string path)
    {
        var segments = path.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return segments.Any(s =>
            string.Equals(s, "bin", StringComparison.OrdinalIgnoreCase)
            || string.Equals(s, "obj", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Removes block comments (<c>/* ... */</c>) and line/XML-doc comments (<c>// ...</c>, <c>/// ...</c>)
    /// so that documentary references to the forbidden calls are not flagged as invocations.
    /// </summary>
    private static string StripCommentsAndDocComments(string source)
    {
        // Block comments first (non-greedy, across newlines), then single-line comments.
        var withoutBlocks = Regex.Replace(source, @"/\*.*?\*/", " ", RegexOptions.Singleline);
        return Regex.Replace(withoutBlocks, @"//[^\n]*", " ");
    }

    /// <summary>
    /// Walks up from the test assembly location to the <c>backend</c> directory, identified by the
    /// solution file (<c>PitchMate.slnx</c>). Fails rather than passing silently if it cannot be found,
    /// so a relocated test layout surfaces immediately instead of skipping the policy check.
    /// </summary>
    private static string FindBackendRoot()
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
}
