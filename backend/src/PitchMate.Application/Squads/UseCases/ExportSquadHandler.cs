using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Produces a machine-readable export of a squad's data for its owner (Requirement 17.2). The handler
/// resolves the acting membership from the authenticated user and the target squad and gates it through
/// <see cref="SquadAuthorization.RequireOwner"/>, so only the active owner may export; every other
/// actor is rejected with the uniform authorisation failure that discloses no data and does not reveal
/// whether the squad exists (Requirement 16.2, 17.2). Soft-deleting the squad does not deactivate its
/// memberships, so the owner can still export while the squad is pending deletion and before its purge
/// instant (Requirement 17.2).
/// <para>
/// The export loads the squad including a soft-deleted one and projects its memberships (active and
/// inactive), its invites, and its feature-flag states. Each invite is projected to its effective state
/// against the clock and — like the invite list — carries nothing from which the redeemable secret can
/// be reconstructed; the persisted one-way token hash is never surfaced (Requirement 17.2).
/// </para>
/// </summary>
public sealed class ExportSquadHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly IInviteRepository _invites;
    private readonly TimeProvider _clock;

    /// <summary>
    /// Creates the handler with the membership repository it authorises the owner through and lists
    /// memberships from, the squad repository it loads the (possibly soft-deleted) squad from, the
    /// invite repository it lists invites from, and the clock it derives each invite's effective state
    /// from.
    /// </summary>
    public ExportSquadHandler(
        ISquadMembershipRepository memberships,
        ISquadRepository squads,
        IInviteRepository invites,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(invites);
        ArgumentNullException.ThrowIfNull(clock);

        _memberships = memberships;
        _squads = squads;
        _invites = invites;
        _clock = clock;
    }

    /// <summary>
    /// Handles an <see cref="ExportSquadCommand"/>, returning the squad's export on success or the
    /// uniform <see cref="SquadErrorCode.Unauthorized"/> failure when the requester is not the active
    /// owner (or the squad is absent).
    /// </summary>
    /// <param name="command">The export request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<SquadExport>> HandleAsync(
        ExportSquadCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.RequestingUserId, command.SquadId, cancellationToken);

        // Only the active owner may export the squad; every other actor is rejected uniformly and no
        // data is disclosed (Requirement 16.2, 17.2).
        Result gate = SquadAuthorization.RequireOwner(acting);
        if (!gate.IsSuccess)
        {
            return Result<SquadExport>.Fail(gate.Error!);
        }

        // Load the squad including a soft-deleted one so an export remains available while pending
        // deletion (Requirement 17.2). A missing squad yields the same uniform failure.
        Squad? squad = await _squads.GetByIdIncludingDeletedAsync(command.SquadId, cancellationToken);
        if (squad is null)
        {
            return Result<SquadExport>.Fail(SquadAuthorization.RequireOwner(null).Error!);
        }

        IReadOnlyList<SquadMembership> members =
            await _memberships.ListForSquadAsync(command.SquadId, activeOnly: false, cancellationToken);

        IReadOnlyList<Invite> invites =
            await _invites.ListForSquadAsync(command.SquadId, cancellationToken);

        DateTimeOffset now = _clock.GetUtcNow();

        var memberViews = members
            .Select(m => new SquadExportMembership(
                m.Id,
                m.UserId,
                m.Role,
                m.State,
                m.DisplayName,
                m.SkillTier,
                m.IsGuest,
                m.ClaimCompleted,
                m.LawfulBasisAcknowledgedAt))
            .ToList();

        // Project each invite without any redeemable secret; the token hash is never surfaced
        // (Requirement 17.2).
        var inviteViews = invites
            .Select(i => new SquadExportInvite(
                i.Id,
                i.EffectiveState(now),
                i.CreatedAt,
                i.CreatedBy,
                i.ExpiresAt))
            .ToList();

        var featureViews = squad.Features
            .Select(f => new SquadFeatureView(f.Feature, f.IsEnabled))
            .ToList();

        return Result<SquadExport>.Ok(new SquadExport(
            squad.Id,
            squad.Name,
            squad.IsPendingDeletion,
            squad.PurgeAt,
            memberViews,
            inviteViews,
            featureViews));
    }
}
