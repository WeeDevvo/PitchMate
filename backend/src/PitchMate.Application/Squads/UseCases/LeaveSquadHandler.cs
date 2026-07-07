using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Lets a member leave their squad by setting the acting membership <see cref="MembershipState.Inactive"/>
/// while retaining its rating, stats, and match history (Requirement 7.1). The handler resolves the
/// acting membership from the authenticated user and the target squad; a user who holds no membership
/// there is rejected as not a member and nothing changes. The
/// <see cref="SquadMembership.Leave"/> domain method enforces the remaining rules — an owner is
/// rejected and must transfer ownership first (Requirement 7.2), and a membership that is already
/// inactive is treated as satisfied and reports success without a further change (Requirement 7.3).
/// <para>
/// Only a genuine active→inactive transition is committed through
/// <see cref="IUnitOfWork.SaveChangesAsync"/>; if the commit fails the membership remains
/// <see cref="MembershipState.Active"/> and nothing is persisted (Requirement 7.1). The idempotent
/// already-inactive case reports success without touching the store. Deactivation retains the row so
/// the membership is excluded from active lists and future selection while its display name stays
/// reserved until anonymisation (Requirement 7.4, 7.5).
/// </para>
/// </summary>
public sealed class LeaveSquadHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>Creates the handler with the membership repository it reads/stages through and the unit of work it commits with.</summary>
    public LeaveSquadHandler(ISquadMembershipRepository memberships, IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _memberships = memberships;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles a <see cref="LeaveSquadCommand"/>, returning success once the acting membership is
    /// inactive, or a typed <see cref="SquadError"/> when the actor is not a member or holds the
    /// owner role.
    /// </summary>
    /// <param name="command">The leave request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(LeaveSquadCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // A user with no membership in the squad cannot leave it.
        if (acting is null)
        {
            return Result.Fail(new SquadError(
                SquadErrorCode.NotAMember,
                "The acting user is not a member of this squad."));
        }

        // An already-inactive membership is a no-op success and never reaches the commit (Requirement 7.3).
        bool wasActive = acting.State == MembershipState.Active;

        // Domain guards: an owner must transfer ownership first; an inactive membership is idempotent
        // (Requirement 7.2, 7.3).
        Result leave = acting.Leave();
        if (!leave.IsSuccess)
        {
            return leave;
        }

        // Commit only a genuine active→inactive transition; a failure leaves the state Active
        // (Requirement 7.1).
        if (wasActive)
        {
            await _unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return Result.Ok();
    }
}
