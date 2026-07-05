using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Infrastructure.Auth.Repositories;

namespace PitchMate.Infrastructure.Auth;

/// <summary>
/// Registers the Infrastructure implementations of the Application auth abstractions
/// (Requirement 12.3). This lives in Infrastructure because the EF Core repositories are
/// <c>internal</c> to the assembly and cannot be referenced from the Api; the Api's
/// <c>AddAuth</c> composition root calls this so every abstraction the auth use cases depend
/// on resolves to a concrete implementation, and a missing one fails startup (Requirement 12.6).
/// <para>
/// Options binding, the email-sender selection (Requirement 11.7), and the Application use-case
/// registrations live in the Api's <c>AddAuth</c>; this method only wires the Infrastructure
/// side. <see cref="ServiceCollectionDescriptorExtensions.TryAdd(IServiceCollection, ServiceDescriptor)"/>
/// variants are used so a test host can substitute a fake (e.g. a <c>FakeTimeProvider</c>-backed
/// token service) before calling this.
/// </para>
/// </summary>
public static class AuthInfrastructureRegistration
{
    /// <summary>
    /// Registers the cryptographic primitives, token service, external-provider verifier,
    /// sign-in attempt tracker, and EF Core auth repositories.
    /// </summary>
    /// <param name="services">The service collection to add registrations to.</param>
    /// <returns>The same <paramref name="services"/> for chaining.</returns>
    public static IServiceCollection AddAuthInfrastructure(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Cryptographic primitives — stateless and thread-safe, so a single shared instance is
        // safe to share as a singleton.
        services.TryAddSingleton<IPasswordHasher, IdentityPasswordHasher>();
        services.TryAddSingleton<ISecretHasher, Sha256SecretHasher>();
        services.TryAddSingleton<ISecretTokenGenerator, RandomSecretTokenGenerator>();

        // Token issuance/verification (JWT) and Google assertion validation. Both read validated
        // options and hold no per-request state, so they are singletons (Requirements 8.x, 7.x).
        services.TryAddSingleton<ITokenService, JwtTokenService>();
        services.TryAddSingleton<IExternalProviderVerifier, GoogleProviderVerifier>();

        // Optional sign-in lockout tracker: process-local state that must survive across request
        // scopes, hence a singleton (Requirement 6.7). Only consulted when lockout is enabled.
        services.TryAddSingleton<ISignInAttemptTracker, InMemorySignInAttemptTracker>();

        // EF Core auth repositories — scoped so they share the request scope's DbContext and take
        // part in the same unit-of-work transaction (Requirement 12.3).
        services.TryAddScoped<IUserRepository, EfUserRepository>();
        services.TryAddScoped<IAuthIdentityRepository, EfAuthIdentityRepository>();
        services.TryAddScoped<IRefreshTokenStore, EfRefreshTokenStore>();
        services.TryAddScoped<IEmailVerificationTokenRepository, EfEmailVerificationTokenRepository>();
        services.TryAddScoped<IPasswordResetTokenRepository, EfPasswordResetTokenRepository>();

        return services;
    }
}
