using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Soft-deletes a squad on the owner's request, setting a purge instant a grace period ahead of the
/// clock (Requirement 17.1). The handler resolves the acting membership from the authenticated user
/// and the target squad and gates it through <see cref="SquadAuthorization.RequireOwner"/>, so only
/// the active owner may delete; every other actor — an admin, member, inactive membership, guest
/// membership (which holds no role), or non-member — is rejected with the uniform authorisation
/// failure and the squad is left unchanged (Requirement 17.6).
/// <para>
/// The grace period is validated to the inclusive 1..90 whole-day range, defaulting to
/// <see cref="Squad.DefaultGracePeriodDays"/> when none is supplied (Requirement 17.8). If the squad
/// is already soft-deleted the request is idempotent: the existing deletion mark and purge instant are
/// left unchanged and success is reported with that instant (Requirement 17.7). Otherwise the handler
/// records the purge instant on the squad and stages a soft-delete, which the persistence layer applies
/// within one <see cref="IUnitOfWork.SaveChangesAsync"/>, so that if the commit fails the squad remains
/// not deleted and nothing is persisted (Requirement 17.1).
/// </para>
/// </summary>
public sealed class DeleteSquadHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly IRepository<Squad> _squadStore;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;

    /// <summary>
    /// Creates the handler with the membership repository it authorises the owner through, the squad
    /// repository it loads the (possibly already-deleted) squad from, the generic squad store it stages
    /// the soft-delete through, the unit of work it commits with, and the clock it derives the purge
    /// instant from.
    /// </summary>
    public DeleteSquadHandler(
        ISquadMembershipRepository memberships,
        ISquadRepository squads,
        IRepository<Squad> squadStore,
        IUnitOfWork unitOfWork,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(squadStore);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);

        _memberships = memberships;
        _squads = squads;
        _squadStore = squadStore;
        _unitOfWork = unitOfWork;
        _clock = clock;
    }

    /// <summary>
    /// Handles a <see cref="DeleteSquadCommand"/>, returning the purge instant on success (including
    /// the idempotent already-deleted case), or a typed <see cref="SquadError"/> when the actor is not
    /// the owner or the grace period is out of range.
    /// </summary>
    /// <param name="command">The deletion request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<DeleteSquadResult>> HandleAsync(
        DeleteSquadCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only the active owner may delete the squad; every other actor is rejected uniformly and the
        // squad is left unchanged (Requirement 17.6).
        Result gate = SquadAuthorization.RequireOwner(acting);
        if (!gate.IsSuccess)
        {
            return Result<DeleteSquadResult>.Fail(gate.Error!);
        }

        // Validate the grace period (whole days, inclusive 1..90, default 30) (Requirement 17.8).
        int gracePeriodDays = command.GracePeriodDays ?? Squad.DefaultGracePeriodDays;
        if (gracePeriodDays < Squad.GracePeriodMinDays || gracePeriodDays > Squad.GracePeriodMaxDays)
        {
            return Fail(
                SquadErrorCode.ValidationFailed,
                $"The grace period must be {Squad.GracePeriodMinDays} to {Squad.GracePeriodMaxDays} whole days.");
        }

        // Load the squad including a soft-deleted one so the idempotent re-deletion path can observe an
        // existing deletion (Requirement 17.7). A missing squad yields the uniform failure so its
        // (non-)existence is never disclosed.
        Squad? squad = await _squads.GetByIdIncludingDeletedAsync(command.SquadId, cancellationToken);
        if (squad is null)
        {
            return Result<DeleteSquadResult>.Fail(SquadAuthorization.RequireOwner(null).Error!);
        }

        // An already-soft-deleted squad is idempotent: leave the existing deletion mark and purge
        // instant unchanged and report success (Requirement 17.7).
        if (squad.IsPendingDeletion)
        {
            return Result<DeleteSquadResult>.Ok(new DeleteSquadResult(squad.PurgeAt ?? _clock.GetUtcNow()));
        }

        // Record the purge instant (clock + grace period) and stage the soft-delete; the persistence
        // layer applies the soft-delete flag within the commit (Requirement 17.1).
        DateTimeOffset purgeAt = _clock.GetUtcNow().AddDays(gracePeriodDays);
        squad.MarkForDeletion(purgeAt);
        _squadStore.Remove(squad);

        // Commit the mark + soft-delete atomically; a failure leaves the squad not deleted (Requirement 17.1).
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<DeleteSquadResult>.Ok(new DeleteSquadResult(purgeAt));
    }

    private static Result<DeleteSquadResult> Fail(SquadErrorCode code, string message) =>
        Result<DeleteSquadResult>.Fail(new SquadError(code, message));
}
