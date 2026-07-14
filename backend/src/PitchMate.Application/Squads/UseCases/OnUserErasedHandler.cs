using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Applies the erasure-by-anonymisation rule across every membership backed by an erased user, so no
/// membership retains identifying data about that user (Requirement 18.3, 18.4). For each of the
/// user's memberships the handler branches on <see cref="IMembershipHistoryProbe"/>: a membership
/// that carries match history is anonymised via <see cref="SquadMembership.Anonymise"/> — clearing
/// its backing user reference and stripping its display name while retaining the de-identified row
/// and its rating/match-history links so chronological rating replay still holds (Requirement 18.3,
/// 18.7) — while a membership with no history is permanently removed (Requirement 18.4).
/// <para>
/// Erasure must never leave a squad without an owner: if the user owns any squad that is not itself
/// being deleted, the whole operation is rejected with <see cref="SquadErrorCode.OwnerConstraint"/>
/// and nothing is changed until ownership is transferred (Requirement 18.5, 18.6). The auth path is
/// expected to have transferred ownership first; this guard is the backstop that upholds the
/// single-owner invariant. All the memberships are staged together and committed atomically through
/// <see cref="IUnitOfWork.SaveChangesAsync"/>, so a failure persists none of the changes.
/// </para>
/// </summary>
public sealed class OnUserErasedHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly IMembershipHistoryProbe _history;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the membership repository it lists and stages the user's memberships
    /// through, the squad repository it checks owned-squad deletion state with, the history probe that
    /// decides anonymise-vs-remove, and the unit of work it commits with.
    /// </summary>
    public OnUserErasedHandler(
        ISquadMembershipRepository memberships,
        ISquadRepository squads,
        IMembershipHistoryProbe history,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(history);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _memberships = memberships;
        _squads = squads;
        _history = history;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles an <see cref="OnUserErasedCommand"/>, returning success once every membership the user
    /// backs is anonymised or removed, or a typed <see cref="SquadError"/> when the user still owns a
    /// squad that is not being deleted. A user who backs no membership succeeds with nothing to do.
    /// </summary>
    /// <param name="command">The user-erased notification.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(OnUserErasedCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        IReadOnlyList<SquadMembership> memberships =
            await _memberships.ListForUserAsync(command.UserId, cancellationToken);

        if (memberships.Count == 0)
        {
            return Result.Ok();
        }

        // Validate the owner-orphan rule across all memberships first, so a blocking owner leaves the
        // entire operation a no-op and nothing is partially erased (Requirement 18.5, 18.6).
        foreach (SquadMembership membership in memberships)
        {
            Result ownerGuard = await GuardOwnerNotOrphanedAsync(membership, cancellationToken);
            if (!ownerGuard.IsSuccess)
            {
                return ownerGuard;
            }
        }

        // Apply the anonymise-vs-remove rule to each membership, then commit them together
        // (Requirement 18.3, 18.4).
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

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }

    /// <summary>
    /// Rejects erasing an <see cref="SquadRole.Owner"/> membership whose squad still exists and is not
    /// pending deletion, upholding the single-owner invariant (Requirement 18.5, 18.6). A non-owner,
    /// or an owner whose squad is already pending deletion (or gone), passes.
    /// </summary>
    private async Task<Result> GuardOwnerNotOrphanedAsync(SquadMembership membership, CancellationToken cancellationToken)
    {
        if (membership.Role != SquadRole.Owner)
        {
            return Result.Ok();
        }

        Squad? squad = await _squads.GetByIdIncludingDeletedAsync(membership.SquadId, cancellationToken);
        if (squad is not null && !squad.IsPendingDeletion)
        {
            return Result.Fail(new SquadError(
                SquadErrorCode.OwnerConstraint,
                "Ownership of a live squad must be transferred before the owning user can be erased."));
        }

        return Result.Ok();
    }
}
