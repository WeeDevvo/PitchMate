using Microsoft.Extensions.Logging;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Notifications;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Purges every squad whose grace period has elapsed: when the clock reaches or passes a
/// soft-deleted squad's purge instant, the squad and <b>all</b> of its memberships are permanently
/// removed (Requirement 17.5). This is a maintenance operation driven by the clock rather than a
/// per-request action, so it takes no acting user and no authorisation gate — reaching the purge
/// instant is itself the trigger.
/// <para>
/// A full squad purge is total destruction: the squad and its entire match history are removed
/// together. The anonymisation-over-deletion rule in Requirement 18 exists to keep <i>surviving</i>
/// matches and rating replay valid when an individual membership or user is erased from a squad that
/// lives on (see <see cref="EraseMembershipHandler"/> / <see cref="OnUserErasedHandler"/>); it does
/// <b>not</b> apply to a squad purge, where nothing survives to keep valid. Retaining an anonymised
/// membership would also be impossible: a membership row carries a required foreign key to its squad,
/// so it cannot outlive a hard-deleted squad. Every membership of the purged squad is therefore
/// permanently removed via <see cref="ISquadMembershipRepository.RemovePermanently"/>, and the squad
/// row itself via <see cref="ISquadRepository.RemovePermanently"/> — genuine deletes rather than the
/// soft-delete the standard remove pipeline applies. All the work for the run is committed in a single
/// <see cref="IUnitOfWork.SaveChangesAsync"/>, so a failure persists none of it and the squads remain
/// due for the next run.
/// </para>
/// </summary>
public sealed class PurgeSquadHandler
{
    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;
    private readonly RemoveNotificationsForSquadHandler? _removeNotifications;
    private readonly ILogger<PurgeSquadHandler>? _logger;

    /// <summary>
    /// Creates the handler with the squad repository it lists due squads and removes them through, the
    /// membership repository it enumerates and stages each squad's memberships with, the unit of work
    /// it commits with, and the clock it reads the current instant from to select due squads. The
    /// notification removal handler and logger are optional collaborators used only for the best-effort
    /// removal of each purged squad's in-app notifications after a committed purge; production wiring
    /// supplies both, and they are left absent in tests that exercise only the purge itself
    /// (notifications Requirements 11.3, 11.6).
    /// </summary>
    public PurgeSquadHandler(
        ISquadRepository squads,
        ISquadMembershipRepository memberships,
        IUnitOfWork unitOfWork,
        TimeProvider clock,
        RemoveNotificationsForSquadHandler? removeNotifications = null,
        ILogger<PurgeSquadHandler>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);

        _squads = squads;
        _memberships = memberships;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _removeNotifications = removeNotifications;
        _logger = logger;
    }

    /// <summary>
    /// Purges every squad due at the current clock instant, returning the number of squads purged
    /// (zero when none are due). The run commits once; on a save failure nothing is persisted and the
    /// squads remain due for a later run.
    /// </summary>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<int>> HandleAsync(CancellationToken cancellationToken)
    {
        DateTimeOffset now = _clock.GetUtcNow();

        IReadOnlyList<Squad> due = await _squads.ListPurgeDueAsync(now, cancellationToken);
        if (due.Count == 0)
        {
            return Result<int>.Ok(0);
        }

        foreach (Squad squad in due)
        {
            await PurgeSquadAsync(squad, cancellationToken);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // Only after the purge has committed do we remove each purged squad's in-app notifications,
        // which carry no match-history integrity requirement and are therefore deleted rather than
        // anonymised (notifications Requirements 11.3, 11.6). The removals run on their own unit of work
        // and never touch match or rating-replay data; any failure is logged (identifiers only) and
        // swallowed so it can never roll back or surface through the committed purge.
        foreach (Squad squad in due)
        {
            await RemoveNotificationsForPurgedSquadAsync(squad.Id, cancellationToken);
        }

        return Result<int>.Ok(due.Count);
    }

    /// <summary>
    /// Best-effort removal of every in-app notification owned by a purged squad (notifications
    /// Requirement 11.3). Mirrors the way the squad lifecycle hooks are wired: it runs only after the
    /// purge has committed, is isolated on its own unit of work, and swallows every failure — logging
    /// identifiers only, never any PII — so a notifications-side problem never undoes the purge.
    /// </summary>
    private async Task RemoveNotificationsForPurgedSquadAsync(Guid squadId, CancellationToken cancellationToken)
    {
        if (_removeNotifications is null)
        {
            return;
        }

        try
        {
            var removal = await _removeNotifications.HandleAsync(squadId, cancellationToken);
            if (!removal.IsSuccess)
            {
                _logger?.LogWarning(
                    "In-app notification removal for purged squad failed (isolated; purge stays committed). "
                    + "SquadId={SquadId}, Reason={Reason}",
                    squadId, removal.Error?.Code);
            }
        }
        catch (Exception ex) when (ex is not OutOfMemoryException and not StackOverflowException)
        {
            _logger?.LogWarning(
                ex,
                "In-app notification removal for purged squad threw (isolated; purge stays committed). "
                + "SquadId={SquadId}",
                squadId);
        }
    }

    /// <summary>
    /// Stages the permanent removal of one due squad and every one of its memberships (Requirement
    /// 17.5). A full squad purge destroys the squad and its entire match history together, so —
    /// unlike individual erasure — no membership is anonymised or retained. The staged changes are
    /// committed by the caller.
    /// </summary>
    private async Task PurgeSquadAsync(Squad squad, CancellationToken cancellationToken)
    {
        IReadOnlyList<SquadMembership> memberships =
            await _memberships.ListForSquadAsync(squad.Id, activeOnly: false, cancellationToken);

        foreach (SquadMembership membership in memberships)
        {
            _memberships.RemovePermanently(membership);
        }

        _squads.RemovePermanently(squad);
    }
}
