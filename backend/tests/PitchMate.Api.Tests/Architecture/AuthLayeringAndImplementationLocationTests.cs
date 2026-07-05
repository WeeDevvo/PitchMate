using System.Reflection;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;
using PitchMate.Infrastructure.Auth;

namespace PitchMate.Api.Tests.Architecture;

/// <summary>
/// Architecture / dependency-rule tests enforcing the Clean Architecture layering of the auth
/// subsystem on every <c>dotnet test</c> run, so the inward-only dependency rule and the placement
/// of security-sensitive logic cannot regress unnoticed.
///
/// Complements <c>PitchMate.Infrastructure.Tests.Architecture.ArchitectureDependencyTests</c>: that
/// suite proves the inner layers do not reference the outer ones; this suite (which can see the
/// <c>PitchMate.Api</c> assembly) proves the two rules that require the Api assembly to assert —
/// that Domain/Application reference only what they are permitted to, and that the token/verification/
/// password-hashing implementations live in Infrastructure and NOT in Api.
///
/// What is enforced:
/// <list type="bullet">
///   <item><description>1.9 / 12.1 — the Domain project references no other PitchMate project.</description></item>
///   <item><description>12.2 — the Application project references only the Domain project among PitchMate assemblies.</description></item>
///   <item><description>12.3 / 7.10 / 8.8 — the <c>ITokenService</c>, <c>IExternalProviderVerifier</c>, and
///   <c>IPasswordHasher</c> implementations reside in <c>PitchMate.Infrastructure</c>.</description></item>
///   <item><description>12.4 / 12.5 — none of that token issuance/verification or external-provider
///   verification logic resides in <c>PitchMate.Api</c>.</description></item>
/// </list>
///
/// The approach is dependency-free (<see cref="System.Reflection"/> only): referenced-assembly
/// metadata via <see cref="Assembly.GetReferencedAssemblies"/> catches a project reference even if no
/// type from it is used yet, and a scan of concrete types catches a mis-placed implementation.
/// </summary>
public class AuthLayeringAndImplementationLocationTests
{
    private const string PitchMatePrefix = "PitchMate.";
    private const string DomainName = "PitchMate.Domain";
    private const string ApplicationName = "PitchMate.Application";
    private const string InfrastructureName = "PitchMate.Infrastructure";
    private const string ApiName = "PitchMate.Api";

    // Anchor types create a hard compile-time and runtime link to each asserted assembly, so a build
    // with a renamed/missing assembly fails to compile rather than passing this suite silently.
    private static readonly Assembly DomainAssembly = typeof(AuthProvider).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(ITokenService).Assembly;
    private static readonly Assembly InfrastructureAssembly = typeof(JwtTokenService).Assembly;
    private static readonly Assembly ApiAssembly = typeof(Program).Assembly;

    /// <summary>The auth abstractions whose implementations must live in Infrastructure, never in Api.</summary>
    private static readonly Type[] SecuritySensitiveAbstractions =
    {
        typeof(ITokenService),
        typeof(IExternalProviderVerifier),
        typeof(IPasswordHasher),
    };

    [Fact]
    public void AssertedAssembliesAreTheExpectedProjects()
    {
        // Guard against an anchor type drifting into the wrong assembly, which would make the
        // remaining assertions inspect the wrong project and pass misleadingly.
        Assert.Equal(DomainName, DomainAssembly.GetName().Name);
        Assert.Equal(ApplicationName, ApplicationAssembly.GetName().Name);
        Assert.Equal(InfrastructureName, InfrastructureAssembly.GetName().Name);
        Assert.Equal(ApiName, ApiAssembly.GetName().Name);
    }

    [Fact]
    public void Domain_ReferencesNoOtherPitchMateProject()
    {
        // Requirements 1.9, 12.1 — Domain uses only its own types and the BCL.
        var pitchMateReferences = ReferencedPitchMateAssemblies(DomainAssembly)
            .Where(name => !string.Equals(name, DomainName, StringComparison.OrdinalIgnoreCase))
            .ToList();

        Assert.True(
            pitchMateReferences.Count == 0,
            $"{DomainName} must reference no other PitchMate project (Requirements 1.9, 12.1). " +
            $"Offending references: {Describe(pitchMateReferences)}.");
    }

    [Fact]
    public void Application_ReferencesOnlyDomainAmongPitchMateProjects()
    {
        // Requirement 12.2 — Application references only Domain (plus the BCL).
        var pitchMateReferences = ReferencedPitchMateAssemblies(ApplicationAssembly);

        Assert.Contains(DomainName, pitchMateReferences, StringComparer.OrdinalIgnoreCase);

        var disallowed = pitchMateReferences
            .Where(name => !string.Equals(name, DomainName, StringComparison.OrdinalIgnoreCase))
            .ToList();

        Assert.True(
            disallowed.Count == 0,
            $"{ApplicationName} must reference only {DomainName} among PitchMate projects " +
            $"(Requirement 12.2). Offending references: {Describe(disallowed)}.");
    }

    [Fact]
    public void SecuritySensitiveAbstractions_AreImplementedInInfrastructure()
    {
        // Requirements 12.3, 7.10, 8.8 — the token service, external-provider verifier, and password
        // hasher each have a concrete implementation in Infrastructure satisfying the Application abstraction.
        var missing = SecuritySensitiveAbstractions
            .Where(abstraction => !ConcreteImplementationsIn(InfrastructureAssembly, abstraction).Any())
            .Select(abstraction => abstraction.Name)
            .ToList();

        Assert.True(
            missing.Count == 0,
            $"{InfrastructureName} must contain a concrete implementation of each auth abstraction " +
            $"(Requirements 12.3, 7.10, 8.8). Missing implementations for: {Describe(missing)}.");
    }

    [Fact]
    public void SecuritySensitiveAbstractions_AreNotImplementedInApi()
    {
        // Requirements 12.4, 12.5 — token issuance/verification and external-provider verification logic
        // stays out of the Api project; the Api only wires DI and maps endpoints.
        var offenders = SecuritySensitiveAbstractions
            .SelectMany(abstraction =>
                ConcreteImplementationsIn(ApiAssembly, abstraction)
                    .Select(impl => $"{impl.FullName} implements {abstraction.Name}"))
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no token/verification/password-hashing implementation " +
            $"(Requirements 12.4, 12.5). Offenders: {Describe(offenders)}.");
    }

    /// <summary>
    /// Names of the PitchMate assemblies that <paramref name="assembly"/> references directly.
    /// </summary>
    private static IReadOnlyList<string> ReferencedPitchMateAssemblies(Assembly assembly) =>
        assembly.GetReferencedAssemblies()
            .Select(name => name.Name)
            .Where(name => name is not null &&
                           name.StartsWith(PitchMatePrefix, StringComparison.OrdinalIgnoreCase))
            .Select(name => name!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

    /// <summary>
    /// Concrete (instantiable) types in <paramref name="assembly"/> that implement <paramref name="abstraction"/>.
    /// </summary>
    private static IEnumerable<Type> ConcreteImplementationsIn(Assembly assembly, Type abstraction) =>
        GetLoadableTypes(assembly)
            .Where(type => type is { IsClass: true, IsAbstract: false } &&
                           abstraction.IsAssignableFrom(type));

    /// <summary>
    /// Returns the types that load successfully, tolerating a partially-loadable assembly so a single
    /// unresolved type does not mask the layering assertions.
    /// </summary>
    private static IEnumerable<Type> GetLoadableTypes(Assembly assembly)
    {
        try
        {
            return assembly.GetTypes();
        }
        catch (ReflectionTypeLoadException ex)
        {
            return ex.Types.Where(type => type is not null).Select(type => type!);
        }
    }

    private static string Describe(IReadOnlyCollection<string> offenders) =>
        offenders.Count == 0 ? "(none)" : string.Join("; ", offenders);
}
