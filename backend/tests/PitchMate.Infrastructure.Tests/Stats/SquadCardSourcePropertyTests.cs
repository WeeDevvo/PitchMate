using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Stats;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Stats;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// <see cref="EfSquadCardSource"/> against generated datasets in real PostgreSQL, checked against the
/// <see cref="StatsReferenceOracle"/>:
/// <list type="bullet">
/// <item><description>the recent form is the oracle's chronological result sequence for the membership,
/// cut to its last five — the same results the player profile reports, in the same order;</description></item>
/// <item><description>the player count is the squad's active memberships, guests included;</description></item>
/// <item><description>the next match is one of the squad's open matches (never completed or cancelled),
/// absent exactly when it has none, and a match in progress whenever one is;</description></item>
/// <item><description>a squad read for no membership has an empty form.</description></item>
/// </list>
/// The datasets span every match state, multi-team and uneven lineups, draws, guests and inactive
/// memberships (see <see cref="StatsDatasetArbitraries"/>). Every case is seeded as fresh squads into
/// one shared, migrated database (<see cref="MembershipStandingScopeHarness"/>), so earlier cases'
/// squads are more squads whose matches must not leak into the card. Requires Docker.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class SquadCardSourcePropertyTests
{
    // Every dataset carries several squads of fifteen to twenty memberships, so each case already
    // makes dozens of comparisons.
    private const int MaxTest = 25;

    private static readonly MatchState[] OpenStates =
    [
        MatchState.GatheringAvailability,
        MatchState.Confirmed,
        MatchState.TeamsRolled,
        MatchState.InProgress,
    ];

    private readonly MembershipStandingScopeHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public SquadCardSourcePropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = new MembershipStandingScopeHarness(fixture, "squad_card_source");
    }

    [Property(MaxTest = MaxTest, Arbitrary = new[] { typeof(StatsDatasetArbitraries) })]
    public Property CardFactsAgreeWithTheOracle(StatsDatasetSpec spec) =>
        RunAsync(async () =>
        {
            SeededStatsDataset seeded = await _harness.SeedAsync(spec);

            foreach (SeededStatsDataset.SquadData squad in seeded.Squads)
            {
                int activePlayers = squad.Memberships.Count(member => member.State == MembershipState.Active);
                var openMatches = squad.Matches.Where(match => OpenStates.Contains(match.State)).ToList();

                SquadCardFacts anonymous = await _harness.ReadSquadCardAsync(squad.SquadId, null);
                Assert.Empty(anonymous.RecentForm);
                Assert.Equal(activePlayers, anonymous.PlayerCount);
                AssertNextMatch(openMatches, anonymous.NextMatch);

                foreach (SeededStatsDataset.MembershipData member in squad.Memberships)
                {
                    MembershipStatsData expected =
                        StatsReferenceOracle.GetMembershipStats(squad, member.MembershipId)!;
                    SquadCardFacts card = await _harness.ReadSquadCardAsync(squad.SquadId, member.MembershipId);

                    Assert.Equal(expected.Results.TakeLast(EfSquadCardSource.FormLength), card.RecentForm);
                    Assert.Equal(activePlayers, card.PlayerCount);
                    Assert.Equal(anonymous.NextMatch, card.NextMatch);
                }
            }

            return true;
        });

    private static void AssertNextMatch(
        IReadOnlyList<SeededStatsDataset.MatchData> openMatches,
        UpcomingMatchFacts? next)
    {
        if (openMatches.Count == 0)
        {
            Assert.Null(next);
            return;
        }

        Assert.NotNull(next);
        SeededStatsDataset.MatchData chosen = Assert.Single(openMatches, match => match.MatchId == next!.MatchId);
        Assert.Equal(chosen.State, next!.State);

        if (openMatches.Any(match => match.State == MatchState.InProgress))
        {
            Assert.Equal(MatchState.InProgress, next.State);
        }

        // Only a confirmed match has a day; one still gathering availability has none.
        Assert.Equal(next.State != MatchState.GatheringAvailability, next.ScheduledAt is not null);
    }

    private static Property RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult().ToProperty();
}
