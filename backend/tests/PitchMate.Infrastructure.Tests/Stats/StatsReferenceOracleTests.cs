using PitchMate.Application.Stats;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Domain.Stats;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Fast, database-free self-checks for the <see cref="StatsReferenceOracle"/> over a small
/// hand-built <see cref="SeededStatsDataset"/>. These pin the oracle's counting/placement definitions
/// (appearances, W/L/D from kickoff-team placement, co-appearances, partnership/bogey numerators, bib
/// appearances, and the leaderboard values) so the reference the model-based property tests compare
/// against is itself trustworthy. The full model-based comparison against real PostgreSQL lands in
/// tasks 6.2–6.11.
/// </summary>
public sealed class StatsReferenceOracleTests
{
    private static readonly Guid M0 = Guid.CreateVersion7();
    private static readonly Guid M1 = Guid.CreateVersion7();
    private static readonly Guid M2 = Guid.CreateVersion7();
    private static readonly Guid M3 = Guid.CreateVersion7();

    /// <summary>
    /// Builds a squad of four active members and one completed two-team match: team A (M0, M1) beat
    /// team B (M2, M3) 3–1, with team B wearing bibs.
    /// </summary>
    private static SeededStatsDataset.SquadData BuildSquad()
    {
        var teamA = new SeededStatsDataset.TeamData(Guid.CreateVersion7(), "Team A", BibFlag: false, Score: 3, [M0, M1]);
        var teamB = new SeededStatsDataset.TeamData(Guid.CreateVersion7(), "Team B", BibFlag: true, Score: 1, [M2, M3]);

        var match = new SeededStatsDataset.MatchData(
            Guid.CreateVersion7(),
            MatchState.Completed,
            DateTimeOffset.UtcNow,
            ResultFidelity.Basic,
            [teamA, teamB],
            [
                new SeededStatsDataset.SnapshotData(M0, 25.0, 4.0),
                new SeededStatsDataset.SnapshotData(M1, 25.0, 4.0),
                new SeededStatsDataset.SnapshotData(M2, 25.0, 4.0),
                new SeededStatsDataset.SnapshotData(M3, 25.0, 4.0)
            ]);

        SeededStatsDataset.MembershipData Member(Guid id) =>
            new(id, $"Name {id:N}", MembershipState.Active, IsGuest: false, IsAnonymised: false, Mu: null, Sigma: null);

        return new SeededStatsDataset.SquadData(
            Guid.CreateVersion7(),
            LiveMatchTracking: false,
            [Member(M0), Member(M1), Member(M2), Member(M3)],
            [match]);
    }

    [Fact]
    public void GetMembershipStats_ForAWinner_ComputesRecordCoAppearancesAndBib()
    {
        SeededStatsDataset.SquadData squad = BuildSquad();

        MembershipStatsData? stats = StatsReferenceOracle.GetMembershipStats(squad, M0);

        Assert.NotNull(stats);
        Assert.Equal(1, stats!.Appearances);
        Assert.Equal(1, stats.Wins);
        Assert.Equal(0, stats.Draws);
        Assert.Equal(0, stats.Losses);
        Assert.Equal(new[] { PlayerResult.Win }, stats.Results);
        Assert.Equal(0, stats.BibAppearances); // M0 is on the non-bib team.
        Assert.Single(stats.Snapshots);

        // Teammate M1 (same team) counted once; opponents M2 and M3 counted once each.
        Assert.Equal(1, stats.CoAppearances.Single(c => c.MembershipId == M1).TeammateCount);
        Assert.Equal(0, stats.CoAppearances.Single(c => c.MembershipId == M1).OpponentCount);
        Assert.Equal(1, stats.CoAppearances.Single(c => c.MembershipId == M2).OpponentCount);
        Assert.Equal(1, stats.CoAppearances.Single(c => c.MembershipId == M3).OpponentCount);

        // Partnership with M1: one qualifying match, one win.
        MembershipStatsData.PairedStatRow partnership = stats.Partnerships.Single(p => p.MembershipId == M1);
        Assert.Equal(1, partnership.Wins);
        Assert.Equal(1, partnership.QualifyingMatches);

        // Bogey rows for the two opponents: one qualifying match each, both wins for M0.
        Assert.Equal(2, stats.BogeyOpponents.Count);
        Assert.All(stats.BogeyOpponents, b => Assert.Equal(1, b.QualifyingMatches));
        Assert.All(stats.BogeyOpponents, b => Assert.Equal(1, b.Wins));
    }

    [Fact]
    public void GetMembershipStats_ForALoser_CountsTheBibAppearance()
    {
        SeededStatsDataset.SquadData squad = BuildSquad();

        MembershipStatsData? stats = StatsReferenceOracle.GetMembershipStats(squad, M2);

        Assert.NotNull(stats);
        Assert.Equal(1, stats!.Losses);
        Assert.Equal(new[] { PlayerResult.Loss }, stats.Results);
        Assert.Equal(1, stats.BibAppearances); // M2 is on the bib-wearing team.
    }

    [Fact]
    public void GetMembershipStats_ForANonMember_ReturnsNull() =>
        Assert.Null(StatsReferenceOracle.GetMembershipStats(BuildSquad(), Guid.CreateVersion7()));

    [Fact]
    public void GetLeaderboardRows_ForWinPercentage_IsHundredForWinnersAndZeroForLosers()
    {
        SeededStatsDataset.SquadData squad = BuildSquad();

        IReadOnlyList<LeaderboardRow> rows = StatsReferenceOracle.GetLeaderboardRows(
            squad,
            LeaderboardStatistic.WinPercentage,
            new PitchMate.Infrastructure.PlackettLuceRatingEngine(new PitchMate.Domain.Rating.RatingEngineConfig()),
            DisplayRatingParameters.Default);

        Assert.Equal(4, rows.Count);
        Assert.Equal(100.0, rows.Single(r => r.MembershipId == M0).Value);
        Assert.Equal(100.0, rows.Single(r => r.MembershipId == M1).Value);
        Assert.Equal(0.0, rows.Single(r => r.MembershipId == M2).Value);
        Assert.Equal(0.0, rows.Single(r => r.MembershipId == M3).Value);
    }

    [Fact]
    public void GetLeaderboardRows_ForWinStreak_CarriesTheOrderedResultSequence()
    {
        SeededStatsDataset.SquadData squad = BuildSquad();

        IReadOnlyList<LeaderboardRow> rows = StatsReferenceOracle.GetLeaderboardRows(
            squad,
            LeaderboardStatistic.WinStreak,
            new PitchMate.Infrastructure.PlackettLuceRatingEngine(new PitchMate.Domain.Rating.RatingEngineConfig()),
            DisplayRatingParameters.Default);

        LeaderboardRow winner = rows.Single(r => r.MembershipId == M0);
        Assert.Null(winner.Value); // Streak rows carry the sequence, not a precomputed value.
        Assert.Equal(new[] { PlayerResult.Win }, winner.Results);
        Assert.Equal(1, StreakCalculator.LongestWinStreak(winner.Results!));
    }
}
