using System.Reflection;
using NetArchTest.Rules;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Common;
using PitchMate.Infrastructure;

namespace PitchMate.Infrastructure.Tests.Architecture;

/// <summary>
/// Architecture dependency tests (Requirement 13) that enforce the Clean Architecture
/// inward-only dependency rule on every <c>dotnet test</c> run (Req 13.8), so the layering
/// cannot regress unnoticed in CI.
///
/// What is enforced:
/// <list type="bullet">
///   <item><description>13.1 — Domain references none of Application/Infrastructure/Api.</description></item>
///   <item><description>13.2 — Application references Domain and neither Infrastructure nor Api.</description></item>
///   <item><description>13.3 — Infrastructure does not reference Api.</description></item>
///   <item><description>13.4 — Domain depends on no EF Core / Npgsql / ASP.NET Core types.</description></item>
///   <item><description>13.5 — Application depends on no EF Core / Npgsql / ASP.NET Core types.</description></item>
///   <item><description>13.6 — a violated rule fails the run with a message naming the rule and its offenders.</description></item>
///   <item><description>13.7 — an asserted assembly that cannot be loaded fails rather than passes silently.</description></item>
/// </list>
///
/// Each rule is checked two ways so neither a stray (unused) project/package reference nor an
/// actual type-level dependency can slip through:
/// <list type="bullet">
///   <item><description>Referenced-assembly metadata via <see cref="Assembly.GetReferencedAssemblies"/> —
///   catches a project/package reference even if no type from it is used yet.</description></item>
///   <item><description>Type-level IL dependencies via <c>NetArchTest.Rules</c> — catches an actual
///   namespace dependency.</description></item>
/// </list>
/// ASP.NET Core lives in the shared framework rather than as a NuGet package reference, so its
/// absence is enforced by the type-level namespace check rather than a referenced-assembly check.
/// </summary>
public class ArchitectureDependencyTests
{
    private const string DomainName = "PitchMate.Domain";
    private const string ApplicationName = "PitchMate.Application";
    private const string InfrastructureName = "PitchMate.Infrastructure";
    private const string ApiName = "PitchMate.Api";

    // Anchor types create a hard compile-time and runtime link to each asserted assembly, so a
    // build with a renamed/missing assembly fails to compile and a runtime load failure surfaces
    // in CanLoadAllAssertedAssemblies (Req 13.7) rather than passing silently.
    private static readonly Assembly DomainAssembly = typeof(BaseEntity).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(IRepository<>).Assembly;
    private static readonly Assembly InfrastructureAssembly = typeof(DependencyInjection).Assembly;

    /// <summary>Namespaces representing EF Core, Npgsql, and ASP.NET Core — forbidden in Domain and Application.</summary>
    private static readonly string[] EfNpgsqlAspNetNamespaces =
    {
        "Microsoft.EntityFrameworkCore",
        "Npgsql",
        "Microsoft.AspNetCore",
    };

    /// <summary>EF Core / Npgsql package assemblies — forbidden as referenced assemblies in Domain and Application.</summary>
    private static readonly string[] EfNpgsqlAspNetAssemblies =
    {
        "Microsoft.EntityFrameworkCore",
        "Microsoft.EntityFrameworkCore.Abstractions",
        "Microsoft.EntityFrameworkCore.Relational",
        "Npgsql",
        "Npgsql.EntityFrameworkCore.PostgreSQL",
        "EFCore.NamingConventions",
    };

    [Fact]
    public void CanLoadAllAssertedAssemblies()
    {
        // Req 13.7 — explicitly load each asserted assembly by name and fail (not pass) if one
        // cannot be loaded. GetTypes() forces full type loading so a partially-loadable assembly
        // surfaces here instead of producing a misleadingly green rule check.
        var failures = new List<string>();

        foreach (var assemblyName in new[] { DomainName, ApplicationName, InfrastructureName })
        {
            try
            {
                var assembly = Assembly.Load(new AssemblyName(assemblyName));
                _ = assembly.GetTypes();
            }
            catch (Exception ex)
            {
                failures.Add($"{assemblyName}: {ex.GetType().Name} - {ex.Message}");
            }
        }

        Assert.True(
            failures.Count == 0,
            "Every asserted assembly must load before its dependency rule can be checked. " +
            $"Could not load: {string.Join("; ", failures)}.");
    }

    [Fact]
    public void Rule_13_1_DomainReferencesNoOuterLayer()
    {
        // Req 13.1 — Domain references, directly or transitively, none of Application/Infrastructure/Api.
        var offenders = LayerDependencyOffenders(
            DomainAssembly, DomainName, ApplicationName, InfrastructureName, ApiName);

        Assert.True(
            offenders.Count == 0,
            $"Rule 13.1 violated: {DomainName} must not reference {ApplicationName}, " +
            $"{InfrastructureName}, or {ApiName}. Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Rule_13_2_ApplicationReferencesDomainOnly()
    {
        // Req 13.2 — Application references Domain ...
        var referenced = ReferencedAssemblyNames(ApplicationAssembly);
        Assert.True(
            referenced.Contains(DomainName),
            $"Rule 13.2 violated: {ApplicationName} must reference {DomainName}.");

        // ... and references neither Infrastructure nor Api.
        var offenders = LayerDependencyOffenders(
            ApplicationAssembly, ApplicationName, InfrastructureName, ApiName);

        Assert.True(
            offenders.Count == 0,
            $"Rule 13.2 violated: {ApplicationName} must not reference {InfrastructureName} " +
            $"or {ApiName}. Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Rule_13_3_InfrastructureDoesNotReferenceApi()
    {
        // Req 13.3 — Infrastructure does not reference, directly or transitively, Api.
        var offenders = LayerDependencyOffenders(
            InfrastructureAssembly, InfrastructureName, ApiName);

        Assert.True(
            offenders.Count == 0,
            $"Rule 13.3 violated: {InfrastructureName} must not reference {ApiName}. " +
            $"Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Rule_13_4_DomainHasNoEfNpgsqlOrAspNetDependency()
    {
        // Req 13.4 — Domain depends on no EF Core / Npgsql / ASP.NET Core types.
        var offenders = FrameworkDependencyOffenders(DomainAssembly, DomainName);

        Assert.True(
            offenders.Count == 0,
            $"Rule 13.4 violated: {DomainName} must not depend on EF Core, Npgsql, or " +
            $"ASP.NET Core. Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Rule_13_5_ApplicationHasNoEfNpgsqlOrAspNetDependency()
    {
        // Req 13.5 — Application depends on no EF Core / Npgsql / ASP.NET Core types.
        var offenders = FrameworkDependencyOffenders(ApplicationAssembly, ApplicationName);

        Assert.True(
            offenders.Count == 0,
            $"Rule 13.5 violated: {ApplicationName} must not depend on EF Core, Npgsql, or " +
            $"ASP.NET Core. Offenders: {Describe(offenders)}.");
    }

    /// <summary>
    /// Collects violations where <paramref name="assembly"/> references one of the forbidden
    /// PitchMate layer assemblies, combining referenced-assembly metadata (catches unused
    /// references) with type-level IL dependencies (catches actual usage).
    /// </summary>
    private static IReadOnlyList<string> LayerDependencyOffenders(
        Assembly assembly, string ownRootNamespace, params string[] forbiddenLayerNames)
    {
        var offenders = new List<string>();

        var referenced = ReferencedAssemblyNames(assembly);
        offenders.AddRange(
            forbiddenLayerNames
                .Where(referenced.Contains)
                .Select(name => $"references assembly '{name}'"));

        offenders.AddRange(NamespaceDependencyOffenders(assembly, ownRootNamespace, forbiddenLayerNames));
        return offenders;
    }

    /// <summary>
    /// Collects violations where <paramref name="assembly"/> depends on EF Core, Npgsql, or
    /// ASP.NET Core, via both referenced package assemblies and type-level IL dependencies.
    /// </summary>
    private static IReadOnlyList<string> FrameworkDependencyOffenders(Assembly assembly, string ownRootNamespace)
    {
        var offenders = new List<string>();

        var referenced = ReferencedAssemblyNames(assembly);
        offenders.AddRange(
            EfNpgsqlAspNetAssemblies
                .Where(referenced.Contains)
                .Select(name => $"references assembly '{name}'"));

        offenders.AddRange(NamespaceDependencyOffenders(assembly, ownRootNamespace, EfNpgsqlAspNetNamespaces));
        return offenders;
    }

    /// <summary>
    /// Returns the names of types in <paramref name="assembly"/> (restricted to its own root
    /// namespace) that take a type-level dependency on any of <paramref name="forbiddenNamespaces"/>.
    /// </summary>
    private static IReadOnlyList<string> NamespaceDependencyOffenders(
        Assembly assembly, string ownRootNamespace, params string[] forbiddenNamespaces)
    {
        var result = Types.InAssembly(assembly)
            .That().ResideInNamespaceStartingWith(ownRootNamespace)
            .Should().NotHaveDependencyOnAny(forbiddenNamespaces)
            .GetResult();

        return result.IsSuccessful
            ? Array.Empty<string>()
            : (result.FailingTypeNames?.ToList() ?? new List<string>());
    }

    private static HashSet<string> ReferencedAssemblyNames(Assembly assembly) =>
        assembly.GetReferencedAssemblies()
            .Select(name => name.Name)
            .Where(name => name is not null)
            .ToHashSet(StringComparer.OrdinalIgnoreCase)!;

    private static string Describe(IReadOnlyList<string> offenders) =>
        offenders.Count == 0 ? "(none)" : string.Join("; ", offenders);
}
