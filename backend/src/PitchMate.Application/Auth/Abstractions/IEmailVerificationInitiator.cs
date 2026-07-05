using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// Initiates <see cref="EmailVerificationToken"/> issuance and delivery for a
/// <see cref="User"/>. This is a deliberate seam: the registration use case
/// (Requirement 2.6) must <em>initiate</em> email verification without owning or
/// duplicating the token-issuance and delivery logic, which belongs to the
/// <c>RequestEmailVerificationHandler</c> use case (Requirements 4.1, 4.6, 4.8).
/// <para>
/// The verification use case implements this contract, so registration depends only
/// on the abstraction and the two evolve independently.
/// </para>
/// </summary>
public interface IEmailVerificationInitiator
{
    /// <summary>
    /// Initiates email verification for <paramref name="user"/>: issues a fresh
    /// single-use verification token (superseding any prior unredeemed token), persists
    /// only its one-way hash, and delivers the verification message to the user's email.
    /// Surfaces delivery failure as a failed <see cref="Result"/> rather than throwing,
    /// so the caller can decide how to proceed (Requirement 4.6).
    /// </summary>
    /// <param name="user">The user whose email address is to be verified.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task<Result> InitiateAsync(User user, CancellationToken ct);
}
