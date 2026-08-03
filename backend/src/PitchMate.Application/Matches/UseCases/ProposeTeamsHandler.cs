using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;
// Both PitchMate.Domain.Matches and PitchMate.Domain.Rating define a Result<T>; import only the
// specific rating type this handler needs so the unqualified Result<T> binds to the Matches triad.
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Requests a balanced two-team proposal for a match and returns it to the organiser without
/// changing any state (Requirement 8.1). The handler loads the squad-scoped match, resolves the
/// acting user's membership in that match's squad, and gates through
/// <see cref="MatchAuthorization.RequireOrganiser"/>, so only an active registered owner or admin may
/// request a proposal; a match that cannot be found and any non-organiser both yield the single
/// uniform <see cref="MatchErrorCode.Unauthorized"/> failure, disclosing neither the squad nor the
/// match (Requirement 14.1, 14.2, 14.3).
/// <para>
/// It then enforces the proposal preconditions: the match must be in
/// <see cref="MatchState.Confirmed"/> or <see cref="MatchState.TeamsRolled"/> and its participant
/// count must be between <see cref="MinParticipants"/> and <see cref="MaxParticipants"/> inclusive; a
/// match in any other state or with a participant count outside that range is rejected with a
/// validation error identifying the unmet precondition and left unchanged (Requirement 8.9).
/// </para>
/// <para>
/// On success the participants are offered — each paired with its current or skill-tier-seeded rating
/// (see <see cref="TeamBalanceRequestFactory"/>) — to <see cref="ITeamBalancer.ProposeAsync"/>, which
/// splits them into two teams and reports the split's predicted outcome. The proposal is returned as
/// produced; the handler mutates no match state, persists nothing, and alters no rating, so a
/// proposal can be requested any number of times before the admin adjusts and locks one
/// (Requirement 8.1, 8.8).
/// </para>
/// </summary>
public sealed class ProposeTeamsHandler
{
    /// <summary>The minimum participant count for which a proposal may be requested (Requirement 8.1, 8.9).</summary>
    public const int MinParticipants = 10;

    /// <summary>The maximum participant count for which a proposal may be requested (Requirement 8.1, 8.9).</summary>
    public const int MaxParticipants = 16;

    /// <summary>The number of teams formed for the MVP (Requirement 8.1).</summary>
    private const int TeamCount = 2;

    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IMembershipRatingRepository _ratings;
    private readonly IRatingEngine _ratingEngine;
    private readonly ITeamBalancer _balancer;

    /// <summary>
    /// Creates the handler with the match repository it loads the squad-scoped match through, the
    /// membership repository it resolves and gates the acting membership through (and reads skill tiers
    /// from), the membership-rating repository it reads current ratings from, the rating engine it
    /// seeds absent ratings with, and the team balancer it requests the proposal from.
    /// </summary>
    public ProposeTeamsHandler(
        IMatchRepository matches,
        ISquadMembershipRepository memberships,
        IMembershipRatingRepository ratings,
        IRatingEngine ratingEngine,
        ITeamBalancer balancer)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(ratings);
        ArgumentNullException.ThrowIfNull(ratingEngine);
        ArgumentNullException.ThrowIfNull(balancer);

        _matches = matches;
        _memberships = memberships;
        _ratings = ratings;
        _ratingEngine = ratingEngine;
        _balancer = balancer;
    }

    /// <summary>
    /// Handles a <see cref="ProposeTeamsCommand"/>, returning the balanced <see cref="TeamProposal"/>
    /// on success or a typed <see cref="MatchError"/> — a uniform authorisation failure for an
    /// unfindable match or a non-organiser, or a validation failure when the state or participant-count
    /// precondition is unmet.
    /// </summary>
    /// <param name="command">The proposal request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<TeamProposal>> HandleAsync(
        ProposeTeamsCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        // Load the squad-scoped match. A match that cannot be found is rejected with the same uniform
        // authorisation failure so a rejection never discloses whether the match exists
        // (Requirement 14.1, 14.3).
        Match? match = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
        if (match is null)
        {
            return Unauthorized();
        }

        // Resolve the acting membership and gate: only an active registered owner or admin may request
        // a proposal (Requirement 14.1, 14.2).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireOrganiser(acting);
        if (!gate.IsSuccess)
        {
            return Result<TeamProposal>.Fail(gate.Error!);
        }

        // Enforce the proposal preconditions: correct state and participant count (Requirement 8.9).
        if (match.State is not (MatchState.Confirmed or MatchState.TeamsRolled))
        {
            return Result<TeamProposal>.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"Teams can only be proposed while the match is Confirmed or TeamsRolled; the match is {match.State}."));
        }

        int participantCount = match.Participants.Count;
        if (participantCount is < MinParticipants or > MaxParticipants)
        {
            return Result<TeamProposal>.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"A team proposal requires {MinParticipants} to {MaxParticipants} participants; the match has {participantCount}."));
        }

        // Offer the participants and their ratings to the balancer. Building the request is read-only:
        // an unrated participant is seeded in memory and never persisted (Requirement 8.1, 8.8).
        Result<TeamBalanceRequest> request = await TeamBalanceRequestFactory.BuildAsync(
            match, TeamCount, _ratings, _memberships, _ratingEngine, cancellationToken);
        if (!request.IsSuccess)
        {
            return Result<TeamProposal>.Fail(request.Error!);
        }

        // Return the balancer's proposal as produced; no match state is changed and nothing is persisted
        // (Requirement 8.1).
        return await _balancer.ProposeAsync(request.Value!, cancellationToken);
    }

    private static Result<TeamProposal> Unauthorized() =>
        Result<TeamProposal>.Fail(new MatchError(
            MatchErrorCode.Unauthorized, "The requested action is not permitted."));
}
