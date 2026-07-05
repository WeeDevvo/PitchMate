namespace PitchMate.Application.Auth.Gdpr;

/// <summary>
/// A request to erase (anonymise) the user with the given <paramref name="UserId"/> under
/// the GDPR right to erasure (Requirement 14). Erasure strips the user's PII while keeping
/// the de-identified rows for referential integrity and rating replay, removes every
/// password credential, revokes every refresh token, and scrubs external identities so no
/// retained value identifies the person or permits a sign-in that resolves to them.
/// </summary>
/// <param name="UserId">The identifier of the user to erase.</param>
public sealed record EraseUserCommand(Guid UserId);
