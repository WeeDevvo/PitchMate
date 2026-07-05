namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// The closed verdict of validating a presented access token: a well-formed, in-date, correctly
/// signed and targeted token is <see cref="Valid"/>; a well-formed token past its expiry is
/// <see cref="Expired"/>; anything else (malformed, tampered, wrong key/issuer/audience, null) is
/// <see cref="Invalid"/>.
/// </summary>
public enum AccessTokenStatus
{
    /// <summary>The token is well-formed, in-date, and correctly signed and targeted.</summary>
    Valid,

    /// <summary>The token is well-formed and correctly signed but past its expiry.</summary>
    Expired,

    /// <summary>The token is malformed, tampered, mis-targeted, or otherwise unacceptable.</summary>
    Invalid,
}
