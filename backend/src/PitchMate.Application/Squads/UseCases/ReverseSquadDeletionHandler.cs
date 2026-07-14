using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Reverses a squad's soft-deletion before its purge instant, restoring the squad to its pre-deletion
/// state (Requirement 17.4). The handler resolves the acting membership from the authenticated user and
/// the target squad and gates it through <see cref="SquadAuthorization.RequireOwner"/>, so only the
/// active owner may reverse; every other actor is rejected with the uniform authorisation failure and
/// nothing changes (Requirement 4.4, 4.5).
/// <para>
/// It loads the squad including a soft-deleted one so the pending-deletion state is observable. A squad
/// that is not pending deletion is already in its pre-deletion state, so the request is treated as
/// idempotent and reports success without a change. Otherwise the handler clears the purge instant and
/// stages a restore, which the persistence layer applies within one
/// <see cref="IUnitOfWork.SaveChangesAsync"/>; because the reversal only clears the deletion mark and
/// purge instant, every membership, membership state, role, display name, and feature-flag state is left
/// intact and comes back exactly as before (Requirement 17.4). If the commit fails nothing is persisted
/// and the squad remains soft-deleted.
/// </para>
/// </summary>
public sealed class ReverseSquadDeletionHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly IRepository<Squad> _squadStore;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the membership repository it authorises the owner through, the squad
    /// repository it loads the soft-deleted squad from, the generic squad store it stages the restore
    /// through, and the unit of work it commits with.
    /// </summary>
    public ReverseSquadDeletionHandler(
        ISquadMembershipRepository memberships,
        ISquadRepository squads,
        IRepository<Squad> squadStore,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(squadStore);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _memberships = memberships;
        _squads = squads;
        _squadStore = squadStore;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles a <see cref="ReverseSquadDeletionCommand"/>, returning success once the squad is restored
    /// (including the idempotent not-deleted case), or a typed <see cref="SquadError"/> when the actor is
    /// not the owner.
    /// </summary>
    /// <param name="command">The reversal request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(
        ReverseSquadDeletionCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only the active owner may reverse the deletion; every other actor is rejected uniformly
        // (Requirement 4.4, 4.5).
        Result gate = SquadAuthorization.RequireOwner(acting);
        if (!gate.IsSuccess)
        {
            return gate;
        }

        // Load the squad including a soft-deleted one so the pending-deletion state is observable
        // (Requirement 17.4). A missing squad yields the uniform failure so its (non-)existence is
        // never disclosed.
        Squad? squad = await _squads.GetByIdIncludingDeletedAsync(command.SquadId, cancellationToken);
        if (squad is null)
        {
            return SquadAuthorization.RequireOwner(null);
        }

        // A squad that is not pending deletion is already in its pre-deletion state; treat the request
        // as idempotent and report success without a change.
        if (!squad.IsPendingDeletion)
        {
            return Result.Ok();
        }

        // Clear the purge instant and stage the restore; the persistence layer clears the soft-delete
        // flag within the commit, bringing every membership, role, display name, and feature-flag state
        // back intact (Requirement 17.4).
        squad.CancelDeletion();
        _squadStore.Restore(squad);

        // Commit the reversal atomically; a failure leaves the squad soft-deleted (Requirement 17.4).
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return Result.Ok();
    }
}
