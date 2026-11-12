using PitchMate.Domain.Rating;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Pins how long a newcomer stays provisional under the default <see cref="RatingEngineConfig"/>: at most
/// 5 matches at every supported size (5v5 to 8v8, uneven sides included), and never fewer than 3. Every
/// win/loss/draw sequence over the first 5 matches is played, with all players starting fresh (the
/// slowest case, since established teammates shrink σ faster). Guards the threshold against later
/// changes to β, σ₀ or the threshold itself.
/// </summary>
public class ProvisionalPeriodLengthTests
{
    private const int MaxProvisionalMatches = 5;
    private const int MinProvisionalMatches = 3;

    private static readonly PlackettLuceRatingEngine Engine = new(new RatingEngineConfig());

    private static readonly int[][] RankPairs = [[0, 1], [1, 0], [0, 0]];

    public static TheoryData<int, int> Sizes => new()
    {
        { 5, 5 }, { 6, 6 }, { 7, 7 }, { 8, 8 }, { 6, 5 }, { 5, 6 }, { 8, 7 }, { 7, 8 },
    };

    [Theory]
    [MemberData(nameof(Sizes))]
    public void NewcomerSettles_WithinFiveMatches_ButNotBeforeThree(int studiedSize, int opponentSize)
    {
        var sequences = (int)Math.Pow(RankPairs.Length, MaxProvisionalMatches);
        for (var sequence = 0; sequence < sequences; sequence++)
        {
            var studied = Fresh(studiedSize);
            var opponents = Fresh(opponentSize);
            var remaining = sequence;

            for (var match = 1; match <= MaxProvisionalMatches; match++)
            {
                var ranks = RankPairs[remaining % RankPairs.Length];
                remaining /= RankPairs.Length;

                var result = Engine.UpdateRatings(new MatchOutcome([
                    new TeamResult(studied.Select(r => new PlayerInput(r)).ToList(), ranks[0]),
                    new TeamResult(opponents.Select(r => new PlayerInput(r)).ToList(), ranks[1]),
                ]));
                Assert.True(result.IsSuccess);
                studied = result.Value!.Teams[0].ToList();
                opponents = result.Value!.Teams[1].ToList();

                var state = Engine.GetState(studied[0]).Value;
                if (match < MinProvisionalMatches)
                {
                    Assert.Equal(RatingState.Provisional, state);
                }
                else if (match == MaxProvisionalMatches)
                {
                    Assert.Equal(RatingState.Established, state);
                }
            }
        }
    }

    private static List<Rating> Fresh(int count) =>
        Enumerable.Repeat(new Rating(25.0, 25.0 / 3.0), count).ToList();
}
