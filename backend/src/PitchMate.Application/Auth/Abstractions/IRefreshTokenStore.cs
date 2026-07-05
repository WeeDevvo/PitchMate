using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// The refresh-token revocation store: persists rotating, revocable
/// <see cref="RefreshToken"/> rows and supports lookup by one-way hash and by family,
/// plus enumeration of a user's currently active tokens. Only token hashes are stored;
/// an incoming secret is matched by hashing it and comparing against
/// <see cref="RefreshToken.TokenHash"/>.
/// </summary>
public interface IRefreshTokenStore
{
    /// <summary>
    /// Stages a newly issued <paramref name="token"/> for insertion; persisted when the
    /// unit of work is committed.
    /// </summary>
    /// <param name="token">The refresh token to add.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task AddAsync(RefreshToken token, CancellationToken ct);

    /// <summary>
    /// Finds the refresh token whose stored hash equals <paramref name="tokenHash"/>, or
    /// <see langword="null"/> when none matches.
    /// </summary>
    /// <param name="tokenHash">The one-way hash of the presented refresh-token secret.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task<RefreshToken?> FindByHashAsync(string tokenHash, CancellationToken ct);

    /// <summary>
    /// Lists every token belonging to the family identified by
    /// <paramref name="tokenFamilyId"/> — used to revoke a whole family on reuse detection
    /// or sign-out.
    /// </summary>
    /// <param name="tokenFamilyId">The family chain identifier.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task<IReadOnlyList<RefreshToken>> ListFamilyAsync(Guid tokenFamilyId, CancellationToken ct);

    /// <summary>
    /// Lists the active refresh tokens currently owned by the user with the given
    /// <paramref name="userId"/> — used to revoke all of a user's sessions (e.g. on
    /// password reset).
    /// </summary>
    /// <param name="userId">The owning user's identifier.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task<IReadOnlyList<RefreshToken>> ListActiveForUserAsync(Guid userId, CancellationToken ct);
}
