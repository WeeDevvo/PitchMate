using InAppNotification = PitchMate.Domain.Notifications.InAppNotification;
using Result = PitchMate.Domain.Notifications.Result;

namespace PitchMate.Application.Notifications;

/// <summary>
/// Pure, centralised authorisation gate over the notification read model, mirroring
/// <see cref="PitchMate.Application.Squads.SquadAuthorization"/>. Every read-model use case
/// (list, unread-count, mark-read, mark-all-read) first requires an authenticated caller, then gates
/// the requested records or squad scope through one of these methods before disclosing or mutating
/// anything.
/// <para>
/// The gate enforces Requirement 10:
/// </para>
/// <list type="bullet">
/// <item>A request made without an authenticated caller is rejected with
/// <see cref="NotificationErrorCode.Unauthenticated"/> and discloses nothing (Requirement 10.2).</item>
/// <item>A request over a record that is not backed by the caller is rejected with a single uniform,
/// non-disclosing <see cref="NotificationErrorCode.NotFound"/> that never reveals whether the record
/// exists (Requirements 10.1, 10.4, 10.5).</item>
/// <item>A squad-scoped request where the caller holds no membership of <b>any</b> state in that squad
/// is rejected with the same non-disclosing <see cref="NotificationErrorCode.NotFound"/>, so a caller
/// never learns whether a squad they cannot access exists (Requirements 10.3, 10.5).</item>
/// <item>Because "own record" is decided by the recipient membership being backed by the caller's user
/// — never by membership state — a member inactivated by a <c>RemovedFromSquad</c> event may still read
/// and count their own records in that squad, including the removal notification itself
/// (Requirements 10.6, 4.4).</item>
/// </list>
/// <para>
/// The methods are pure: they read only their resolved inputs and never mutate state, so a failure
/// leaves every record unchanged. Callers resolve the record (via a user-scoped repository lookup) or
/// the squad-membership probe first, then pass the result here so the gate stays free of persistence
/// concerns.
/// </para>
/// </summary>
internal static class NotificationAuthorization
{
    /// <summary>
    /// The single, non-disclosing message returned for every not-found failure. It is identical whether
    /// the record does not exist, is not backed by the caller, or lives in a squad the caller cannot
    /// access, so existence is never disclosed (Requirements 10.1, 10.3, 10.5).
    /// </summary>
    private const string UniformNotFoundMessage = "The requested notification was not found.";

    /// <summary>The message returned when a request arrives without an authenticated caller.</summary>
    private const string UnauthenticatedMessage = "Authentication is required to read notifications.";

    /// <summary>
    /// Requires an authenticated caller. A <see langword="null"/> or empty <paramref name="callerUserId"/>
    /// — meaning no authenticated user is present — is rejected with
    /// <see cref="NotificationErrorCode.Unauthenticated"/>, disclosing nothing and changing nothing
    /// (Requirement 10.2).
    /// </summary>
    /// <param name="callerUserId">The authenticated caller's user id, or <see langword="null"/> when the request is unauthenticated.</param>
    /// <returns><see cref="Result.Ok"/> when an authenticated caller is present; otherwise the authentication failure.</returns>
    public static Result RequireAuthenticated(Guid? callerUserId) =>
        callerUserId is { } id && id != Guid.Empty ? Result.Ok() : Unauthenticated();

    /// <summary>
    /// Requires that the resolved <paramref name="record"/> is backed by the caller. Callers resolve the
    /// record through a user-scoped lookup (for example
    /// <see cref="INotificationRepository.GetForUserAsync"/>), which yields <see langword="null"/> when the
    /// record does not exist or is not backed by the caller; both cases are rejected here with the single
    /// uniform, non-disclosing <see cref="NotificationErrorCode.NotFound"/> so existence is never revealed
    /// (Requirements 10.1, 10.4, 10.5). A record owned by an inactive-by-removal membership backed by the
    /// caller is a valid own record and passes (Requirement 10.6).
    /// </summary>
    /// <param name="record">The record resolved by a caller-scoped lookup, or <see langword="null"/> when absent or not the caller's.</param>
    /// <returns><see cref="Result.Ok"/> when the record is the caller's own; otherwise the uniform not-found failure.</returns>
    public static Result RequireOwnRecord(InAppNotification? record) =>
        record is not null ? Result.Ok() : NotFound();

    /// <summary>
    /// Requires that the caller can access a squad-scoped request. Callers probe whether the caller holds
    /// a membership of <b>any</b> state (whether <c>Active</c> or <c>Inactive</c>) in the target squad —
    /// for example through <see cref="INotificationRepository.UserHasMembershipInSquadAsync"/> — and pass
    /// the outcome here. A caller with no membership in that squad is rejected with the same uniform,
    /// non-disclosing <see cref="NotificationErrorCode.NotFound"/>, so a caller never learns whether the
    /// squad exists (Requirements 10.3, 10.5). Because membership of any state suffices, a member
    /// inactivated by removal retains access to their own records in that squad (Requirement 10.6).
    /// </summary>
    /// <param name="callerHoldsMembershipInSquad"><see langword="true"/> when the caller holds a membership of any state in the target squad.</param>
    /// <returns><see cref="Result.Ok"/> when the caller can access the squad scope; otherwise the uniform not-found failure.</returns>
    public static Result RequireSquadScope(bool callerHoldsMembershipInSquad) =>
        callerHoldsMembershipInSquad ? Result.Ok() : NotFound();

    private static Result Unauthenticated() =>
        Result.Fail(new Domain.Notifications.NotificationError(
            Domain.Notifications.NotificationErrorCode.Unauthenticated, UnauthenticatedMessage));

    private static Result NotFound() =>
        Result.Fail(new Domain.Notifications.NotificationError(
            Domain.Notifications.NotificationErrorCode.NotFound, UniformNotFoundMessage));
}
