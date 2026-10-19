using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;

// PitchMate.Domain.Matches, PitchMate.Domain.Rating and PitchMate.Domain.Squads each define a Result
// triad; import only the rating and squad types this handler needs so the unqualified Result binds to
// the Matches one, as TeamBalanceRequestFactory does.
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using MatchPrediction = PitchMate.Domain.Rating.MatchPrediction;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using SkillTier = PitchMate.Domain.Rating.SkillTier;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;
using TeamRoster = PitchMate.Domain.Rating.TeamRoster;
using WorkingTeamsResult = PitchMate.Domain.Matches.Result<PitchMate.Application.Matches.UseCases.WorkingTeamsView>;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Reads a match's working teams for an organiser of its squad (match-read-models Requirement 4).
/// <para>
/// <b>Gate: load, resolve, then the Organiser_Gate</b> — an active, non-guest owner or admin
/// (Requirement 5.2). Every refusal, and a match the source cannot find, returns the same uniform
/// failure, which the concealing endpoint renders as the same <c>404</c> a non-member gets, so a refusal
/// discloses neither the match's existence nor the caller's role.
/// </para>
/// <para>
/// <b>Prediction.</b> <see cref="IRatingEngine.Predict"/> is called <b>at most once</b>, and only when
/// there are at least two teams and every roster is non-empty — the arrangements the engine accepts
/// (Requirements 4.10, 4.11, 4.16). An unrated member is seeded <b>in memory</b> from its skill tier and
/// never persisted, so reading the arrangement any number of times changes no rating (Requirement 4.17).
/// A prediction failure returns <see cref="MatchErrorCode.ValidationFailed"/> and no partial view
/// (Requirement 4.19).
/// </para>
/// <para>
/// <b>No state gate</b> (Requirement 4.15): every state returns its working teams, and a match with
/// none returns success with no teams and no prediction.
/// </para>
/// </summary>
public sealed class GetWorkingTeamsHandler
{
    private readonly IWorkingTeamsSource _source;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IRatingEngine _ratingEngine;

    /// <summary>Creates the handler over the working-teams source, the membership gateway and the rating engine.</summary>
    public GetWorkingTeamsHandler(
        IWorkingTeamsSource source,
        ISquadMembershipRepository memberships,
        IRatingEngine ratingEngine)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(ratingEngine);

        _source = source;
        _memberships = memberships;
        _ratingEngine = ratingEngine;
    }

    /// <summary>Reads the working teams for the requesting user, or returns a uniform or validation failure.</summary>
    /// <param name="command">The requesting user and the match.</param>
    /// <param name="cancellationToken">A token to cancel the read.</param>
    public async Task<WorkingTeamsResult> HandleAsync(
        GetWorkingTeamsCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        WorkingTeamsProjection? projection = await _source.FindAsync(command.MatchId, cancellationToken);
        if (projection is null)
        {
            return WorkingTeamsResult.Fail(MatchAuthorization.RequireActiveMember(null).Error!);
        }

        SquadMembership? acting = await _memberships.GetByUserAndSquadAsync(
            command.RequestingUserId, projection.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireOrganiser(acting);
        if (!gate.IsSuccess)
        {
            return WorkingTeamsResult.Fail(gate.Error!);
        }

        // Preserving roster-position order (Requirement 4.13).
        HashSet<Guid> rostered = [.. projection.Teams.SelectMany(static team => team.Roster).Select(static entry => entry.SquadMembershipId)];
        List<Guid> unassigned = [.. projection.ParticipantIds.Where(id => !rostered.Contains(id))];

        SplitPrediction? prediction = null;
        if (projection.Teams.Count >= 2 && projection.Teams.All(static team => team.Roster.Count > 0))
        {
            Result<SplitPrediction> predicted = Predict(projection);
            if (!predicted.IsSuccess)
            {
                return WorkingTeamsResult.Fail(predicted.Error!);
            }

            prediction = predicted.Value;
        }

        return WorkingTeamsResult.Ok(new WorkingTeamsView(projection.Teams, prediction, unassigned));
    }

    /// <summary>
    /// Asks the engine, exactly once, for the prediction of the rosters the view reports, seeding any
    /// unrated member in memory.
    /// </summary>
    private Result<SplitPrediction> Predict(WorkingTeamsProjection projection)
    {
        var rosters = new List<TeamRoster>(projection.Teams.Count);

        foreach (WorkingTeamView team in projection.Teams)
        {
            var players = new List<PlayerRating>(team.Roster.Count);

            foreach (RosterEntry entry in team.Roster)
            {
                if (projection.RatingsByMembershipId.TryGetValue(entry.SquadMembershipId, out PlayerRating persisted))
                {
                    players.Add(persisted);
                    continue;
                }

                SkillTier? tier = projection.SkillTiersByMembershipId.TryGetValue(entry.SquadMembershipId, out SkillTier? known)
                    ? known
                    : null;

                PitchMate.Domain.Rating.Result<PlayerRating> seeded = _ratingEngine.CreateRating(tier);
                if (!seeded.IsSuccess)
                {
                    return Result<SplitPrediction>.Fail(new MatchError(
                        MatchErrorCode.ValidationFailed,
                        $"Could not seed a rating for rostered member {entry.SquadMembershipId}: {seeded.Error?.Message}"));
                }

                players.Add(seeded.Value);
            }

            rosters.Add(new TeamRoster(players));
        }

        PitchMate.Domain.Rating.Result<MatchPrediction> predicted = _ratingEngine.Predict(rosters);
        if (!predicted.IsSuccess)
        {
            return Result<SplitPrediction>.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"The rating engine could not predict this arrangement: {predicted.Error?.Message}"));
        }

        MatchPrediction prediction = predicted.Value!;
        return Result<SplitPrediction>.Ok(new SplitPrediction([.. prediction.WinProbabilities], prediction.DrawProbability));
    }
}
