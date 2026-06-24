using System.Reflection;
using NetArchTest.Rules;
using PitchMate.Domain.Rating;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Architecture / structure tests enforcing the Clean Architecture placement rules of
/// Requirement 13 (and the purity constraint of Requirement 4.2). These are example/structure
/// assertions over assembly metadata and dependency direction — not property-based tests.
///
/// What is checked here:
/// <list type="bullet">
///   <item><description>13.1 — <see cref="IRatingEngine"/> resides in the PitchMate.Domain assembly.</description></item>
///   <item><description>13.2 / 4.2 — the Domain assembly takes no dependency on persistence, auth/credentials,
///   file/object storage, or network/HTTP types or assemblies.</description></item>
///   <item><description>13.3 — the <c>PlackettLuceRatingEngine</c> implementation resides in the
///   PitchMate.Infrastructure assembly.</description></item>
///   <item><description>13.4 — the Domain project references none of PitchMate.Application,
///   PitchMate.Infrastructure, or PitchMate.Api.</description></item>
/// </list>
///
/// Note on the system clock and randomness (part of 13.2 / 4.2): <c>DateTime.Now</c>,
/// <c>DateTimeOffset.Now</c>, and <c>System.Random</c> live in the core <c>System</c> namespace,
/// which the Domain assembly necessarily references for its primitive value types, so they cannot
/// be excluded by a referenced-assembly or namespace check without also excluding legitimate core
/// types. That constraint is enforced instead by the engine's purity/determinism property tests
/// (Properties 9 and 10) and by code review; the reliably-checkable persistence/auth/storage/network
/// dependencies are asserted automatically below.
/// </summary>
public class CleanArchitecturePlacementTests
{
    private static readonly Assembly DomainAssembly = typeof(IRatingEngine).Assembly;
    private static readonly Assembly InfrastructureAssembly =
        typeof(PitchMate.Infrastructure.PlackettLuceRatingEngine).Assembly;

    private const string DomainAssemblyName = "PitchMate.Domain";
    private const string InfrastructureAssemblyName = "PitchMate.Infrastructure";

    /// <summary>Namespaces representing persistence, auth/credentials, storage, and network/HTTP concerns.</summary>
    private static readonly string[] ForbiddenDomainDependencyNamespaces =
    {
        "System.Data",                 // ADO.NET / data access
        "System.Net",                  // network / HTTP (covers System.Net.Http)
        "System.IO",                   // file / object storage
        "System.Security",             // auth / credentials / cryptography
        "Microsoft.EntityFrameworkCore", // EF Core persistence
        "Npgsql",                      // PostgreSQL driver
        "Microsoft.AspNetCore",        // web / HTTP hosting
    };

    /// <summary>Assemblies the Domain project must never reference (outer Clean Architecture layers + infra deps).</summary>
    private static readonly string[] ForbiddenDomainReferencedAssemblies =
    {
        "PitchMate.Application",
        "PitchMate.Infrastructure",
        "PitchMate.Api",
        "Microsoft.EntityFrameworkCore",
        "Microsoft.EntityFrameworkCore.Relational",
        "Npgsql",
        "Npgsql.EntityFrameworkCore.PostgreSQL",
        "Microsoft.AspNetCore.Http.Abstractions",
    };

    [Fact]
    public void IRatingEngine_ResidesInDomainAssembly()
    {
        // Requirement 13.1
        Assert.Equal(DomainAssemblyName, DomainAssembly.GetName().Name);
    }

    [Fact]
    public void PlackettLuceRatingEngine_ResidesInInfrastructureAssembly()
    {
        // Requirement 13.3
        Assert.Equal(InfrastructureAssemblyName, InfrastructureAssembly.GetName().Name);
    }

    [Fact]
    public void PlackettLuceRatingEngine_ImplementsTheDomainInterface()
    {
        // Requirement 13.3 — the implementation is the Infrastructure concrete type of the Domain contract.
        Assert.True(
            typeof(IRatingEngine).IsAssignableFrom(typeof(PitchMate.Infrastructure.PlackettLuceRatingEngine)),
            "PlackettLuceRatingEngine must implement the Domain IRatingEngine interface.");
    }

    [Fact]
    public void DomainTypes_HaveNoPersistenceAuthStorageOrNetworkDependencies()
    {
        // Requirements 13.2, 4.2 — no dependency on data access, auth/credentials, storage, or network/HTTP.
        var result = Types.InAssembly(DomainAssembly)
            .That().ResideInNamespaceStartingWith(DomainAssemblyName)
            .Should().NotHaveDependencyOnAny(ForbiddenDomainDependencyNamespaces)
            .GetResult();

        var offenders = result.FailingTypeNames is null
            ? string.Empty
            : string.Join(", ", result.FailingTypeNames);

        Assert.True(
            result.IsSuccessful,
            $"Domain types must not depend on persistence/auth/storage/network namespaces. Offending types: {offenders}");
    }

    [Fact]
    public void DomainAssembly_DoesNotReferenceForbiddenAssemblies()
    {
        // Requirements 13.4 (Application/Infrastructure/Api) and 13.2/4.2 (no persistence/network assemblies).
        var referenced = DomainAssembly
            .GetReferencedAssemblies()
            .Select(name => name.Name)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var violations = ForbiddenDomainReferencedAssemblies
            .Where(forbidden => referenced.Contains(forbidden))
            .ToList();

        Assert.True(
            violations.Count == 0,
            $"The Domain assembly must not reference: {string.Join(", ", violations)}.");
    }

    [Fact]
    public void DomainAssembly_ReferencesNoOtherPitchMateProject()
    {
        // Requirement 13.4 — Domain sits at the centre and references no outer PitchMate project.
        var pitchMateReferences = DomainAssembly
            .GetReferencedAssemblies()
            .Select(name => name.Name)
            .Where(name => name is not null && name.StartsWith("PitchMate.", StringComparison.Ordinal))
            .ToList();

        Assert.True(
            pitchMateReferences.Count == 0,
            $"The Domain assembly must not reference any other PitchMate project. Found: {string.Join(", ", pitchMateReferences)}.");
    }
}
