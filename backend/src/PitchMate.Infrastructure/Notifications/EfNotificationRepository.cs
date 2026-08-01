using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Auth;
using PitchMate.Domain.Notifications;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Notifications;

/// <summary>
/// EF Core implementation of <see cref="INotificationRepository"/> over the shared
/// <see cref="PitchMateDbContext"/>. Registered scoped so it shares the request's unit-of-work
/// transaction: adds are staged on the change tracker and committed by the surrounding
/// <c>IUnitOfWork.SaveChangesAsync</c> (Requirements 5.6, 13.2).
/// <para>
/// The targeting and read queries join <see cref="InAppNotification.RecipientMembershipId"/> to
/// <see cref="SquadMembership"/> and enforce three rules in the database: <b>registered-only</b> (the
/// recipient membership is backed by a non-null <see cref="SquadMembership.UserId"/>),
/// <b>own-records-only</b> (that backing user equals the caller), and an optional <b>squad scope</b>
/// (Requirements 4.1, 9.1, 9.3, 10.4). Listing orders by <see cref="Domain.Common.BaseEntity.CreatedAt"/>
/// descending then <see cref="Domain.Common.BaseEntity.Id"/> descending; PostgreSQL sorts
/// <c>uuid</c> values in canonical big-endian order, which for GUID v7 identifiers is creation order,
/// so the pair forms a stable total order matching the in-memory <c>UuidV7Comparer</c>
/// (Requirements 9.1, 12.7).
/// </para>
/// <para>
/// Lifecycle removals hard-delete via the context's <see cref="PitchMateDbContext.MarkForHardDelete"/>
/// marker so records are genuinely deleted rather than soft-deleted, matching the squad erasure/purge
/// path; each is idempotent on an empty scope (Requirements 11.1, 11.2, 11.3).
/// </para>
/// </summary>
internal sealed class EfNotificationRepository(PitchMateDbContext db) : INotificationRepository
{
    /// <inheritdoc />
    public async Task AddAsync(InAppNotification notification, CancellationToken ct)
        => await db.Set<InAppNotification>().AddAsync(notification, ct);

    /// <inheritdoc />
    public async Task<IReadOnlyList<SquadMembership>> ListActiveRegisteredAsync(Guid squadId, CancellationToken ct)
        // Broadcast targeting: the owning squad's registered (user-backed) memberships that are Active
        // at the publish instant (Requirement 4.2).
        => await db.Set<SquadMembership>()
            .Where(membership => membership.SquadId == squadId
                && membership.UserId != null
                && membership.State == MembershipState.Active)
            .ToListAsync(ct);

    /// <inheritdoc />
    public async Task<IReadOnlyList<SquadMembership>> ResolveRegisteredAsync(
        Guid squadId, IReadOnlyCollection<Guid> ids, CancellationToken ct)
    {
        if (ids.Count == 0)
        {
            return [];
        }

        // Directed targeting: those supplied ids that are registered memberships of the owning squad,
        // in any state (so a membership made Inactive by the very event being notified still resolves).
        // Ids that are not registered memberships of the squad are dropped (Requirements 4.3, 4.4).
        return await db.Set<SquadMembership>()
            .Where(membership => membership.SquadId == squadId
                && membership.UserId != null
                && ids.Contains(membership.Id))
            .ToListAsync(ct);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyDictionary<Guid, string>> ResolveRecipientEmailsAsync(
        Guid squadId, IReadOnlyCollection<Guid> membershipIds, CancellationToken ct)
    {
        if (membershipIds.Count == 0)
        {
            return new Dictionary<Guid, string>();
        }

        // Join each recipient membership of the owning squad to its backing user in one query so
        // best-effort email dispatch avoids an N+1 per-recipient lookup. Only a membership whose user
        // has a deliverable (non-null, non-empty) email is included; guests and out-of-squad ids never
        // match (Requirement 6.6).
        var pairs = await db.Set<SquadMembership>()
            .Where(membership => membership.SquadId == squadId
                && membership.UserId != null
                && membershipIds.Contains(membership.Id))
            .Join(
                db.Set<User>(),
                membership => membership.UserId,
                user => user.Id,
                (membership, user) => new { membership.Id, user.Email })
            .Where(pair => pair.Email != null && pair.Email != string.Empty)
            .ToListAsync(ct);

        // A membership resolves to exactly one user, so the keys are unique.
        return pairs.ToDictionary(pair => pair.Id, pair => pair.Email);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<InAppNotification>> ListForUserAsync(
        Guid userId, Guid? squadId, int limit, CancellationToken ct)
        => await OwnRecords(userId, squadId)
            .OrderByDescending(notification => notification.CreatedAt)
            .ThenByDescending(notification => notification.Id)
            .Take(limit)
            .ToListAsync(ct);

    /// <inheritdoc />
    public Task<int> CountUnreadForUserAsync(Guid userId, Guid? squadId, CancellationToken ct)
        => OwnRecords(userId, squadId)
            .Where(notification => notification.ReadState == ReadState.Unread)
            .CountAsync(ct);

    /// <inheritdoc />
    public Task<InAppNotification?> GetForUserAsync(Guid notificationId, Guid userId, CancellationToken ct)
        // Resolve only when the record is backed by the caller, so existence is never disclosed for a
        // record the caller does not own (Requirements 9.5, 10.1).
        => OwnRecords(userId, squadId: null)
            .FirstOrDefaultAsync(notification => notification.Id == notificationId, ct);

    /// <inheritdoc />
    public async Task<IReadOnlyList<InAppNotification>> ListUnreadForUserAsync(
        Guid userId, Guid? squadId, CancellationToken ct)
        => await OwnRecords(userId, squadId)
            .Where(notification => notification.ReadState == ReadState.Unread)
            .ToListAsync(ct);

    /// <inheritdoc />
    public Task<bool> UserHasMembershipInSquadAsync(Guid userId, Guid squadId, CancellationToken ct)
        // Any-state membership backing the user in the squad, so a squad-scoped read over a squad the
        // caller cannot access returns the same non-disclosing result (Requirement 10.4).
        => db.Set<SquadMembership>()
            .AnyAsync(membership => membership.UserId == userId && membership.SquadId == squadId, ct);

    /// <inheritdoc />
    public async Task RemoveForUserAsync(Guid userId, CancellationToken ct)
    {
        // Every notification whose recipient membership is backed by the erased user, across all squads
        // and regardless of read state (Requirement 11.1).
        var records = await db.Set<InAppNotification>()
            .Where(notification => db.Set<SquadMembership>()
                .Any(membership => membership.Id == notification.RecipientMembershipId
                    && membership.UserId == userId))
            .ToListAsync(ct);

        HardDelete(records);
    }

    /// <inheritdoc />
    public async Task RemoveForMembershipAsync(Guid membershipId, CancellationToken ct)
    {
        // Every notification addressed to the anonymised membership (Requirement 11.2).
        var records = await db.Set<InAppNotification>()
            .Where(notification => notification.RecipientMembershipId == membershipId)
            .ToListAsync(ct);

        HardDelete(records);
    }

    /// <inheritdoc />
    public async Task RemoveForSquadAsync(Guid squadId, CancellationToken ct)
    {
        // Every notification owned by the purged squad (Requirement 11.3).
        var records = await db.Set<InAppNotification>()
            .Where(notification => notification.SquadId == squadId)
            .ToListAsync(ct);

        HardDelete(records);
    }

    /// <summary>
    /// The caller's own notifications — records whose recipient membership is backed by
    /// <paramref name="userId"/> — optionally scoped to a single <paramref name="squadId"/>. Expressed
    /// as an EXISTS subquery so the registered-only and own-records-only rules are evaluated in the
    /// database (Requirements 9.1, 9.3, 10.4).
    /// </summary>
    private IQueryable<InAppNotification> OwnRecords(Guid userId, Guid? squadId)
    {
        IQueryable<InAppNotification> query = db.Set<InAppNotification>()
            .Where(notification => db.Set<SquadMembership>()
                .Any(membership => membership.Id == notification.RecipientMembershipId
                    && membership.UserId == userId));

        if (squadId is { } scope)
        {
            query = query.Where(notification => notification.SquadId == scope);
        }

        return query;
    }

    /// <summary>
    /// Stages a genuine, permanent delete of each record: an EF <see cref="EntityState.Deleted"/> state
    /// plus the context's permanent-delete marker so the save pipeline does not reinterpret it as a
    /// soft-delete (Requirements 11.1, 11.2, 11.3). Committed on the unit-of-work save; an empty
    /// collection is a no-op, keeping removal idempotent on an empty scope (Requirements 11.7, 11.8).
    /// </summary>
    private void HardDelete(IReadOnlyList<InAppNotification> records)
    {
        foreach (var record in records)
        {
            db.Set<InAppNotification>().Remove(record);
            db.MarkForHardDelete(record);
        }
    }
}
