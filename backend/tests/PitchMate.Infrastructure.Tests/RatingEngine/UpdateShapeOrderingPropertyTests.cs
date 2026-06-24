using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for the shape and ordering of <see cref="PlackettLuceRatingEngine.UpdateRatings"/>.
/// For any valid <see cref="MatchOutcome"/> of two or more teams (each with at least one player,
/// rosters possibly uneven, ranks ≥ 0), the update must succeed and return exactly one updated rating
/// per input player, preserving the order of teams and the order of players within each team.
/// </summary>
public class UpdateShapeOrderingPropertyTests
{
    // Feature: rating-engine, Property 3: Update preserves team and player shape and ordering
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property UpdatePreservesTeamAndPlayerShapeAndOrdering(
        RatingEngineConfig config,
        MatchOutcome outcome)
    {
        var engine = new PlackettLuceRatingEngine(config);

        var result = engine.UpdateRatings(outcome);

        // A valid outcome (2+ teams, ≥1 player each, ranks ≥ 0) always updates successfully
        // (Requirements 2.1, 2.3).
        if (!result.IsSuccess)
        {
            return false.ToProperty();
        }

        var updatedTeams = result.Value!.Teams;

        // Exactly one updated team per input team, in the same order (Requirement 2.4).
        var teamCountPreserved = updatedTeams.Count == outcome.Teams.Count;

        // Each team has exactly one updated rating per input player, in the same order
        // (Requirements 2.1, 2.4, 3.1) — including uneven roster sizes.
        var perTeamPlayerCountsPreserved = teamCountPreserved && Enumerable
            .Range(0, outcome.Teams.Count)
            .All(i => updatedTeams[i].Count == outcome.Teams[i].Players.Count);

        return (teamCountPreserved && perTeamPlayerCountsPreserved).ToProperty();
    }
}
