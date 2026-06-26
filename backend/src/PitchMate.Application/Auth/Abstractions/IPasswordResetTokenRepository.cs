using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// Persistence gateway for single-use <see cref="PasswordResetToken"/> rows: adds new
/// tokens, finds a redeemable token by its one-way hash, lists an identity's unredeemed
/// tokens so a re-issue can supersede them, and counts recent requests for rate limiting.
/// Only token hashes are stored.
/// </summary>
public interface IPasswordResetTokenRepository
{
    /// <summary>
    /// Stages a newly issued <paramref name="token"/> for insertion; persisted when the
    /// unit of work is committed.
    /// </summary>
    /// <param name="token">The reset token to add.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task AddAsync(PasswordResetToken token, CancellationToken ct);

    /// <summary>
    /// Finds a currently redeemable (unredeemed and unexpired) reset token whose stored
    /// hash equals <paramref name="tokenHash"/>, or <see langword="null"/> when none
    /// matches.
    /// </summary>
    /// <param name="tokenHash">The one-way hash of the presented reset-token secret.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task<PasswordResetToken?> FindRedeemableByHashAsync(string tokenHash, CancellationToken ct);

    /// <summary>
    /// Lists the unredeemed reset tokens owned by the Password identity with the given
    /// <paramref name="authIdentityId"/> — used to supersede prior tokens when a fresh one
    /// is issued.
    /// </summary>
    /// <param name="authIdentityId">The identifier of the Password identity being reset.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task<IReadOnlyList<PasswordResetToken>> ListUnredeemedForAuthIdentityAsync(Guid authIdentityId, CancellationToken ct);

    /// <summary>
    /// Counts the reset requests made for the Password identity with the given
    /// <paramref name="authIdentityId"/> since <paramref name="since"/> — used to enforce a
    /// rolling-window rate limit on reset requests.
    /// </summary>
    /// <param name="authIdentityId">The identifier of the Password identity being reset.</param>
    /// <param name="since">The inclusive lower bound of the rolling window.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task<int> CountRequestsInWindowAsync(Guid authIdentityId, DateTimeOffset since, CancellationToken ct);
}
