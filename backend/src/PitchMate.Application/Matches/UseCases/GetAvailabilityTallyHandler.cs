using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

// Both PitchMate.Domain.Matches and PitchMate.Domain.Squads define a Result / Result<T> triad;
// alias the match results so the unqualified names bind unambiguously in this handler.
using Result = PitchMate.Domain.Matches.Result;
using TallyResult = PitchMate.Domain.Matches.Result<PitchMate.Domain.Matches.AvailabilityTally>;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Returns a match's <see cref="AvailabilityTally"/> to an active member of the match's squad
/// (Requirement 5.1). The read is squad-scoped and non-disclosing: it loads the match, resolves the
/// requesting user's membership in that match's squad, and gates through
/// <see cref="MatchAuthorization.RequireActiveMember"/>. A request for a match that does not exist,
/// and a request by an inactive membership or a non-member, both yield the single uniform
/// authorisation failure, so a rejection never reveals whether the match exists (Requirement 5.5,
/// 5.6, 5.7). On success the tally is computed by the pure Domain computation over the match's
/// candidate days and its stored availability responses, loaded via
/// <see cref="IAvailabilityRepository.ListResponsesAsync"/>; every candidate day is represented,
/// including days marked by no member (Requirement 5.2, 5.3, 5.4).
/// </summary>
public sealed class GetAvailabilityTallyHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IAvailabilityRepository _availability;

    /// <summary>Creates the handler with the match, membership, and availability repositories it reads through.</summary>
    public GetAvailabilityTallyHandler(
        IMatchRepository matches,
        ISquadMembershipRepository memberships,
        IAvailabilityRepository availability)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(availability);

        _matches = matches;
        _memberships = memberships;
        _availability = availability;
    }

    /// <summary>
    /// Handles a <see cref="GetAvailabilityTallyCommand"/>, returning the computed
    /// <see cref="AvailabilityTally"/> on success or the uniform
    /// <see cref="MatchErrorCode.Unauthorized"/> failure when the match is absent or the requester is
    /// not an active member of its squad.
    /// </summary>
    /// <param name="command">The availability-tally read request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<TallyResult> HandleAsync(
        GetAvailabilityTallyCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        // Load the match first, then gate against its squad. A missing match yields the same uniform
        // failure as an unauthorised actor so its (non-)existence is never revealed (Requirement 5.6, 5.7).
        Match? match = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
        if (match is null)
        {
            return TallyResult.Fail(MatchAuthorization.RequireActiveMember(null).Error!);
        }

        // Any active member of the match's squad may read the tally; an inactive membership or a
        // non-member is rejected uniformly, concealing the match (Requirement 5.5, 5.6).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.RequestingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireActiveMember(acting);
        if (!gate.IsSuccess)
        {
            return TallyResult.Fail(gate.Error!);
        }

        // Compute the tally from the match's candidate days and its stored responses (Requirement 5.1).
        IReadOnlyList<AvailabilityResponse> responses =
            await _availability.ListResponsesAsync(command.MatchId, cancellationToken);

        AvailabilityTally tally = AvailabilityTally.Compute(match.CandidateDays, responses);
        return TallyResult.Ok(tally);
    }
}
