using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// Persistence gateway for single-use <see cref="EmailVerificationToken"/> rows: adds new
/// tokens, finds a redeemable token by its one-way hash, and lists a user's unredeemed
/// tokens so a re-issue can supersede them. Only token hashes are stored.
/// </summary>
public interface IEmailVerificationTokenRepository
{
    /// <summary>
    /// Stages a newly issued <paramref name="token"/> for insertion; persisted when the
    /// unit of work is committed.
    /// </summary>
    /// <param name="token">The verification token to add.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task AddAsync(EmailVerificationToken token, CancellationToken ct);

    /// <summary>
    /// Finds a currently redeemable (unredeemed and unexpired) verification token whose
    /// stored hash equals <paramref name="tokenHash"/>, or <see langword="null"/> when none
    /// matches.
    /// </summary>
    /// <param name="tokenHash">The one-way hash of the presented verification-token secret.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task<EmailVerificationToken?> FindRedeemableByHashAsync(string tokenHash, CancellationToken ct);

    /// <summary>
    /// Lists the unredeemed verification tokens owned by the user with the given
    /// <paramref name="userId"/> — used to supersede prior tokens when a fresh one is
    /// issued.
    /// </summary>
    /// <param name="userId">The owning user's identifier.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task<IReadOnlyList<EmailVerificationToken>> ListUnredeemedForUserAsync(Guid userId, CancellationToken ct);
}
