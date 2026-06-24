using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for the invalid-configuration gate on <see cref="PlackettLuceRatingEngine"/>.
/// When the injected configuration violates a validation rule, every operation must short-circuit
/// to a <see cref="RatingErrorCode.InvalidConfiguration"/> failure before touching its other
/// arguments and without performing any rating computation.
/// </summary>
public class InvalidConfigurationGatingTests
{
    // Minimal, structurally-valid placeholder inputs. The engine must reject the bad config before
    // ever inspecting these, so their content only needs to be well-formed enough to compile.
    private static readonly Rating SampleRating = new(25.0, 25.0 / 3.0);

    private static readonly MatchOutcome SampleOutcome = new(new[]
    {
        new TeamResult(new[] { new PlayerInput(SampleRating) }, 0),
        new TeamResult(new[] { new PlayerInput(SampleRating) }, 1),
    });

    private static readonly IReadOnlyList<Rating> SampleInitialRatings = new[] { SampleRating };

    private static readonly IReadOnlyList<ReplayMatch> SampleMatches = new[]
    {
        new ReplayMatch(new[]
        {
            new ReplayTeam(new[] { new ReplayParticipant(0) }, 0),
            new ReplayTeam(new[] { new ReplayParticipant(0) }, 1),
        }),
    };

    private static readonly IReadOnlyList<TeamRoster> SampleRosters = new[]
    {
        new TeamRoster(new[] { SampleRating }),
        new TeamRoster(new[] { SampleRating }),
    };

    // Feature: rating-engine, Property 23: Invalid configuration disables all operations
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(InvalidConfigArbitraries) })]
    public Property EveryOperationReturnsInvalidConfiguration(RatingEngineConfig invalidConfig)
    {
        var engine = new PlackettLuceRatingEngine(invalidConfig);

        var createRating = engine.CreateRating();
        var createRatingTier = engine.CreateRating(SkillTier.Strong);
        var getState = engine.GetState(SampleRating);
        var updateRatings = engine.UpdateRatings(SampleOutcome);
        var replay = engine.Replay(SampleInitialRatings, SampleMatches);
        var decayInactivity = engine.DecayInactivity(SampleRating, 30);
        var predict = engine.Predict(SampleRosters);

        var allRejected =
            IsInvalidConfig(createRating.IsSuccess, createRating.Error) &&
            IsInvalidConfig(createRatingTier.IsSuccess, createRatingTier.Error) &&
            IsInvalidConfig(getState.IsSuccess, getState.Error) &&
            IsInvalidConfig(updateRatings.IsSuccess, updateRatings.Error) &&
            IsInvalidConfig(replay.IsSuccess, replay.Error) &&
            IsInvalidConfig(decayInactivity.IsSuccess, decayInactivity.Error) &&
            IsInvalidConfig(predict.IsSuccess, predict.Error);

        return allRejected.ToProperty();
    }

    /// <summary>
    /// A result satisfies the gate when it failed (no rating operation performed) and carries the
    /// <see cref="RatingErrorCode.InvalidConfiguration"/> code.
    /// </summary>
    private static bool IsInvalidConfig(bool isSuccess, RatingError? error) =>
        !isSuccess && error is { Code: RatingErrorCode.InvalidConfiguration };
}
