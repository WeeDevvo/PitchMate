using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Lists a squad's invites for an owner or admin (Requirement 10.5). The handler resolves the acting
/// membership from the authenticated user and target squad and gates it through
/// <see cref="SquadAuthorization.RequireOwnerOrAdmin"/>, so only an active owner or admin may list and
/// every other actor is rejected with the uniform authorisation failure (Requirement 4.2).
/// <para>
/// On success it projects each invite into an <see cref="InviteSummary"/> carrying the invite's
/// identity, its effective <see cref="InviteState"/> resolved against the clock (so a stored-active
/// invite past its expiry reads as <see cref="InviteState.Expired"/>), its creation audit, and its
/// expiry instant. It deliberately returns nothing from which the redeemable secret can be
/// reconstructed — the persisted <see cref="Invite.TokenHash"/> is never surfaced (Requirement 10.5).
/// </para>
/// </summary>
public sealed class ListInvitesHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly IInviteRepository _invites;
    private readonly TimeProvider _clock;

    /// <summary>
    /// Creates the handler with the membership repository it authorises through, the invite
    /// repository it lists from, and the clock it derives each invite's effective state from.
    /// </summary>
    public ListInvitesHandler(
        ISquadMembershipRepository memberships,
        IInviteRepository invites,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(invites);
        ArgumentNullException.ThrowIfNull(clock);

        _memberships = memberships;
        _invites = invites;
        _clock = clock;
    }

    /// <summary>
    /// Handles a <see cref="ListInvitesCommand"/>, returning the squad's invites projected to
    /// secret-free summaries on success, or the uniform <see cref="SquadErrorCode.Unauthorized"/>
    /// failure when the actor is not an active owner or admin.
    /// </summary>
    /// <param name="command">The invite-list request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<IReadOnlyList<InviteSummary>>> HandleAsync(
        ListInvitesCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only an active owner or admin may list invites; every other actor is rejected uniformly (Requirement 4.2).
        Result gate = SquadAuthorization.RequireOwnerOrAdmin(acting);
        if (!gate.IsSuccess)
        {
            return Result<IReadOnlyList<InviteSummary>>.Fail(gate.Error!);
        }

        IReadOnlyList<Invite> invites = await _invites.ListForSquadAsync(command.SquadId, cancellationToken);

        DateTimeOffset now = _clock.GetUtcNow();

        // Project to secret-free summaries: effective state against the clock, creation audit, and
        // expiry — never the token hash or anything the redeemable secret can be reconstructed from
        // (Requirement 10.5).
        var summaries = invites
            .Select(invite => new InviteSummary(
                invite.Id,
                invite.EffectiveState(now),
                invite.CreatedAt,
                invite.CreatedBy,
                invite.ExpiresAt))
            .ToList();

        return Result<IReadOnlyList<InviteSummary>>.Ok(summaries);
    }
}
