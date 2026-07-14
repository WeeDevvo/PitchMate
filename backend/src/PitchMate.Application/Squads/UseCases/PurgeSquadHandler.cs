using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Purges every squad whose grace period has elapsed: when the clock reaches or passes a
/// soft-deleted squad's purge instant, the squad and its memberships are permanently removed, subject
/// to the anonymisation-over-deletion rule for memberships that carry match history (Requirement
/// 17.5, 18). This is a maintenance operation driven by the clock rather than a per-request action,
/// so it takes no acting user and no authorisation gate — reaching the purge instant is itself the
/// trigger.
/// <para>
/// For each due squad the handler applies the same anonymise-vs-remove branch as membership erasure,
/// driven by <see cref="IMembershipHistoryProbe"/>: a membership that carries match history is
/// anonymised via <see cref="SquadMembership.Anonymise"/> and its de-identified row retained so
/// chronological rating replay stays valid (Requirement 18.1, 18.7), while a membership with no
/// history is permanently removed (Requirement 18.2). The squad row itself is then permanently
/// removed via <see cref="ISquadRepository.RemovePermanently"/> — a genuine delete rather than the
/// soft-delete the standard remove pipeline applies (Requirement 17.5). All the work for the run is
/// committed in a single <see cref="IUnitOfWork.SaveChangesAsync"/>, so a failure persists none of it
/// and the squads remain due for the next run.
/// </para>
/// </summary>
public sealed class PurgeSquadHandler
{
    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IMembershipHistoryProbe _history;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;

    /// <summary>
    /// Creates the handler with the squad repository it lists due squads and removes them through, the
    /// membership repository it enumerates and stages each squad's memberships with, the history probe
    /// that decides anonymise-vs-remove, the unit of work it commits with, and the clock it reads the
    /// current instant from to select due squads.
    /// </summary>
    public PurgeSquadHandler(
        ISquadRepository squads,
        ISquadMembershipRepository memberships,
        IMembershipHistoryProbe history,
        IUnitOfWork unitOfWork,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(history);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);

        _squads = squads;
        _memberships = memberships;
        _history = history;
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
    /// Stages the permanent removal of one due squad and each of its memberships, anonymising and
    /// retaining any membership that carries match history rather than removing it (Requirement 17.5,
    /// 18.1, 18.2, 18.7). The staged changes are committed by the caller.
    /// </summary>
    private async Task PurgeSquadAsync(Squad squad, CancellationToken cancellationToken)
    {
        IReadOnlyList<SquadMembership> memberships =
            await _memberships.ListForSquadAsync(squad.Id, activeOnly: false, cancellationToken);

        foreach (SquadMembership membership in memberships)
        {
            if (await _history.HasMatchHistoryAsync(membership.Id, cancellationToken))
            {
                membership.Anonymise();
            }
            else
            {
                _memberships.RemovePermanently(membership);
            }
        }

        _squads.RemovePermanently(squad);
    }
}
