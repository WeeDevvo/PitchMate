using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

// Both PitchMate.Domain.Matches and PitchMate.Domain.Squads define a Result / Result<T> triad;
// alias the match results so the unqualified names bind unambiguously in this handler.
using Result = PitchMate.Domain.Matches.Result;
using MatchDetailResult = PitchMate.Domain.Matches.Result<PitchMate.Application.Matches.UseCases.MatchDetail>;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Reads one match as a <see cref="MatchDetail"/> for an active member of its squad (match-read-models
/// Requirements 2 and 3).
/// <para>
/// <b>Gate order: load, resolve, gate.</b> This read's URL names only the match, so the squad is not
/// known until the match has been read — the order <see cref="GetTeamSheetHandler"/> and
/// <see cref="GetAvailabilityTallyHandler"/> already follow, and deliberately not the list read's
/// gate-first order. An absent match, a squad that is not visible, and a refused membership all return
/// the same uniform failure, so the refusals are indistinguishable (Requirements 5.1, 5.10, 5.13).
/// Timing and the work done before a refusal are outside that guarantee.
/// </para>
/// <para>
/// <b>No state gate.</b> All six lifecycle states succeed, in deliberate contrast to the team sheet,
/// and the caller's availability is reported in every state (Requirements 2.8, 3.9).
/// </para>
/// </summary>
public sealed class GetMatchDetailHandler
{
    private readonly IMatchDetailSource _source;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IAvailabilityRepository _availability;

    /// <summary>Creates the handler over the detail source, the membership and availability gateways.</summary>
    public GetMatchDetailHandler(
        IMatchDetailSource source,
        ISquadMembershipRepository memberships,
        IAvailabilityRepository availability)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(availability);

        _source = source;
        _memberships = memberships;
        _availability = availability;
    }

    /// <summary>Reads the match for the requesting user, or returns the uniform authorisation failure.</summary>
    /// <param name="command">The requesting user and the match.</param>
    /// <param name="cancellationToken">A token to cancel the read.</param>
    public async Task<MatchDetailResult> HandleAsync(
        GetMatchDetailCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        MatchDetailProjection? projection = await _source.FindAsync(command.MatchId, cancellationToken);
        if (projection is null)
        {
            return MatchDetailResult.Fail(MatchAuthorization.RequireActiveMember(null).Error!);
        }

        // The squad comes from the match, never from the request (Requirement 3.1).
        SquadMembership? acting = await _memberships.GetByUserAndSquadAsync(
            command.RequestingUserId, projection.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireActiveMember(acting);
        if (!gate.IsSuccess)
        {
            return MatchDetailResult.Fail(gate.Error!);
        }

        // Exactly the membership that passed the gate. The two members are set independently, so a
        // stored response marking nothing and no stored response differ in the boolean alone; marked
        // days are reported unfiltered, since the aggregate admits only candidate days
        // (Requirements 3.2–3.7).
        AvailabilityResponse? response =
            await _availability.GetResponseAsync(projection.MatchId, acting!.Id, cancellationToken);

        var callerAvailability = new CallerAvailability(
            HasStoredResponse: response is not null,
            MarkedDays: response?.MarkedDays.Select(day => day.Instant).ToList() ?? []);

        return MatchDetailResult.Ok(new MatchDetail(
            projection.MatchId,
            projection.SquadId,
            projection.State,
            projection.Location,
            projection.CandidateDays,
            projection.ConfirmedDay,
            projection.Participants.Count,
            projection.Participants,
            ConfirmMatchHandler.ResolveMinimumThreshold(squad: null),
            callerAvailability,
            projection.RecordedResult,
            projection.CompletedAt));
    }
}
