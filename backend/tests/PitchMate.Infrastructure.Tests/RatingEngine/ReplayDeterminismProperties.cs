using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for engine determinism across single updates and replays
/// (<see cref="PlackettLuceRatingEngine.UpdateRatings"/> and
/// <see cref="PlackettLuceRatingEngine.Replay"/>).
///
/// The engine is a pure function: invoking the same operation twice on value-equal inputs must
/// yield byte-identical outputs (Requirement 4.1), and replaying the same initial ratings through
/// the same ordered sequence of matches on separate occasions must yield identical final ratings —
/// the replay result is a function only of the initial ratings and the ordered sequence
/// (Requirements 5.1, 5.2). Both occasions are modelled here with two independently constructed
/// engines sharing the same configuration.
/// </summary>
public class ReplayDeterminismProperties
{
    // Feature: rating-engine, Property 9: The engine is deterministic across single updates and replays
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property EngineIsDeterministicAcrossUpdatesAndReplays(
        RatingEngineConfig config,
        MatchOutcome outcome)
    {
        // Two independently constructed engines on the same config model "two separate occasions".
        var engineA = new PlackettLuceRatingEngine(config);
        var engineB = new PlackettLuceRatingEngine(config);

        // Part 1 — single-update determinism (Requirement 4.1): the same value-equal MatchOutcome
        // applied twice (on separate engine instances) must return exactly equal updated ratings.
        var firstUpdate = engineA.UpdateRatings(outcome);
        var secondUpdate = engineB.UpdateRatings(outcome);
        var singleUpdateDeterministic = UpdatesExactlyEqual(firstUpdate, secondUpdate);

        // Part 2 — replay determinism (Requirements 5.1, 5.2): replaying the same initial ratings
        // through the same ordered sequence of matches on separate occasions yields identical final
        // ratings. Driven by a dedicated generator for (initial ratings, ordered match sequence).
        var replayDeterministic = Prop.ForAll(
            Arb.From(ReplaySequence()),
            sequence =>
            {
                var (initialRatings, matches) = sequence;

                var firstReplay = engineA.Replay(initialRatings, matches);
                var secondReplay = engineB.Replay(initialRatings, matches);

                return RatingListsExactlyEqual(firstReplay, secondReplay);
            });

        return singleUpdateDeterministic.ToProperty().And(replayDeterministic);
    }

    /// <summary>
    /// Two <see cref="MatchUpdate"/> results are exactly equal when both succeeded and every updated
    /// rating matches byte-for-byte (μ and σ bit-identical). Determinism demands exact, not
    /// tolerance-based, equality.
    /// </summary>
    private static bool UpdatesExactlyEqual(Result<MatchUpdate> first, Result<MatchUpdate> second)
    {
        if (first.IsSuccess != second.IsSuccess)
        {
            return false;
        }

        // A valid outcome from the arbitraries always succeeds; if both failed, the (identical) error
        // path is still deterministic.
        if (!first.IsSuccess)
        {
            return true;
        }

        var firstTeams = first.Value!.Teams;
        var secondTeams = second.Value!.Teams;

        if (firstTeams.Count != secondTeams.Count)
        {
            return false;
        }

        for (var teamIndex = 0; teamIndex < firstTeams.Count; teamIndex++)
        {
            var firstTeam = firstTeams[teamIndex];
            var secondTeam = secondTeams[teamIndex];

            if (firstTeam.Count != secondTeam.Count)
            {
                return false;
            }

            for (var playerIndex = 0; playerIndex < firstTeam.Count; playerIndex++)
            {
                if (!RatingsExactlyEqual(firstTeam[playerIndex], secondTeam[playerIndex]))
                {
                    return false;
                }
            }
        }

        return true;
    }

    /// <summary>Two replay results are exactly equal when both succeeded and every rating is bit-identical.</summary>
    private static bool RatingListsExactlyEqual(
        Result<IReadOnlyList<Rating>> first,
        Result<IReadOnlyList<Rating>> second)
    {
        if (first.IsSuccess != second.IsSuccess)
        {
            return false;
        }

        if (!first.IsSuccess)
        {
            return true;
        }

        var firstRatings = first.Value!;
        var secondRatings = second.Value!;

        if (firstRatings.Count != secondRatings.Count)
        {
            return false;
        }

        for (var index = 0; index < firstRatings.Count; index++)
        {
            if (!RatingsExactlyEqual(firstRatings[index], secondRatings[index]))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>Exact (bit-identical) equality of μ and σ, as required for determinism.</summary>
    private static bool RatingsExactlyEqual(Rating a, Rating b) =>
        a.Mu.Equals(b.Mu) && a.Sigma.Equals(b.Sigma);

    // --- Replay-sequence generator (initial ratings + ordered match sequence) ---

    /// <summary>
    /// Produces a valid replay input: 2–8 players with valid initial ratings, plus an ordered
    /// sequence of 0–5 matches. Each match references the players by their opaque index, partitioned
    /// round-robin into 2–4 non-empty teams with non-negative ranks (ties arise naturally), so every
    /// match is a structurally valid <see cref="MatchOutcome"/> once threaded through replay.
    /// </summary>
    private static Gen<(IReadOnlyList<Rating> InitialRatings, IReadOnlyList<ReplayMatch> Matches)> ReplaySequence() =>
        from playerCount in Gen.Choose(2, 8)
        from initialRatings in ListOfLength(playerCount, RatingGenerators.ValidRating())
        from matchCount in Gen.Choose(0, 5)
        from matches in ListOfLength(matchCount, ReplayMatchGen(playerCount))
        select ((IReadOnlyList<Rating>)initialRatings, (IReadOnlyList<ReplayMatch>)matches);

    /// <summary>A single replay match over <paramref name="playerCount"/> players split into 2–N teams.</summary>
    private static Gen<ReplayMatch> ReplayMatchGen(int playerCount) =>
        from teamCount in Gen.Choose(2, Math.Min(playerCount, 4))
        from ranks in ListOfLength(teamCount, Gen.Choose(0, 3))
        select BuildReplayMatch(playerCount, teamCount, ranks);

    /// <summary>
    /// Assigns every player index round-robin to one of <paramref name="teamCount"/> teams (each team
    /// therefore non-empty when playerCount ≥ teamCount) and attaches the generated ranks.
    /// </summary>
    private static ReplayMatch BuildReplayMatch(int playerCount, int teamCount, IReadOnlyList<int> ranks)
    {
        var buckets = new List<ReplayParticipant>[teamCount];
        for (var teamIndex = 0; teamIndex < teamCount; teamIndex++)
        {
            buckets[teamIndex] = new List<ReplayParticipant>();
        }

        for (var playerIndex = 0; playerIndex < playerCount; playerIndex++)
        {
            buckets[playerIndex % teamCount].Add(new ReplayParticipant(playerIndex));
        }

        var teams = new ReplayTeam[teamCount];
        for (var teamIndex = 0; teamIndex < teamCount; teamIndex++)
        {
            teams[teamIndex] = new ReplayTeam(buckets[teamIndex], ranks[teamIndex]);
        }

        return new ReplayMatch(teams);
    }

    /// <summary>Builds a generator for a list of exactly <paramref name="length"/> items.</summary>
    private static Gen<List<T>> ListOfLength<T>(int length, Gen<T> element)
    {
        if (length <= 0)
        {
            return Gen.Constant(new List<T>());
        }

        return from head in element
               from tail in ListOfLength(length - 1, element)
               select Prepend(head, tail);
    }

    private static List<T> Prepend<T>(T head, List<T> tail)
    {
        var result = new List<T>(tail.Count + 1) { head };
        result.AddRange(tail);
        return result;
    }
}
