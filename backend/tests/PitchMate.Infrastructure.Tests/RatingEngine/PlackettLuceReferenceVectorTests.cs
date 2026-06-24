using PitchMate.Domain.Rating;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Example-based reference vectors that pin <see cref="PlackettLuceRatingEngine.UpdateRatings"/> to the
/// canonical OpenSkill PlackettLuce model (Requirement 2.2). The expected μ/σ values were derived from
/// the reference openskill.py PlackettLuce implementation (v6.2.0) configured with τ = 0 (the engine
/// excludes the dynamics factor from the update path) and the engine's default parameters
/// (μ₀ = 25, σ₀ = 25/3, β = 25/6, κ = 1e-4). For the non-draw cases the derivation was cross-checked to
/// match openskill.py's <c>rate</c> output exactly; the draw case applies the engine's draw-symmetry
/// post-pass (equalising the μ shift across the tied teams). Covers a 2-team match, an uneven-team
/// match, and an N-team all-draw match.
/// </summary>
public class PlackettLuceReferenceVectorTests
{
    /// <summary>Floating-point tolerance for matching the reference vectors.</summary>
    private const double Tolerance = 1e-6;

    private static readonly PlackettLuceRatingEngine Engine = new(new RatingEngineConfig());

    private static MatchOutcome Outcome(params (int Rank, (double Mu, double Sigma)[] Players)[] teams) =>
        new(teams
            .Select(t => new TeamResult(
                t.Players.Select(p => new PlayerInput(new Rating(p.Mu, p.Sigma))).ToList(),
                t.Rank))
            .ToList());

    private static void AssertRating(double expectedMu, double expectedSigma, Rating actual)
    {
        Assert.Equal(expectedMu, actual.Mu, Tolerance);
        Assert.Equal(expectedSigma, actual.Sigma, Tolerance);
    }

    [Fact]
    public void TwoTeamMatch_MatchesOpenSkillReferenceVector()
    {
        // Team 0 (rank 0) beats Team 1 (rank 1); even 2v2 with distinct ratings.
        var outcome = Outcome(
            (0, new[] { (27.0, 8.0), (25.0, 5.0) }),
            (1, new[] { (24.0, 6.0), (20.0, 7.0) }));

        var result = Engine.UpdateRatings(outcome);

        Assert.True(result.IsSuccess);
        var teams = result.Value!.Teams;

        AssertRating(28.616907500902478, 7.812165333242901, teams[0][0]);
        AssertRating(25.63160449254003, 4.954473014914695, teams[0][1]);
        AssertRating(23.090489530742357, 5.922973167005119, teams[1][0]);
        AssertRating(18.76205519462154, 6.877395673513881, teams[1][1]);

        // The winning team's leader gained μ; the losing team's leader lost μ.
        Assert.True(teams[0][0].Mu > 27.0);
        Assert.True(teams[1][0].Mu < 24.0);

        // σ never increases under a match update (Requirement 2.5).
        Assert.True(teams[0][0].Sigma <= 8.0);
        Assert.True(teams[1][1].Sigma <= 7.0);
    }

    [Fact]
    public void UnevenTeamMatch_MatchesOpenSkillReferenceVector()
    {
        // Team 1 (2 players, rank 0) beats Team 0 (3 players, rank 1): differing roster sizes.
        var outcome = Outcome(
            (1, new[] { (25.0, 25.0 / 3.0), (30.0, 4.0), (22.0, 6.5) }),
            (0, new[] { (28.0, 7.0), (26.0, 5.0) }));

        var result = Engine.UpdateRatings(outcome);

        Assert.True(result.IsSuccess);
        var teams = result.Value!.Teams;

        AssertRating(21.310252526122962, 8.197721003995966, teams[0][0]);
        AssertRating(29.149882182018732, 3.985096629350163, teams[0][1]);
        AssertRating(19.75515763689321, 6.435852002795237, teams[0][2]);
        AssertRating(30.603485817567638, 6.939044383117462, teams[1][0]);
        AssertRating(27.328309090595734, 4.977833438043074, teams[1][1]);

        // Ordering and shape are preserved: 3 players then 2 players (Requirement 2.4).
        Assert.Equal(3, teams[0].Count);
        Assert.Equal(2, teams[1].Count);
    }

    [Fact]
    public void ThreeTeamDraw_MatchesOpenSkillReferenceVector()
    {
        // All three teams tie (rank 0), with uneven rosters and distinct ratings.
        var outcome = Outcome(
            (0, new[] { (25.0, 25.0 / 3.0) }),
            (0, new[] { (27.0, 6.0), (23.0, 5.0) }),
            (0, new[] { (24.0, 7.0) }));

        var result = Engine.UpdateRatings(outcome);

        Assert.True(result.IsSuccess);
        var teams = result.Value!.Teams;

        AssertRating(25.1985375578301, 8.250163701281604, teams[0][0]);
        AssertRating(27.1985375578301, 5.952349028185582, teams[1][0]);
        AssertRating(23.1985375578301, 4.972457850239293, teams[1][1]);
        AssertRating(24.1985375578301, 6.960908559151583, teams[2][0]);

        // Draw symmetry: every player receives the same μ shift across the tied teams.
        var shift0 = teams[0][0].Mu - 25.0;
        var shift1 = teams[1][0].Mu - 27.0;
        var shift2 = teams[2][0].Mu - 24.0;
        Assert.Equal(shift0, shift1, Tolerance);
        Assert.Equal(shift0, shift2, Tolerance);
    }
}
