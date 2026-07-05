using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// The outcome of successfully linking an external sign-in method to an authenticated
/// account (Requirement 10.1): the requesting user's identifier, the identifier of the
/// newly attached <c>AuthIdentity</c>, and the provider it uses.
/// </summary>
/// <param name="UserId">The identifier of the user the identity was attached to.</param>
/// <param name="IdentityId">The identifier of the newly created <c>AuthIdentity</c>.</param>
/// <param name="Provider">The external provider the linked identity uses.</param>
public sealed record LinkExternalProviderResult(
    Guid UserId,
    Guid IdentityId,
    AuthProvider Provider);
