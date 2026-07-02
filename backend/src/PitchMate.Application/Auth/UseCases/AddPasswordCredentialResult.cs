namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// The outcome of successfully adding a Password sign-in method to an authenticated
/// account (Requirement 10.5): the requesting user's identifier and the identifier of the
/// newly created Password <c>AuthIdentity</c>.
/// </summary>
/// <param name="UserId">The identifier of the user the Password identity was added to.</param>
/// <param name="IdentityId">The identifier of the newly created Password <c>AuthIdentity</c>.</param>
public sealed record AddPasswordCredentialResult(
    Guid UserId,
    Guid IdentityId);
