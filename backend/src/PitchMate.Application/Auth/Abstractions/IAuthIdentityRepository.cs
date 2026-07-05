using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// Persistence gateway for <see cref="AuthIdentity"/> rows.
/// <para>
/// Resolution of an incoming authentication is done <strong>solely</strong> on the pair
/// (<see cref="AuthIdentity.Provider"/>, <see cref="AuthIdentity.ProviderUserId"/>) via
/// <see cref="FindByProviderKeyAsync"/> — <strong>never</strong> on email address.
/// Signing in with a second provider therefore does not auto-merge accounts; linking an
/// additional method is a deliberate, authenticated action (Requirements 1.4, 1.11).
/// </para>
/// </summary>
public interface IAuthIdentityRepository
{
    /// <summary>
    /// Resolves an identity by matching only on the provider key pair
    /// (<paramref name="provider"/>, <paramref name="providerUserId"/>), returning
    /// <see langword="null"/> when none matches. This is the sole resolution path; email
    /// address is never used to match (Requirements 1.4, 1.11).
    /// </summary>
    /// <param name="provider">The authentication mechanism to match.</param>
    /// <param name="providerUserId">The provider's own identifier for the person.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task<AuthIdentity?> FindByProviderKeyAsync(
        AuthProvider provider, string providerUserId, CancellationToken ct);

    /// <summary>
    /// Lists every <see cref="AuthIdentity"/> owned by the user with the given
    /// <paramref name="userId"/>.
    /// </summary>
    /// <param name="userId">The owning user's identifier.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task<IReadOnlyList<AuthIdentity>> ListForUserAsync(Guid userId, CancellationToken ct);

    /// <summary>
    /// Stages a newly created <paramref name="identity"/> for insertion; persisted when the
    /// unit of work is committed.
    /// </summary>
    /// <param name="identity">The identity to add.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task AddAsync(AuthIdentity identity, CancellationToken ct);

    /// <summary>
    /// Stages the removal of an existing <paramref name="identity"/> (account unlinking);
    /// applied when the unit of work is committed.
    /// </summary>
    /// <param name="identity">The identity to remove.</param>
    void Remove(AuthIdentity identity);
}
