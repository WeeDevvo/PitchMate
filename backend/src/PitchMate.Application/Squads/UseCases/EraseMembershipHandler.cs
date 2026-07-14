using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Erases a single squad membership under the UK GDPR erasure path, branching anonymise-vs-remove on
/// whether the membership carries match history (Requirement 18.1, 18.2). Because this spec does not
/// yet own the match entities, the branch is driven by <see cref="IMembershipHistoryProbe"/>: a
/// membership that carries at least one match-history link is anonymised via
/// <see cref="SquadMembership.Anonymise"/> — its display name is replaced with a non-identifying
/// placeholder, its normalised key cleared (freeing the former name and exempting the row from
/// uniqueness), and its backing user reference cleared, while the de-identified row and its rating
/// and match-history links are retained so chronological rating replay still holds (Requirement 18.1,
/// 18.7). A membership that carries no history is permanently removed (Requirement 18.2).
/// <para>
/// Erasure must never leave a squad without an owner: if the target holds
/// <see cref="SquadRole.Owner"/> of a squad that is not itself being deleted, the erasure is rejected
/// with <see cref="SquadErrorCode.OwnerConstraint"/> and the membership is left unchanged until
/// ownership is transferred (Requirement 18.5, 18.6). When the owner's squad is already pending
/// deletion (heading for purge) the guard does not apply, because the squad is going away regardless.
/// The single anonymise-or-remove change is committed through <see cref="IUnitOfWork.SaveChangesAsync"/>.
/// </para>
/// </summary>
public sealed class EraseMembershipHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly IMembershipHistoryProbe _history;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the membership repository it resolves and stages the target through,
    /// the squad repository it checks the owner's squad deletion state with, the history probe that
    /// decides anonymise-vs-remove, and the unit of work it commits with.
    /// </summary>
    public EraseMembershipHandler(
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
    /// Handles an <see cref="EraseMembershipCommand"/>, returning success once the membership is
    /// anonymised or removed, or a typed <see cref="SquadError"/> when the membership is unknown or is
    /// the owner of a squad that is not being deleted.
    /// </summary>
    /// <param name="command">The erasure request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(EraseMembershipCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? membership = await _memberships.GetByIdAsync(command.MembershipId, cancellationToken);
        if (membership is null)
        {
            return Result.Fail(new SquadError(
                SquadErrorCode.NotAMember,
                "The membership to erase does not exist."));
        }

        // Never orphan a squad: an owner of a squad that is not itself being deleted cannot be erased
        // until ownership is transferred (Requirement 18.5, 18.6).
        Result ownerGuard = await GuardOwnerNotOrphanedAsync(membership, cancellationToken);
        if (!ownerGuard.IsSuccess)
        {
            return ownerGuard;
        }

        await EraseAsync(membership, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }

    /// <summary>
    /// Rejects erasing an <see cref="SquadRole.Owner"/> membership whose squad still exists and is not
    /// pending deletion, so the single-owner invariant is never broken by erasure (Requirement 18.5,
    /// 18.6). A non-owner, or an owner whose squad is already pending deletion (or gone), passes.
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
                "Ownership must be transferred to another member before the owner can be erased."));
        }

        return Result.Ok();
    }

    /// <summary>
    /// Applies the anonymise-vs-remove rule to <paramref name="membership"/>: a membership with match
    /// history is anonymised and retained (Requirement 18.1, 18.7); one with no history is staged for
    /// permanent removal (Requirement 18.2). The change is committed by the caller.
    /// </summary>
    private async Task EraseAsync(SquadMembership membership, CancellationToken cancellationToken)
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
}
