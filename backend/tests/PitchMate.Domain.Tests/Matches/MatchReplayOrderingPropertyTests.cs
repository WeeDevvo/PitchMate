using System.Reflection;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Common;
using PitchMate.Domain.Matches;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Property-based tests for the completed-match replay order (match-lifecycle design Property 21).
/// <para>
/// <see cref="CompletedMatchOrder.ForReplay(System.Collections.Generic.IEnumerable{Match})"/> must,
/// for any set of matches in mixed states and with mixed completion instants (including ties on
/// <see cref="Match.CompletedAt"/> and duplicate instants), yield a <em>stable strict total order</em>
/// over exactly the <see cref="MatchState.Completed"/> matches: sorted ascending by
/// <see cref="Match.CompletedAt"/> then by <see cref="BaseEntity.Id"/> (via
/// <see cref="ChronologicalOrder"/>, whose ultimate discriminator is the unique UUID version 7 Id),
/// excluding every cancelled match and every not-yet-completed match. The order is deterministic:
/// sorting the same set under any input permutation produces the identical sequence
/// (Requirement 12.4, 15.5). The property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchReplayOrderingPropertyTests
{
    /// <summary>A fixed UTC epoch the completion-instant buckets hang off, keeping instants deterministic.</summary>
    private static readonly DateTimeOffset Epoch = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>The private <see cref="Match.State"/> setter, used to place a match into an arbitrary state.</summary>
    private static readonly PropertyInfo StateProperty =
        typeof(Match).GetProperty(nameof(Match.State))
        ?? throw new InvalidOperationException("Match.State property not found.");

    /// <summary>The private <see cref="Match.CompletedAt"/> setter, used to stamp a completion instant.</summary>
    private static readonly PropertyInfo CompletedAtProperty =
        typeof(Match).GetProperty(nameof(Match.CompletedAt))
        ?? throw new InvalidOperationException("Match.CompletedAt property not found.");

    // Feature: match-lifecycle, Property 21: Completed matches form a stable replay order excluding cancelled matches
    // Validates: Requirements 12.4, 15.5
    [Property(MaxTest = 100)]
    [Trait("Property", "21")]
    public Property CompletedMatchesFormAStableReplayOrderExcludingCancelledMatches() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var replay = CompletedMatchOrder.ForReplay(scenario.Matches);

            // 1) Excludes every cancelled match and every non-completed match: the result contains
            //    only Completed matches, each carrying a completion instant.
            var onlyCompleted = replay.All(m => m.State == MatchState.Completed && m.CompletedAt.HasValue);

            // 2) Contains exactly the completed matches — same set of identities, no more, no fewer.
            var expectedCompletedIds = scenario.Matches
                .Where(m => m.State == MatchState.Completed)
                .Select(m => m.Id)
                .ToHashSet();
            var replayIds = replay.Select(m => m.Id).ToList();
            var containsExactlyCompleted =
                replayIds.Count == expectedCompletedIds.Count
                && replayIds.All(expectedCompletedIds.Contains);

            // 3) Sorted ascending by CompletedAt, ties broken by Id (a strict total order): every
            //    adjacent pair is strictly ordered — CompletedAt is non-decreasing, and on a tie the
            //    identity tie-break (ChronologicalOrder) is strictly increasing.
            var strictlyOrdered = true;
            for (var i = 0; i < replay.Count - 1; i++)
            {
                var a = replay[i];
                var b = replay[i + 1];

                var byCompletedAt = a.CompletedAt!.Value.UtcDateTime.CompareTo(b.CompletedAt!.Value.UtcDateTime);
                if (byCompletedAt > 0)
                {
                    strictlyOrdered = false;
                    break;
                }

                if (byCompletedAt == 0 && ChronologicalOrder.Instance.Compare(a, b) >= 0)
                {
                    strictlyOrdered = false;
                    break;
                }

                // The comparer itself must agree that the pair is strictly increasing.
                if (CompletedMatchOrder.Instance.Compare(a, b) >= 0)
                {
                    strictlyOrdered = false;
                    break;
                }
            }

            // 4) Stability / determinism: ordering the same set in any input permutation yields the
            //    identical sequence of identities.
            var deterministic = true;
            foreach (var shuffle in scenario.Shuffles)
            {
                var shuffledIds = CompletedMatchOrder.ForReplay(shuffle).Select(m => m.Id).ToList();
                if (!replayIds.SequenceEqual(shuffledIds))
                {
                    deterministic = false;
                    break;
                }
            }

            return (onlyCompleted && containsExactlyCompleted && strictlyOrdered && deterministic)
                .Label($"replay=[{string.Join(", ", replayIds)}]");
        });

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>A generated set of matches together with shuffled orderings of the same matches.</summary>
    private sealed record ReplayScenario(
        IReadOnlyList<Match> Matches,
        IReadOnlyList<Match[]> Shuffles);

    /// <summary>
    /// Generates a set of matches spanning every <see cref="MatchState"/> with completion instants
    /// drawn from a small bucket of distinct values, so completed matches routinely tie on
    /// <see cref="Match.CompletedAt"/> and exercise the identity tie-break. Non-completed matches
    /// (including cancelled ones) are also stamped with a completion instant so the filter is proven
    /// to key on state, not merely on the presence of an instant. Several shuffles of the same set
    /// accompany each scenario for the determinism check.
    /// </summary>
    private static Gen<ReplayScenario> ScenarioGen()
    {
        var matchesGen =
            from bucketCount in Gen.Choose(1, 4)
            from count in Gen.Choose(0, 12)
            from specs in Gen.ListOf(MatchSpecGen(bucketCount), count)
            select specs.Select(CreateMatch).ToList();

        return
            from matches in matchesGen
            from s1 in Gen.Shuffle<Match>(matches)
            from s2 in Gen.Shuffle<Match>(matches)
            from s3 in Gen.Shuffle<Match>(matches)
            select new ReplayScenario(matches, new[] { matches.ToArray(), s1, s2, s3 });
    }

    /// <summary>Generates a (state, completion-instant bucket) pair spanning the whole state space.</summary>
    private static Gen<MatchSpec> MatchSpecGen(int bucketCount) =>
        from state in Gen.Elements(Enum.GetValues<MatchState>())
        from bucket in Gen.Choose(0, bucketCount - 1)
        select new MatchSpec(state, bucket);

    /// <summary>
    /// Builds a valid draft (which starts in <see cref="MatchState.GatheringAvailability"/>), forces
    /// it into the spec's state, and stamps a bucketed completion instant via the private setters, so
    /// the match under test carries a realistic identity and completion key in every state.
    /// </summary>
    private static Match CreateMatch(MatchSpec spec)
    {
        var now = new DateTimeOffset(2024, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var result = Match.CreateDraft(
            Guid.Empty,
            Guid.NewGuid(),
            "Central Pitch",
            [now.AddDays(1), now.AddDays(2), now.AddDays(3)],
            now);

        var match = result.Value ?? throw new InvalidOperationException("Draft creation failed unexpectedly.");
        StateProperty.SetValue(match, spec.State);
        CompletedAtProperty.SetValue(match, (DateTimeOffset?)Epoch.AddMinutes(spec.CompletedAtBucket));
        return match;
    }

    /// <summary>A description of a match to build: its lifecycle state and a bucketed completion instant.</summary>
    private sealed record MatchSpec(MatchState State, int CompletedAtBucket);
}
