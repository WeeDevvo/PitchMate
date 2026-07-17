using PitchMate.Application.Common.Persistence;
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

    /// <summary>
    /// Creates the handler with the squad repository it lists due squads and removes them through, the
    /// membership repository it enumerates and stages each squad's memberships with, the unit of work
    /// it commits with, and the clock it reads the current instant from to select due squads.
    /// </summary>
    public PurgeSquadHandler(
        ISquadRepository squads,
        ISquadMembershipRepository memberships,
        IUnitOfWork unitOfWork,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);

        _squads = squads;
        _memberships = memberships;
        _unitOfWork = unitOfWork;
        _clock = clock;
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
        return Result<int>.Ok(due.Count);
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
