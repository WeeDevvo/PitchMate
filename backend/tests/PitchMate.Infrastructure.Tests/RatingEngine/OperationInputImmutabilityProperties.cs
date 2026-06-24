using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for input immutability across the engine's operations.
/// The engine is a pure function: invoking any operation must leave every input it was given
/// (the <see cref="Rating"/> values inside a <see cref="MatchOutcome"/> / replay sequence, and the
/// injected <see cref="RatingEngineConfig"/>) value-for-value unchanged compared to a pre-call
/// snapshot, and the values it returns must be freshly constructed — never aliasing the input
/// collections (Requirement 4.4).
/// </summary>
/// <remarks>
/// Only the operations implemented at this point in the build are exercised
/// (<c>CreateRating</c>, <c>GetState</c>, <c>UpdateRatings</c>, <c>Replay</c>); <c>DecayInactivity</c>
/// and <c>Predict</c> are wired in later tasks and are covered by their own immutability assertions
/// once implemented.
/// </remarks>
public class OperationInputImmutabilityProperties
{
    // Feature: rating-engine, Property 10: Operations never mutate their inputs
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property UpdateRatingsNeverMutatesItsInputs(RatingEngineConfig config, MatchOutcome outcome)
    {
        var engine = new PlackettLuceRatingEngine(config);

        // Snapshot the config (a record copy, so a separate instance) and every input Rating value
        // before the call so we can compare value-for-value afterwards.
        var configSnapshot = config with { };
        var ratingSnapshot = SnapshotRatings(outcome);

        var result = engine.UpdateRatings(outcome);

        var configUnchanged = config == configSnapshot;
        var ratingsUnchanged = RatingsMatch(ratingSnapshot, SnapshotRatings(outcome));

        // On success, the returned collections must be distinct instances from the input collections
        // (Requirement 4.4). The outer list and every inner team list are freshly constructed.
        var outputsDistinct = true;
        if (result.IsSuccess)
        {
            var update = result.Value!;
            outputsDistinct = !ReferenceEquals(update.Teams, outcome.Teams);
            for (var i = 0; i < update.Teams.Count && outputsDistinct; i++)
            {
                if (ReferenceEquals(update.Teams[i], outcome.Teams[i].Players))
                {
                    outputsDistinct = false;
                }
            }
        }

        return (configUnchanged && ratingsUnchanged && outputsDistinct).ToProperty();
    }

    // Feature: rating-engine, Property 10: Operations never mutate their inputs
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property ReplayNeverMutatesItsInputs(RatingEngineConfig config, MatchOutcome outcome)
    {
        var engine = new PlackettLuceRatingEngine(config);

        // Flatten the outcome's players into an initial rating list and a single ReplayMatch whose
        // participants reference those ratings by opaque index, mirroring how callers thread ratings.
        var (initialRatings, replayMatch) = ToReplayInputs(outcome);
        var matches = new[] { replayMatch };

        var configSnapshot = config with { };
        var initialSnapshot = initialRatings.ToArray();

        var result = engine.Replay(initialRatings, matches);

        var configUnchanged = config == configSnapshot;

        // The caller's initial rating list must be untouched, value-for-value.
        var initialUnchanged = initialRatings.Count == initialSnapshot.Length;
        for (var i = 0; i < initialRatings.Count && initialUnchanged; i++)
        {
            if (!RatingEquals(initialRatings[i], initialSnapshot[i]))
            {
                initialUnchanged = false;
            }
        }

        // On success the returned list must be a distinct instance from the supplied initial list
        // (Requirement 4.4).
        var outputDistinct = !result.IsSuccess || !ReferenceEquals(result.Value, initialRatings);

        return (configUnchanged && initialUnchanged && outputDistinct).ToProperty();
    }

    // Feature: rating-engine, Property 10: Operations never mutate their inputs
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property EmptyReplayNeverMutatesItsInputs(RatingEngineConfig config, MatchOutcome outcome)
    {
        var engine = new PlackettLuceRatingEngine(config);

        var (initialRatings, _) = ToReplayInputs(outcome);
        var configSnapshot = config with { };
        var initialSnapshot = initialRatings.ToArray();

        // An empty replay performs no update; the inputs must still be left untouched and the returned
        // list must be a distinct instance from the supplied one (Requirements 4.3, 4.4, 5.5).
        var result = engine.Replay(initialRatings, Array.Empty<ReplayMatch>());

        var configUnchanged = config == configSnapshot;

        var initialUnchanged = initialRatings.Count == initialSnapshot.Length;
        for (var i = 0; i < initialRatings.Count && initialUnchanged; i++)
        {
            if (!RatingEquals(initialRatings[i], initialSnapshot[i]))
            {
                initialUnchanged = false;
            }
        }

        var outputDistinct = !result.IsSuccess || !ReferenceEquals(result.Value, initialRatings);

        return (configUnchanged && initialUnchanged && outputDistinct).ToProperty();
    }

    // Feature: rating-engine, Property 10: Operations never mutate their inputs
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property CreateRatingAndGetStateNeverMutateTheConfigOrRating(
        RatingEngineConfig config,
        Rating rating)
    {
        var engine = new PlackettLuceRatingEngine(config);

        var configSnapshot = config with { };
        var ratingSnapshot = rating;

        // CreateRating takes no rating input; GetState takes one. Neither may mutate the config, and
        // GetState must not mutate the rating it inspects.
        engine.CreateRating(SkillTier.Average);
        engine.GetState(rating);

        var configUnchanged = config == configSnapshot;
        var ratingUnchanged = RatingEquals(rating, ratingSnapshot);

        return (configUnchanged && ratingUnchanged).ToProperty();
    }

    /// <summary>Captures the (μ, σ) of every player in <paramref name="outcome"/> in input order.</summary>
    private static List<Rating> SnapshotRatings(MatchOutcome outcome)
    {
        var snapshot = new List<Rating>();
        foreach (var team in outcome.Teams)
        {
            foreach (var player in team.Players)
            {
                snapshot.Add(player.Rating);
            }
        }

        return snapshot;
    }

    /// <summary>Compares two ordered rating snapshots value-for-value.</summary>
    private static bool RatingsMatch(IReadOnlyList<Rating> expected, IReadOnlyList<Rating> actual)
    {
        if (expected.Count != actual.Count)
        {
            return false;
        }

        for (var i = 0; i < expected.Count; i++)
        {
            if (!RatingEquals(expected[i], actual[i]))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>Exact value equality of two ratings (NaN-safe via bit comparison).</summary>
    private static bool RatingEquals(Rating a, Rating b) =>
        a.Mu.Equals(b.Mu) && a.Sigma.Equals(b.Sigma);

    /// <summary>
    /// Projects a <see cref="MatchOutcome"/> into the inputs <c>Replay</c> expects: a flat list of the
    /// players' ratings plus a single <see cref="ReplayMatch"/> whose participants reference those
    /// ratings by sequential opaque index, preserving team and player ordering and ranks.
    /// </summary>
    private static (IReadOnlyList<Rating> InitialRatings, ReplayMatch Match) ToReplayInputs(MatchOutcome outcome)
    {
        var initial = new List<Rating>();
        var replayTeams = new List<ReplayTeam>(outcome.Teams.Count);

        foreach (var team in outcome.Teams)
        {
            var participants = new List<ReplayParticipant>(team.Players.Count);
            foreach (var player in team.Players)
            {
                participants.Add(new ReplayParticipant(initial.Count));
                initial.Add(player.Rating);
            }

            replayTeams.Add(new ReplayTeam(participants, team.Rank));
        }

        return (initial, new ReplayMatch(replayTeams));
    }
}
