namespace PitchMate.Application.Auth.EmailVerification;

/// <summary>
/// A request to initiate (or re-initiate) email verification for a user: issue a fresh
/// single-use verification token, supersede any prior unredeemed token, and send the
/// verification message to the user's recorded email address. Used by the registration
/// flow to initiate verification and by an explicit "resend verification" endpoint.
/// </summary>
/// <param name="UserId">The identifier of the user whose email address is being verified.</param>
public sealed record RequestEmailVerificationCommand(Guid UserId);
