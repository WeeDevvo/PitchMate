namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// The outcome of a successful email + password registration: the identifier of the
/// newly created <c>User</c>. The account is created with its email recorded as not yet
/// verified and email verification initiated (Requirement 2.6).
/// </summary>
/// <param name="UserId">The identifier of the newly created user.</param>
public sealed record RegisterWithPasswordResult(Guid UserId);
