namespace PitchMate.Infrastructure.Auth;

/// <summary>
/// Configuration for Google (OIDC) sign-in, bound from the <c>Auth:Google</c> configuration section.
/// The <see cref="ClientId"/> is the OAuth client identifier whose value the verifier enforces as the
/// required audience of every Google assertion, so tokens minted for a different client are rejected
/// (Requirement 7.7). The Api binds and validates these at startup so a missing client id fails fast
/// (Requirements 15.3, 15.4).
/// </summary>
public sealed class GoogleOptions
{
    /// <summary>The configuration section these options bind from.</summary>
    public const string SectionName = "Auth:Google";

    /// <summary>
    /// The Google OAuth client id. Used as the required audience when validating Google ID-token
    /// assertions; an assertion whose audience does not match is rejected (Requirement 7.7).
    /// </summary>
    public string ClientId { get; init; } = "";
}
