using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Stats;
using PitchMate.Domain.Squads;
using PitchMate.Domain.Stats;

namespace PitchMate.Application.Tests.Stats;

/// <summary>
/// Property-based tests for <see cref="GetPlayerProfileHandler"/> rich-statistics gating
/// (stats-and-summaries design Property 16: Rich-statistics gating and graceful degradation). Driven
/// against in-memory fakes. When <see cref="SquadFeature.LiveMatchTracking"/> is disabled
/// <see cref="PlayerProfile.Rich"/> is omitted (<see langword="null"/>) regardless of what the rich
/// source would return; when enabled and the source has no data the profile reports "no data" (a
/// <see cref="RichStats"/> whose fields are all <see langword="null"/>); when enabled and the source
/// has data it is surfaced; and the always-available statistics are identical either way. Each property
/// runs at least 100 iterations.
/// </summary>
[Trait("Feature", "stats-and-summaries")]
public class RichStatsGatingPropertyTests
{
    // Feature: stats-and-summaries, Property 16: Rich-statistics gating and graceful degradation - when
    // LiveMatchTracking is disabled PlayerProfile.Rich is null (omitted, no placeholder) regardless of
    // what IRichStatsSource would return; when enabled and the source returns null Rich reports "no
    // data" (a RichStats with all-null fields); when enabled and the source returns data that data is
    // surfaced; and the presence or absence of rich detail never changes an always-available statistic.
    // Validates: Requirements 3.2, 13.1, 13.2, 13.6, 13.7, 13.8
    [Property(MaxTest = 200)]
    [Trait("Property", "16")]
    public Property RichStatsAreGatedAndDegradeGracefully() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            MembershipStatsData data = scenario.ToData();
            Guid membershipId = Guid.NewGuid();
            var subject = new MembershipRef(membershipId, "Member", MembershipState.Active, IsGuest: false);
            Guid userId = Guid.NewGuid();

            PlayerProfile enabled = RunProfile(data, subject, userId, scenario.RichPayload, trackingEnabled: true);
            PlayerProfile disabled = RunProfile(data, subject, userId, scenario.RichPayload, trackingEnabled: false);

            // Disabled: Rich omitted entirely regardless of what the source would return (Req 3.2, 13.1).
            bool disabledOmitsRich = disabled.Rich is null;

            // Enabled: the source's data when present, otherwise a "no data" record (Req 13.2, 13.7).
            RichStats expectedRich = scenario.RichPayload ?? new RichStats(null, null, null, null);
            bool enabledSurfacesRich = enabled.Rich == expectedRich;

            // The always-available statistics never change with the rich gating (Req 13.6).
            bool alwaysAvailableUnchanged =
                enabled.Record == disabled.Record
                && enabled.WinPercentage == disabled.WinPercentage
                && enabled.WinStreak == disabled.WinStreak
                && enabled.UnbeatenStreak == disabled.UnbeatenStreak
                && enabled.BibAppearances == disabled.BibAppearances
                && enabled.Rating == disabled.Rating
                && enabled.Progression.Count == disabled.Progression.Count;

            return (disabledOmitsRich && enabledSurfacesRich && alwaysAvailableUnchanged).ToProperty();
        });

    private static PlayerProfile RunProfile(
        MembershipStatsData data,
        MembershipRef subject,
        Guid userId,
        RichStats? richPayload,
        bool trackingEnabled)
    {
        Squad squad = Squad.Create("The Squad").Value!;
        squad.SetFeature(SquadFeature.LiveMatchTracking, trackingEnabled);
        SquadMembership requester = SquadMembership.CreateRegistered(squad.Id, userId, "Requester").Value!;

        var handler = new GetPlayerProfileHandler(
            new FakeStatsMembershipRepository(requester),
            new FakeStatsSquadRepository(squad),
            new FakeStatsRepository(subject: subject, data: data),
            new FakeDisplayRatingParametersSource(DisplayRatingParameters.Default),
            new FakeRichStatsSource(richPayload),
            new ThresholdRatingEngine());

        var result = handler
            .HandleAsync(new GetPlayerProfileCommand(userId, squad.Id, subject.MembershipId), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        Assert.True(result.IsSuccess);
        return result.Value!;
    }

    private sealed record Scenario(IReadOnlyList<PlayerResult> Results, RichStats? RichPayload)
    {
        public MembershipStatsData ToData() => new(
            Results.Count,
            Results.Count(r => r == PlayerResult.Win),
            Results.Count(r => r == PlayerResult.Draw),
            Results.Count(r => r == PlayerResult.Loss),
            Results,
            [],
            Mu: null,
            Sigma: null,
            BibAppearances: 0,
            CoAppearances: [],
            Partnerships: [],
            BogeyOpponents: []);
    }

    private static Gen<Scenario> ScenarioGen() =>
        from count in Gen.Choose(0, 8)
        from results in GenList(count, Gen.Elements(PlayerResult.Win, PlayerResult.Draw, PlayerResult.Loss))
        from rich in RichPayloadGen()
        select new Scenario(results, rich);

    private static Gen<RichStats?> RichPayloadGen() =>
        from hasData in Gen.Elements(true, false)
        from goals in Gen.Choose(0, 30)
        from cleanSheets in Gen.Choose(0, 15)
        from conceded in Gen.Choose(0, 40)
        from keeperMinutes in Gen.Choose(0, 600)
        select hasData
            ? new RichStats(goals, cleanSheets, conceded, TimeSpan.FromMinutes(keeperMinutes))
            : (RichStats?)null;

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
