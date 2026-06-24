using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test that single match-completion and a one-element replay share identical update logic.
/// For any valid single <see cref="MatchOutcome"/>, <see cref="PlackettLuceRatingEngine.UpdateRatings"/>
/// must produce exactly the same output ratings as <see cref="PlackettLuceRatingEngine.Replay"/> of the
/// equivalent one-element <see cref="ReplayMatch"/> sequence over the same initial ratings, where each
/// <see cref="ReplayParticipant"/> player index maps positionally to the flattened initial-rating list.
/// </summary>
public class ReplaySingleCompletionProperties
{
    // Feature: rating-engine, Property 11: Single completion equals a one-element replay
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property SingleCompletionEqualsOneElementReplay(
        RatingEngineConfig config,
        MatchOutcome outcome)
    {
        var engine = new PlackettLuceRatingEngine(config);

        // --- Path A: single match-completion over the outcome's ratings. ---
        var updateResult = engine.UpdateRatings(outcome);

        // --- Build the equivalent one-element replay. Flatten every player's input rating into a
        // positional initial-rating list, and reference each player by its position via a
        // ReplayParticipant. Team ranks and any goal margin/participation carry over unchanged so the
        // replay drives the identical UpdateRatings code path. ---
        var initialRatings = new List<Rating>();
        var replayTeams = new List<ReplayTeam>(outcome.Teams.Count);

        foreach (var team in outcome.Teams)
        {
            var participants = new List<ReplayParticipant>(team.Players.Count);
            foreach (var player in team.Players)
            {
                participants.Add(new ReplayParticipant(initialRatings.Count, player.Participation));
                initialRatings.Add(player.Rating);
            }

            replayTeams.Add(new ReplayTeam(participants, team.Rank));
        }

        var replayMatch = new ReplayMatch(replayTeams, outcome.GoalMargin);

        var replayResult = engine.Replay(initialRatings, new[] { replayMatch });

        // Both paths share validation and computation, so they must agree on success/failure.
        if (!updateResult.IsSuccess || !replayResult.IsSuccess)
        {
            return (updateResult.IsSuccess == replayResult.IsSuccess).ToProperty();
        }

        // Flatten the single-completion output in the same positional order used to build the
        // replay's initial-rating indices, then compare value-for-value: μ and σ must be exactly equal.
        var updatedFlat = updateResult.Value!.Teams.SelectMany(team => team).ToList();
        var replayFlat = replayResult.Value!;

        if (updatedFlat.Count != replayFlat.Count)
        {
            return false.ToProperty();
        }

        var exactlyEqual = updatedFlat
            .Zip(replayFlat, (a, b) => a.Mu == b.Mu && a.Sigma == b.Sigma)
            .All(equal => equal);

        return exactlyEqual.ToProperty();
    }
}
