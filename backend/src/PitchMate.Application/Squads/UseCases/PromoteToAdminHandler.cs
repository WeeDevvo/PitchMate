using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Promotes an active registered <see cref="SquadRole.Member"/> to <see cref="SquadRole.Admin"/>
/// (Requirement 5.1). The handler resolves the acting membership from the authenticated user and the
/// target squad and gates it through <see cref="SquadAuthorization.RequireOwnerOrAdmin"/>, so only an
/// active owner or admin may promote (Requirement 4.2). It then resolves the target by identity and
/// requires it to belong to the same squad; a target that does not resolve, or that belongs to a
/// different squad, is rejected as an ineligible member without disclosing anything further
/// (Requirement 5.7). The <see cref="SquadMembership.PromoteToAdmin"/> domain method enforces the
/// remaining guards — a guest holds no role, an inactive target is ineligible, and only a
/// <c>Member</c> can be promoted — leaving the target unchanged on any violation (Requirement 5.2,
/// 5.5, 5.7). A successful change is committed through <see cref="IUnitOfWork.SaveChangesAsync"/> and
/// touches only the target, leaving every other membership's role unchanged (Requirement 5.8).
/// </summary>
public sealed class PromoteToAdminHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>Creates the handler with the membership repository it reads/stages through and the unit of work it commits with.</summary>
    public PromoteToAdminHandler(ISquadMembershipRepository memberships, IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _memberships = memberships;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles a <see cref="PromoteToAdminCommand"/>, returning success once the target is an
    /// <c>Admin</c>, or a typed <see cref="SquadError"/> when authorisation or eligibility fails.
    /// </summary>
    /// <param name="command">The promotion request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(PromoteToAdminCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only an active owner or admin may promote; every other actor is rejected uniformly (Requirement 4.2).
        Result gate = SquadAuthorization.RequireOwnerOrAdmin(acting);
        if (!gate.IsSuccess)
        {
            return gate;
        }

        SquadMembership? target =
            await _memberships.GetByIdAsync(command.TargetMembershipId, cancellationToken);

        // The target must be a membership of the acting member's squad (Requirement 5.7).
        if (target is null || target.SquadId != command.SquadId)
        {
            return Result.Fail(new SquadError(
                SquadErrorCode.NotAMember,
                "The target is not an eligible active member of the squad."));
        }

        // Domain guards: no guest role, active only, current role must be Member (Requirement 5.2, 5.5, 5.7).
        Result promotion = target.PromoteToAdmin();
        if (!promotion.IsSuccess)
        {
            return promotion;
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }
}
