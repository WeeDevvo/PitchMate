namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// The closed verdict of verifying a password against a stored hash: a non-match is
/// <see cref="Failure"/>; a match against current parameters is <see cref="Success"/>; a match against
/// outdated parameters is <see cref="SuccessRehashNeeded"/>, signalling the caller to re-hash and
/// persist the password (Requirement 3.5).
/// </summary>
public enum PasswordVerification
{
    /// <summary>The password does not match the stored hash.</summary>
    Failure,

    /// <summary>The password matches and the stored hash uses current parameters.</summary>
    Success,

    /// <summary>The password matches but the stored hash should be upgraded to current parameters.</summary>
    SuccessRehashNeeded,
}
