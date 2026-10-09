namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// A request to read the account of the authenticated caller identified by
/// <paramref name="UserId"/>, resolved from the caller's token subject (Requirement 8.2). The
/// handler reads only, and a request for a user that does not exist produces no view and a typed
/// <see cref="AuthErrorCode.UserNotFound"/> failure (Requirement 8.6).
/// </summary>
/// <param name="UserId">The authenticated caller's own user identifier.</param>
public sealed record GetAccountCommand(Guid UserId);
