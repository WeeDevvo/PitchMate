using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Returns a squad's data to one of its active members (Requirement 16.1). The handler resolves the
/// requesting user's membership in the target squad and gates the read through
/// <see cref="SquadAuthorization.RequireActive"/>: only an <c>Active</c> member is served. Any other
/// requester — one holding only an inactive membership, or no membership at all — receives the single
/// uniform authorisation failure that discloses no squad data and does not reveal whether the squad
/// exists (Requirement 16.2). A soft-deleted (pending-deletion) squad is treated identically: it is
/// excluded from the read and the same uniform failure is returned, so its existence is never
/// disclosed (Requirement 17.3).
/// </summary>
public sealed class GetSquadHandler
{
    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;

    /// <summary>Creates the handler with the squad and membership repositories it reads through.</summary>
    public GetSquadHandler(ISquadRepository squads, ISquadMembershipRepository memberships)
    {
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(memberships);

        _squads = squads;
        _memberships = memberships;
    }

    /// <summary>
    /// Handles a <see cref="GetSquadCommand"/>, returning the squad's data on success or the uniform
    /// <see cref="SquadErrorCode.Unauthorized"/> failure when the requester is not an active member
    /// (or the squad is absent / pending deletion).
    /// </summary>
    /// <param name="command">The squad-read request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<SquadData>> HandleAsync(GetSquadCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.RequestingUserId, command.SquadId, cancellationToken);

        // Gate to an active member; a member/inactive/non-member is rejected uniformly (Requirement 16.2).
        Result gate = SquadAuthorization.RequireActive(acting);
        if (!gate.IsSuccess)
        {
            return Result<SquadData>.Fail(gate.Error!);
        }

        // Load the squad, excluding soft-deleted ones. A missing or pending-deletion squad yields the
        // same uniform failure so its (non-)existence is never revealed (Requirement 16.2, 17.3).
        Squad? squad = await _squads.GetByIdAsync(command.SquadId, cancellationToken);
        if (squad is null)
        {
            return Result<SquadData>.Fail(SquadAuthorization.RequireActive(null).Error!);
        }

        IReadOnlyList<SquadMembership> members =
            await _memberships.ListForSquadAsync(command.SquadId, activeOnly: false, cancellationToken);

        var memberViews = members
            .Select(m => new SquadMemberView(m.Id, m.DisplayName, m.Role, m.State, m.IsGuest))
            .ToList();

        var featureViews = squad.Features
            .Select(f => new SquadFeatureView(f.Feature, f.IsEnabled))
            .ToList();

        return Result<SquadData>.Ok(new SquadData(squad.Id, squad.Name, memberViews, featureViews));
    }
}
