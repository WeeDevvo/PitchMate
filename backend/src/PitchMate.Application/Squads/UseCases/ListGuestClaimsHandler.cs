using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Auth;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Lists where each guest's claim stands, for the squad's owner and admins: a link out, a link expired,
/// accepted and awaiting completion (with who accepted), or claimed. Guests with no claim activity, and
/// members who were never guests, have no row.
/// <para>
/// Owner or admin only; every other caller, a missing squad and a squad pending deletion get the same
/// uniform failure, which the endpoint conceals as a 404. The accepting player's account name comes from
/// their user record, because they are not a member yet, and that is why this read is admin-only.
/// </para>
/// </summary>
public sealed class ListGuestClaimsHandler
{
    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IGuestClaimRepository _claims;
    private readonly IUserRepository _users;
    private readonly TimeProvider _clock;

    /// <summary>Creates the handler with the reads it composes and the clock it judges expiry by.</summary>
    public ListGuestClaimsHandler(
        ISquadRepository squads,
        ISquadMembershipRepository memberships,
        IGuestClaimRepository claims,
        IUserRepository users,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(claims);
        ArgumentNullException.ThrowIfNull(users);
        ArgumentNullException.ThrowIfNull(clock);

        _squads = squads;
        _memberships = memberships;
        _claims = claims;
        _users = users;
        _clock = clock;
    }

    /// <summary>Handles a <see cref="ListGuestClaimsCommand"/>.</summary>
    /// <param name="command">The request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<IReadOnlyList<GuestClaimSummary>>> HandleAsync(
        ListGuestClaimsCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        Result gate = SquadAuthorization.RequireOwnerOrAdmin(acting);
        if (!gate.IsSuccess)
        {
            return Result<IReadOnlyList<GuestClaimSummary>>.Fail(gate.Error!);
        }

        Squad? squad = await _squads.GetByIdAsync(command.SquadId, cancellationToken);
        if (squad is null)
        {
            return Result<IReadOnlyList<GuestClaimSummary>>.Fail(SquadAuthorization.RequireOwnerOrAdmin(null).Error!);
        }

        DateTimeOffset now = _clock.GetUtcNow();
        var rows = new List<GuestClaimSummary>();

        foreach (GuestClaim claim in await _claims.ListOpenForSquadAsync(command.SquadId, cancellationToken))
        {
            if (claim.State == GuestClaimState.Consented && claim.TargetUserId is { } userId)
            {
                User? user = await _users.GetByIdAsync(userId, cancellationToken);
                rows.Add(new GuestClaimSummary(
                    claim.MembershipId, GuestClaimStatus.Accepted, claim.ExpiresAt, user?.DisplayName));
            }
            else
            {
                GuestClaimStatus status = claim.IsRedeemableAt(now)
                    ? GuestClaimStatus.LinkIssued
                    : GuestClaimStatus.LinkExpired;
                rows.Add(new GuestClaimSummary(claim.MembershipId, status, claim.ExpiresAt, null));
            }
        }

        // A completed claim is recorded on the membership itself, which is the source of truth for it.
        IReadOnlyList<SquadMembership> memberships =
            await _memberships.ListForSquadAsync(command.SquadId, activeOnly: false, cancellationToken);
        rows.AddRange(memberships
            .Where(membership => membership.ClaimCompleted)
            .Select(membership => new GuestClaimSummary(membership.Id, GuestClaimStatus.Claimed, null, null)));

        return Result<IReadOnlyList<GuestClaimSummary>>.Ok(rows);
    }
}
