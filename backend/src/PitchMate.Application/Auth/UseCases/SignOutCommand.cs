namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// A request to sign out of a session, identified by one of its refresh tokens
/// (Requirement 9.4). The <paramref name="RefreshToken"/> is the opaque plaintext secret
/// the client holds for the session; the handler resolves its Token_Family and revokes
/// every member. It may be <see langword="null"/> or blank, in which case there is no
/// family to revoke and sign-out is a successful no-op.
/// </summary>
/// <param name="RefreshToken">The opaque plaintext refresh-token secret identifying the session to end.</param>
public sealed record SignOutCommand(string? RefreshToken);
