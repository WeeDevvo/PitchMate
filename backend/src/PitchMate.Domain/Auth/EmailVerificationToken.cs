using PitchMate.Domain.Common;

namespace PitchMate.Domain.Auth;

/// <summary>
/// A single-use, time-limited token proving control of a <c>User</c>'s email address.
/// Only the one-way <see cref="TokenHash"/> is persisted; the plaintext is delivered
/// to the user once by email and never stored (Requirement 4.7). A token is redeemable
/// only while unredeemed and unexpired, and issuing a fresh token supersedes any prior
/// unredeemed token for the user (Requirements 4.2, 4.8).
/// </summary>
public sealed class EmailVerificationToken : BaseEntity
{
    /// <summary>
    /// A sentinel <see cref="RedeemedAt"/> value marking a token that was superseded
    /// (invalidated) rather than genuinely redeemed. Any non-null
    /// <see cref="RedeemedAt"/> renders the token non-redeemable, keeping the
    /// <see cref="IsRedeemableAt"/> contract intact.
    /// </summary>
    private static readonly DateTimeOffset SupersededMarker = DateTimeOffset.MinValue;

    /// <summary>The identifier of the owning <c>User</c> whose email is being verified.</summary>
    public Guid UserId { get; private set; }

    /// <summary>
    /// The one-way hash of the verification-token secret. The plaintext is emailed once
    /// and never persisted.
    /// </summary>
    public string TokenHash { get; private set; }

    /// <summary>The UTC instant after which the token can no longer be redeemed.</summary>
    public DateTimeOffset ExpiresAt { get; private set; }

    /// <summary>
    /// The UTC instant at which the token was redeemed, or <see langword="null"/> while
    /// it remains unredeemed. A non-null value also marks a superseded token.
    /// </summary>
    public DateTimeOffset? RedeemedAt { get; private set; }

    private EmailVerificationToken(Guid userId, string tokenHash, DateTimeOffset expiresAt)
    {
        UserId = userId;
        TokenHash = tokenHash;
        ExpiresAt = expiresAt;
    }

    /// <summary>
    /// Issues a new email-verification token for <paramref name="userId"/>, holding the
    /// one-way hash of the secret delivered to the user.
    /// </summary>
    /// <param name="userId">The owning user's identifier.</param>
    /// <param name="tokenHash">The one-way hash of the issued verification-token secret.</param>
    /// <param name="expiresAt">The UTC instant after which the token can no longer be redeemed.</param>
    /// <returns>The new <see cref="EmailVerificationToken"/>.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="tokenHash"/> is null, empty, or whitespace.</exception>
    public static EmailVerificationToken Issue(Guid userId, string tokenHash, DateTimeOffset expiresAt)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tokenHash);

        return new EmailVerificationToken(userId, tokenHash, expiresAt);
    }

    /// <summary>
    /// Indicates whether the token can be redeemed at <paramref name="now"/>: it must be
    /// unredeemed and unexpired.
    /// </summary>
    /// <param name="now">The UTC instant to evaluate against.</param>
    /// <returns><see langword="true"/> when unredeemed and unexpired; otherwise <see langword="false"/>.</returns>
    public bool IsRedeemableAt(DateTimeOffset now) => RedeemedAt == null && now < ExpiresAt;

    /// <summary>
    /// Marks the token as redeemed at <paramref name="now"/>, after which it is no longer
    /// redeemable.
    /// </summary>
    /// <param name="now">The UTC instant at which redemption occurred.</param>
    public void Redeem(DateTimeOffset now) => RedeemedAt = now;

    /// <summary>
    /// Supersedes a prior unredeemed token so it can no longer be redeemed, by stamping
    /// <see cref="RedeemedAt"/> with a marker value (Requirement 4.8). Consistent with
    /// <see cref="IsRedeemableAt"/>, which treats any non-null <see cref="RedeemedAt"/>
    /// as spent.
    /// </summary>
    public void Invalidate() => RedeemedAt ??= SupersededMarker;
}
