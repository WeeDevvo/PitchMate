namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// A request to unlink (remove) one of an authenticated account's sign-in methods
/// (Requirement 10.6). The <paramref name="UserId"/> identifies the requesting, signed-in
/// <c>User</c> resolved from the caller's session; the <paramref name="IdentityId"/> is the
/// identifier of the <c>AuthIdentity</c> to remove, which must belong to that user.
/// <para>
/// <paramref name="UserId"/> may be <see langword="null"/> or empty so a request lacking an
/// authenticated session is reported as an authentication failure rather than throwing. The
/// unlink is rejected when it would leave the user with no remaining sign-in method
/// (Requirement 10.7).
/// </para>
/// </summary>
/// <param name="UserId">The authenticated requesting user's identifier; <see langword="null"/> when no session is present.</param>
/// <param name="IdentityId">The identifier of the <c>AuthIdentity</c> to remove.</param>
public sealed record UnlinkAuthIdentityCommand(
    Guid? UserId,
    Guid IdentityId);
