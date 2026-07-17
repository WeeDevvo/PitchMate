using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Enables or disables a single <see cref="SquadFeature"/> for a squad (Requirement 13.2). The handler
/// resolves the acting membership from the authenticated user and target squad and gates it through
/// <see cref="SquadAuthorization.RequireOwnerOrAdmin"/>, so only an active owner or admin may toggle a
/// feature; every other actor — a plain member, an inactive membership, a guest, or a non-member — is
/// rejected with the uniform authorisation failure and no feature state changes (Requirement 13.7). A
/// request targeting a value that is not a defined <see cref="SquadFeature"/> member is rejected as
/// <see cref="SquadErrorCode.ValidationFailed"/>, again leaving all feature states unchanged
/// (Requirement 13.6). On success the domain <see cref="Squad.SetFeature"/> sets the single matching
/// flag to the requested value regardless of its prior value and leaves every other flag untouched;
/// the change is committed atomically through <see cref="IUnitOfWork.SaveChangesAsync"/>
/// (Requirement 13.2).
/// </summary>
public sealed class SetFeatureFlagHandler
{
    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>Creates the handler with the squad and membership repositories it reads/stages through and the unit of work it commits with.</summary>
    public SetFeatureFlagHandler(
        ISquadRepository squads,
        ISquadMembershipRepository memberships,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _squads = squads;
        _memberships = memberships;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles a <see cref="SetFeatureFlagCommand"/>, returning success once the feature holds the
    /// requested state, or a typed <see cref="SquadError"/> when authorisation or validation fails.
    /// </summary>
    /// <param name="command">The feature-toggle request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(SetFeatureFlagCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only an active owner or admin may toggle a feature; every other actor is rejected uniformly
        // and no feature state changes (Requirement 13.7).
        Result gate = SquadAuthorization.RequireOwnerOrAdmin(acting);
        if (!gate.IsSuccess)
        {
            return gate;
        }

        // Reject a value outside the SquadFeature enumeration, leaving all feature states unchanged
        // (Requirement 13.6).
        if (!Enum.IsDefined(command.Feature))
        {
            return Result.Fail(new SquadError(
                SquadErrorCode.ValidationFailed,
                "The requested value is not a defined squad feature."));
        }

        // Load the squad, excluding soft-deleted ones. A missing or pending-deletion squad yields the
        // same uniform failure so its (non-)existence is never revealed (Requirement 13.7, 17.3).
        Squad? squad = await _squads.GetByIdAsync(command.SquadId, cancellationToken);
        if (squad is null)
        {
            return SquadAuthorization.RequireOwnerOrAdmin(null);
        }

        // Set only the targeted flag; every other feature's state is left unchanged (Requirement 13.2).
        squad.SetFeature(command.Feature, command.Enabled);

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }
}
