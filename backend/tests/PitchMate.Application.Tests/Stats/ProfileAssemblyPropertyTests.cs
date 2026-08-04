using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Stats;
using PitchMate.Domain.Squads;
using PitchMate.Domain.Stats;

namespace PitchMate.Application.Tests.Stats;

/// <summary>
/// Property-based tests for <see cref="GetPlayerProfileHandler"/> assembly (stats-and-summaries design
/// Property 15: Profile assembly and empty profile). The handler is driven against in-memory fakes (no
/// database). For any aggregated <see cref="MembershipStatsData"/> — for a registered or guest subject
/// in any <see cref="MembershipState"/> — the assembled <see cref="PlayerProfile"/> faithfully reflects
/// the aggregates and the pure Domain calculators, and a subject with no appearance yields all-zero /
/// empty values with a null win percentage and a not-yet-established rating. Each property runs at
/// least 100 iterations.
/// </summary>
[Trait("Feature", "stats-and-summaries")]
public class ProfileAssemblyPropertyTests
{
    // Feature: stats-and-summaries, Property 15: Profile assembly and empty profile - for any aggregated
    // MembershipStatsData (registered or guest, any state), the assembled PlayerProfile reflects the
    // aggregates and calculators (record counts sum to appearances, win % matches WinPercentage.Compute,
    // streaks match StreakCalculator, rating summary matches RatingSummary), a guest is assembled with
    // the same definitions as a registered membership, and a subject with no appearance yields all-zero
    // / empty values with a null win percentage and a not-yet-established rating.
    // Validates: Requirements 3.1, 3.3, 3.4
    [Property(MaxTest = 200)]
    [Trait("Property", "15")]
    public Property ProfileFaithfullyReflectsAggregates() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var engine = new ThresholdRatingEngine();
            DisplayRatingParameters parameters = DisplayRatingParameters.Default;

            MembershipStatsData data = scenario.ToData();
            var subject = new MembershipRef(scenario.MembershipId, scenario.DisplayName, scenario.State, scenario.IsGuest);

            // A squad with tracking disabled keeps the focus on always-available statistics.
            Squad squad = Squad.Create("The Squad").Value!;
            Guid userId = Guid.NewGuid();
            SquadMembership requester = SquadMembership.CreateRegistered(squad.Id, userId, "Requester").Value!;

            var handler = new GetPlayerProfileHandler(
                new FakeStatsMembershipRepository(requester),
                new FakeStatsSquadRepository(squad),
                new FakeStatsRepository(subject: subject, data: data),
                new FakeDisplayRatingParametersSource(parameters),
                new FakeRichStatsSource(),
                engine);

            var result = handler
                .HandleAsync(new GetPlayerProfileCommand(userId, squad.Id, scenario.MembershipId), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            if (!result.IsSuccess)
            {
                return false;
            }

            PlayerProfile profile = result.Value!;

            int appearances = scenario.Results.Count;
            int wins = scenario.Results.Count(r => r == PlayerResult.Win);
            int draws = scenario.Results.Count(r => r == PlayerResult.Draw);
            int losses = scenario.Results.Count(r => r == PlayerResult.Loss);

            // Identity and shell reflect the subject reference, independent of registered/guest (Req 3.1, 3.3).
            bool shellOk = profile.MembershipId == scenario.MembershipId
                && profile.DisplayName == scenario.DisplayName
                && profile.State == scenario.State
                && profile.IsGuest == scenario.IsGuest;

            // Record counts sum to appearances and match the generated outcome counts (Req 6.2).
            bool recordOk = profile.Record == new PlayerRecord(appearances, wins, draws, losses)
                && profile.Record.Wins + profile.Record.Draws + profile.Record.Losses == profile.Record.Appearances;

            // Win % matches the pure calculator (null when no appearance) (Req 6.3, 6.4).
            bool winPctOk = profile.WinPercentage == WinPercentage.Compute(wins, appearances);

            // Streaks match the pure fold (Req 9.x).
            bool streaksOk = profile.WinStreak == StreakCalculator.LongestWinStreak(scenario.Results)
                && profile.UnbeatenStreak == StreakCalculator.LongestUnbeatenStreak(scenario.Results);

            // Rating summary: not-yet-established when no rating, otherwise the Domain summary (Req 7.1, 7.7).
            RatingSummary expectedRating = scenario.Mu.HasValue && scenario.Sigma.HasValue
                ? RatingSummary.FromRating(engine, scenario.Mu.Value, scenario.Sigma.Value, parameters)
                : RatingSummary.NotYetEstablished;
            bool ratingOk = profile.Rating == expectedRating;

            bool bibOk = profile.BibAppearances == scenario.BibAppearances;

            // Co-appearance and paired lists reflect the rows, filtered/ordered by the same definitions.
            bool listsOk = profile.MostPlayedWith.SequenceEqual(ExpectedCoAppearances(scenario.CoAppearances, teammates: true))
                && profile.MostPlayedAgainst.SequenceEqual(ExpectedCoAppearances(scenario.CoAppearances, teammates: false))
                && profile.BestPartnerships.SequenceEqual(ExpectedPaired(scenario.Partnerships, bestFirst: true))
                && profile.BogeyOpponents.SequenceEqual(ExpectedPaired(scenario.BogeyOpponents, bestFirst: false));

            // Empty subject: everything zero/empty with a null win % and not-yet-established rating (Req 3.4).
            bool emptyOk = appearances != 0 || (
                profile.Record == new PlayerRecord(0, 0, 0, 0)
                && profile.WinPercentage is null
                && profile.Rating == RatingSummary.NotYetEstablished
                && profile.WinStreak == 0
                && profile.UnbeatenStreak == 0
                && profile.MostPlayedWith.Count == 0
                && profile.MostPlayedAgainst.Count == 0
                && profile.BestPartnerships.Count == 0
                && profile.BogeyOpponents.Count == 0
                && profile.BibAppearances == 0);

            return shellOk && recordOk && winPctOk && streaksOk && ratingOk && bibOk && listsOk && emptyOk;
        });

    private static IReadOnlyList<CoAppearance> ExpectedCoAppearances(
        IReadOnlyList<MembershipStatsData.CoAppearanceRow> rows, bool teammates) =>
        rows.Select(r => new CoAppearance(r.MembershipId, r.DisplayName, teammates ? r.TeammateCount : r.OpponentCount))
            .Where(c => c.Count > 0)
            .OrderByDescending(c => c.Count)
            .ThenBy(c => c.MembershipId, PitchMate.Domain.Common.UuidV7Comparer.Instance)
            .ToList();

    private static IReadOnlyList<PairedStat> ExpectedPaired(
        IReadOnlyList<MembershipStatsData.PairedStatRow> rows, bool bestFirst)
    {
        IEnumerable<PairedStat> stats = rows.Select(r => new PairedStat(
            r.MembershipId, r.DisplayName, WinPercentage.Compute(r.Wins, r.QualifyingMatches) ?? 0.0, r.QualifyingMatches));
        IOrderedEnumerable<PairedStat> ordered = bestFirst
            ? stats.OrderByDescending(s => s.Value)
            : stats.OrderBy(s => s.Value);
        return ordered
            .ThenByDescending(s => s.QualifyingMatches)
            .ThenBy(s => s.MembershipId, PitchMate.Domain.Common.UuidV7Comparer.Instance)
            .ToList();
    }

    /// <summary>The generated inputs of a profile-assembly scenario.</summary>
    private sealed record Scenario(
        Guid MembershipId,
        string DisplayName,
        MembershipState State,
        bool IsGuest,
        IReadOnlyList<PlayerResult> Results,
        double? Mu,
        double? Sigma,
        int BibAppearances,
        IReadOnlyList<MembershipStatsData.CoAppearanceRow> CoAppearances,
        IReadOnlyList<MembershipStatsData.PairedStatRow> Partnerships,
        IReadOnlyList<MembershipStatsData.PairedStatRow> BogeyOpponents,
        IReadOnlyList<MembershipStatsData.RatingSnapshotRow> Snapshots)
    {
        public MembershipStatsData ToData() => new(
            Results.Count,
            Results.Count(r => r == PlayerResult.Win),
            Results.Count(r => r == PlayerResult.Draw),
            Results.Count(r => r == PlayerResult.Loss),
            Results,
            Snapshots,
            Mu,
            Sigma,
            BibAppearances,
            CoAppearances,
            Partnerships,
            BogeyOpponents);
    }

    private static Gen<Scenario> ScenarioGen() =>
        from resultCount in Gen.Choose(0, 12)
        from results in GenList(resultCount, Gen.Elements(PlayerResult.Win, PlayerResult.Draw, PlayerResult.Loss))
        from hasRating in Gen.Elements(true, false)
        from mu in Gen.Choose(150, 350).Select(v => v / 10.0)
        from sigma in Gen.Choose(1, 60).Select(v => v / 10.0)
        from bib in Gen.Choose(0, resultCount)
        from coCount in Gen.Choose(0, 5)
        from coRows in GenList(coCount, CoAppearanceRowGen())
        from partnerCount in Gen.Choose(0, 5)
        from partnerRows in GenList(partnerCount, PairedRowGen())
        from bogeyCount in Gen.Choose(0, 5)
        from bogeyRows in GenList(bogeyCount, PairedRowGen())
        from snapCount in Gen.Choose(0, resultCount)
        from snaps in GenList(snapCount, SnapshotRowGen())
        from isGuest in Gen.Elements(true, false)
        from state in Gen.Elements(MembershipState.Active, MembershipState.Inactive)
        // A subject with no appearance can carry no rating, snapshots, co-appearances, or pairings —
        // just as the real aggregation never yields those without a completed match (Req 3.4).
        let hasAppearance = results.Count > 0
        select new Scenario(
            Guid.NewGuid(),
            isGuest ? "Guest" : "Member",
            state,
            isGuest,
            results,
            hasAppearance && hasRating ? mu : null,
            hasAppearance && hasRating ? sigma : null,
            hasAppearance ? bib : 0,
            hasAppearance ? coRows : [],
            hasAppearance ? partnerRows : [],
            hasAppearance ? bogeyRows : [],
            hasAppearance ? snaps : []);

    private static Gen<MembershipStatsData.CoAppearanceRow> CoAppearanceRowGen() =>
        from teammate in Gen.Choose(0, 6)
        from opponent in Gen.Choose(0, 6)
        from anon in Gen.Elements(true, false)
        select new MembershipStatsData.CoAppearanceRow(
            Guid.NewGuid(), anon ? SquadMembership.DisplayNamePlaceholder : "Other", teammate, opponent);

    private static Gen<MembershipStatsData.PairedStatRow> PairedRowGen() =>
        from qualifying in Gen.Choose(1, 8)
        from wins in Gen.Choose(0, 8)
        from anon in Gen.Elements(true, false)
        select new MembershipStatsData.PairedStatRow(
            Guid.NewGuid(), anon ? SquadMembership.DisplayNamePlaceholder : "Other", Math.Min(wins, qualifying), qualifying);

    private static Gen<MembershipStatsData.RatingSnapshotRow> SnapshotRowGen() =>
        from ticks in Gen.Choose(0, 1_000_000)
        from mu in Gen.Choose(150, 350).Select(v => v / 10.0)
        from sigma in Gen.Choose(1, 60).Select(v => v / 10.0)
        select new MembershipStatsData.RatingSnapshotRow(
            DateTimeOffset.UnixEpoch.AddMinutes(ticks), Guid.NewGuid(), mu, sigma);

    private static Gen<IReadOnlyList<T>> GenList<T>(int length, Gen<T> element)
    {
        if (length <= 0)
        {
            return Gen.Constant((IReadOnlyList<T>)new List<T>());
        }

        return from head in element
               from tail in GenList(length - 1, element)
               select (IReadOnlyList<T>)Prepend(head, tail);
    }

    private static List<T> Prepend<T>(T head, IReadOnlyList<T> tail)
    {
        var list = new List<T>(tail.Count + 1) { head };
        list.AddRange(tail);
        return list;
    }
}
