using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for the empty-replay identity of
/// <see cref="PlackettLuceRatingEngine.Replay"/>.
/// For any list of input ratings, replaying an empty sequence of matches must return those
/// input ratings unchanged (same count, same order, μ and σ exactly equal).
/// </summary>
public class ReplayEmptyIdentityProperties
{
    // Feature: rating-engine, Property 12: Empty replay is the identity
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property EmptyReplayReturnsInputRatingsUnchanged(
        RatingEngineConfig config,
        List<Rating> initialRatings)
    {
        var engine = new PlackettLuceRatingEngine(config);

        // Snapshot the input values up front so we can assert value-for-value equality afterwards.
        var expected = initialRatings.ToArray();

        // Replaying an empty sequence of matches is the identity (Requirement 5.5).
        var result = engine.Replay(initialRatings, Array.Empty<ReplayMatch>());

        if (!result.IsSuccess)
        {
            return false.ToProperty();
        }

        var returned = result.Value!;

        // Same count and same order, with μ and σ exactly equal for every position.
        var unchanged = returned.Count == expected.Length
            && Enumerable
                .Range(0, expected.Length)
                .All(i => returned[i].Mu == expected[i].Mu
                    && returned[i].Sigma == expected[i].Sigma);

        return unchanged.ToProperty();
    }
}
