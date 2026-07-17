using PitchMate.Domain.Notifications;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Notifications;

/// <summary>
/// The notification persistence surface: recipient targeting, the own-records-only read model, and the
/// GDPR/lifecycle removals. Declared in Application over Domain/BCL types only and implemented in
/// Infrastructure over the <c>PitchMateDbContext</c>, sharing the request's unit-of-work transaction
/// (Requirements 5.6, 13.2). Read queries join <see cref="InAppNotification.RecipientMembershipId"/> to
/// <see cref="SquadMembership"/> so a caller only ever sees records backed by their own user, and never
/// discloses data for squads the caller cannot access.
/// </summary>
public interface INotificationRepository
{
    /// <summary>Stages an insert of <paramref name="notification"/>; the row is written on the unit-of-work commit.</summary>
    /// <param name="notification">The in-app notification to add.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    Task AddAsync(InAppNotification notification, CancellationToken ct);

    /// <summary>
    /// Resolves the broadcast target set: the owning squad's registered (user-backed) memberships whose
    /// state is <c>Active</c> at the publish instant. Returns an empty list when none match
    /// (Requirement 4.2).
    /// </summary>
    /// <param name="squadId">The owning squad whose active registered memberships are resolved.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns>The squad's active registered memberships, or an empty list.</returns>
    Task<IReadOnlyList<SquadMembership>> ListActiveRegisteredAsync(Guid squadId, CancellationToken ct);

    /// <summary>
    /// Resolves the directed target set: those <paramref name="ids"/> that are registered memberships of
    /// the owning squad, including a membership that became <c>Inactive</c> as a result of the very event
    /// being notified (as for <c>RemovedFromSquad</c>). Ids that are not registered memberships of the
    /// squad are dropped. Returns an empty list when none match (Requirements 4.3, 4.4).
    /// </summary>
    /// <param name="squadId">The owning squad in which the supplied ids are resolved.</param>
    /// <param name="ids">The caller-supplied affected membership ids.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns>The resolved registered memberships, or an empty list.</returns>
    Task<IReadOnlyList<SquadMembership>> ResolveRegisteredAsync(Guid squadId, IReadOnlyCollection<Guid> ids, CancellationToken ct);

    /// <summary>
    /// Lists the caller's own notifications — records whose recipient membership is backed by
    /// <paramref name="userId"/> — ordered by creation instant descending then id descending for a stable
    /// total order, capped at <paramref name="limit"/> and optionally scoped to a single
    /// <paramref name="squadId"/>. Returns an empty list when none match (Requirements 9.1, 9.2, 9.4, 9.9, 9.10).
    /// </summary>
    /// <param name="userId">The backing user whose own records are listed.</param>
    /// <param name="squadId">An optional squad to scope the listing to, or <see langword="null"/> for all squads.</param>
    /// <param name="limit">The maximum number of most-recent records to return.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns>The caller's own notifications in stable order, or an empty list.</returns>
    Task<IReadOnlyList<InAppNotification>> ListForUserAsync(Guid userId, Guid? squadId, int limit, CancellationToken ct);

    /// <summary>
    /// Counts the caller's own <c>Unread</c> notifications — records backed by <paramref name="userId"/> —
    /// optionally scoped to a single <paramref name="squadId"/>. Returns <c>0</c> when none match
    /// (Requirements 9.3, 9.4, 9.8).
    /// </summary>
    /// <param name="userId">The backing user whose own unread records are counted.</param>
    /// <param name="squadId">An optional squad to scope the count to, or <see langword="null"/> for all squads.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns>The exact count of the caller's own unread records in scope.</returns>
    Task<int> CountUnreadForUserAsync(Guid userId, Guid? squadId, CancellationToken ct);

    /// <summary>
    /// Retrieves the notification identified by <paramref name="notificationId"/> only when it is backed by
    /// <paramref name="userId"/>, or <see langword="null"/> otherwise so existence is never disclosed for a
    /// record the caller does not own (Requirements 9.5, 10.1).
    /// </summary>
    /// <param name="notificationId">The notification identity to look up.</param>
    /// <param name="userId">The backing user the record must belong to.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns>The caller's matching notification, or <see langword="null"/>.</returns>
    Task<InAppNotification?> GetForUserAsync(Guid notificationId, Guid userId, CancellationToken ct);

    /// <summary>
    /// Lists the caller's own <c>Unread</c> notifications — records backed by <paramref name="userId"/> —
    /// optionally scoped to a single <paramref name="squadId"/>, so the mark-all-read use case can flip
    /// exactly those records. Returns an empty list when none match (Requirements 9.6, 9.7).
    /// </summary>
    /// <param name="userId">The backing user whose own unread records are listed.</param>
    /// <param name="squadId">An optional squad to scope the listing to, or <see langword="null"/> for all squads.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns>The caller's own unread notifications in scope, or an empty list.</returns>
    Task<IReadOnlyList<InAppNotification>> ListUnreadForUserAsync(Guid userId, Guid? squadId, CancellationToken ct);

    /// <summary>
    /// Determines whether <paramref name="userId"/> holds a membership of any state in
    /// <paramref name="squadId"/>, so a squad-scoped read over a squad the caller cannot access returns the
    /// same non-disclosing result. Returns <see langword="false"/> when the user backs no membership there
    /// (Requirement 10.4).
    /// </summary>
    /// <param name="userId">The backing user.</param>
    /// <param name="squadId">The squad whose membership is probed.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns><see langword="true"/> when the user holds a membership of any state in the squad; otherwise <see langword="false"/>.</returns>
    Task<bool> UserHasMembershipInSquadAsync(Guid userId, Guid squadId, CancellationToken ct);

    /// <summary>
    /// Permanently removes every notification whose recipient membership is backed by the erased
    /// <paramref name="userId"/>, across all squads and regardless of read state, bypassing soft-delete so
    /// the rows are genuinely deleted on the unit-of-work commit. Idempotent on an empty scope
    /// (Requirements 11.1, 11.7, 11.8).
    /// </summary>
    /// <param name="userId">The erased user whose notifications are removed.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    Task RemoveForUserAsync(Guid userId, CancellationToken ct);

    /// <summary>
    /// Permanently removes every notification addressed to the anonymised membership identified by
    /// <paramref name="membershipId"/>, bypassing soft-delete. Idempotent on an empty scope
    /// (Requirements 11.2, 11.7, 11.8).
    /// </summary>
    /// <param name="membershipId">The membership whose notifications are removed.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    Task RemoveForMembershipAsync(Guid membershipId, CancellationToken ct);

    /// <summary>
    /// Permanently removes every notification owned by the purged squad identified by
    /// <paramref name="squadId"/>, bypassing soft-delete. Idempotent on an empty scope
    /// (Requirements 11.3, 11.7, 11.8).
    /// </summary>
    /// <param name="squadId">The purged squad whose notifications are removed.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    Task RemoveForSquadAsync(Guid squadId, CancellationToken ct);
}
