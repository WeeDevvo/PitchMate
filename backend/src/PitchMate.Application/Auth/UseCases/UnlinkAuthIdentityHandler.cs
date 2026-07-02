using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// Unlinks (removes) one of an authenticated account's sign-in methods (Requirement 10),
/// guarding that a user is never left with no means of signing in.
/// <list type="bullet">
///   <item>A request without an authenticated session removes nothing and fails with
///   <see cref="AuthErrorCode.Unauthenticated"/>.</item>
///   <item>An identity that does not belong to the requesting user fails with
///   <see cref="AuthErrorCode.ValidationFailed"/>, removing nothing.</item>
///   <item>If the identity is the user's only remaining one, the unlink is rejected with
///   <see cref="AuthErrorCode.LastIdentity"/> so the user retains at least one sign-in
///   method (Requirement 10.7).</item>
///   <item>Otherwise the requested identity is removed, leaving the user with at least one
///   remaining identity (Requirement 10.6).</item>
/// </list>
/// </summary>
public sealed class UnlinkAuthIdentityHandler
{
    private readonly IAuthIdentityRepository _identities;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the identity repository and unit of work it commits through.
    /// </summary>
    public UnlinkAuthIdentityHandler(
        IAuthIdentityRepository identities,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(identities);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _identities = identities;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles an <see cref="UnlinkAuthIdentityCommand"/>, removing the requested identity
    /// or returning a typed <see cref="AuthError"/> on a missing session, an unknown
    /// identity, or an attempt to remove the last remaining sign-in method.
    /// </summary>
    /// <param name="command">The unlink request carrying the authenticated user and target identity.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(UnlinkAuthIdentityCommand command, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);

        // The request must carry a valid authenticated session.
        if (command.UserId is not { } userId || userId == Guid.Empty)
        {
            return Fail(AuthErrorCode.Unauthenticated, "Unlinking requires an authenticated session.");
        }

        // List the user's identities so both ownership and the last-identity guard are evaluated
        // against the user's own set.
        IReadOnlyList<AuthIdentity> identities = await _identities.ListForUserAsync(userId, ct);

        AuthIdentity? target = identities.FirstOrDefault(identity => identity.Id == command.IdentityId);
        if (target is null)
        {
            // The identity does not exist or is not owned by the requesting user; remove nothing.
            return Fail(AuthErrorCode.ValidationFailed, "No such sign-in method for this account.");
        }

        // Reject removing the user's only remaining sign-in method so no user is left unable to
        // sign in (Requirement 10.7).
        if (identities.Count <= 1)
        {
            return Fail(AuthErrorCode.LastIdentity, "Cannot remove the last sign-in method.");
        }

        // At least one identity will remain after removal (Requirement 10.6).
        _identities.Remove(target);
        await _unitOfWork.SaveChangesAsync(ct);

        return Result.Ok();
    }

    private static Result Fail(AuthErrorCode code, string message) =>
        Result.Fail(new AuthError(code, message));
}
