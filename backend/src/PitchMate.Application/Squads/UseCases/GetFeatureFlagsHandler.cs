using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Returns the current enabled-or-disabled state of every <see cref="SquadFeature"/> member for a
/// squad to one of its active members (Requirement 13.4, 13.5). The handler resolves the requesting
/// user's membership in the target squad and gates the read through
/// <see cref="SquadAuthorization.RequireActive"/>: only an <c>Active</c> member is served. Any other
/// requester — one holding only an inactive membership, or no membership at all — receives the single
/// uniform authorisation failure that discloses no feature state and does not reveal whether the squad
/// exists (Requirement 13.8). A soft-deleted (pending-deletion) squad is treated identically. A
/// feature with no stored flag reads as disabled, so the result always covers every defined feature
/// (Requirement 13.5).
/// </summary>
public sealed class GetFeatureFlagsHandler
{
    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;

    /// <summary>Creates the handler with the squad and membership repositories it reads through.</summary>
    public GetFeatureFlagsHandler(ISquadRepository squads, ISquadMembershipRepository memberships)
    {
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(memberships);

        _squads = squads;
        _memberships = memberships;
    }

    /// <summary>
    /// Handles a <see cref="GetFeatureFlagsCommand"/>, returning each feature's state on success or the
    /// uniform <see cref="SquadErrorCode.Unauthorized"/> failure when the requester is not an active
    /// member (or the squad is absent / pending deletion).
    /// </summary>
    /// <param name="command">The feature-flags read request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<IReadOnlyList<SquadFeatureView>>> HandleAsync(
        GetFeatureFlagsCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.RequestingUserId, command.SquadId, cancellationToken);

        // Gate to an active member; a member/inactive/non-member is rejected uniformly (Requirement 13.8).
        Result gate = SquadAuthorization.RequireActive(acting);
        if (!gate.IsSuccess)
        {
            return Result<IReadOnlyList<SquadFeatureView>>.Fail(gate.Error!);
        }

        // Load the squad, excluding soft-deleted ones. A missing or pending-deletion squad yields the
        // same uniform failure so its (non-)existence is never revealed (Requirement 13.8, 17.3).
        Squad? squad = await _squads.GetByIdAsync(command.SquadId, cancellationToken);
        if (squad is null)
        {
            return Result<IReadOnlyList<SquadFeatureView>>.Fail(SquadAuthorization.RequireActive(null).Error!);
        }

        // Report every defined feature with its current state; an uninitialised flag reads as disabled
        // (Requirement 13.4, 13.5).
        var features = Enum.GetValues<SquadFeature>()
            .Select(feature => new SquadFeatureView(feature, squad.IsFeatureEnabled(feature)))
            .ToList();

        return Result<IReadOnlyList<SquadFeatureView>>.Ok(features);
    }
}
