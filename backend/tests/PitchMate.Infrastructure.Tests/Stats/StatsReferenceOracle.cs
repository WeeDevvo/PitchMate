using PitchMate.Application.Stats;
using PitchMate.Domain.Common;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Stats;
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using PlayerRating = PitchMate.Domain.Rating.Rating;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// A pure, in-memory reference implementation of the stats definitions, computed over a resolved
/// <see cref="SeededStatsDataset"/>. It is the <em>source of truth</em> the model-based property tests
/// (tasks 6.2–6.11) compare the real <c>EfStatsRepository</c> SQL against: its methods mirror
/// <see cref="IStatsRepository"/> shape-for-shape so a test can call the same operation on both and
/// assert equality.
/// <para>
/// It deliberately reuses the Domain calculators the production read path uses — <see cref="WinPercentage"/>
/// for the win-percentage leaderboard value and <see cref="DisplayRatingCalculator"/> plus
/// <see cref="IRatingEngine.GetState"/> for the display-rating leaderboard — and re-derives the
/// counting/placement definitions (appearances, W/L/D from kickoff-team placement, streak sequences,
/// bib appearances, co-appearance and partnership/bogey numerators/denominators, rating progression)
/// independently, so the SQL and the specification stay provably in step. Every computation is
/// squad-scoped and restricted to <see cref="MatchState.Completed"/> matches, and chronological order
/// is completion instant then match identity compared with <see cref="UuidV7Comparer"/> to match
/// PostgreSQL <c>uuid</c> ordering.
/// </para>
/// </summary>
public static class StatsReferenceOracle
{
    /// <summary>
    /// Computes the compact per-membership Profile aggregates for <paramref name="membershipId"/> in
    /// <paramref name="squad"/>, mirroring <see cref="IStatsRepository.GetMembershipStatsAsync"/>:
    /// <see langword="null"/> when the membership does not belong to the squad, otherwise its
    /// appearance/W/L/D counts, chronological <see cref="PlayerResult"/> sequence, ordered snapshot
    /// rows, current μ/σ, bib count, and the co-appearance and partnership/bogey rows. The row
    /// collections are ordered by membership identity for determinism; a comparison should treat them
    /// as unordered because the SQL does not guarantee an order.
    /// </summary>
    /// <param name="squad">The squad the statistics are scoped to.</param>
    /// <param name="membershipId">The subject membership.</param>
    /// <returns>The subject's aggregates, or <see langword="null"/> when it is not a member of the squad.</returns>
    public static MembershipStatsData? GetMembershipStats(SeededStatsDataset.SquadData squad, Guid membershipId)
    {
        ArgumentNullException.ThrowIfNull(squad);

        SeededStatsDataset.MembershipData? subject =
            squad.Memberships.FirstOrDefault(m => m.MembershipId == membershipId);
        if (subject is null)
        {
            return null;
        }

        List<SeededStatsDataset.MatchData> completed = CompletedInOrder(squad);

        List<SeededStatsDataset.MatchData> appearances = completed
            .Where(match => match.Teams.Any(team => team.Roster.Contains(membershipId)))
            .ToList();

        var results = new List<PlayerResult>(appearances.Count);
        int wins = 0, draws = 0, losses = 0, bibAppearances = 0;

        var teammateCounts = new Dictionary<Guid, int>();
        var opponentCounts = new Dictionary<Guid, int>();
        var teammateWins = new Dictionary<Guid, int>();
        var opponentWins = new Dictionary<Guid, int>();

        foreach (SeededStatsDataset.MatchData match in appearances)
        {
            SeededStatsDataset.TeamData subjectTeam =
                match.Teams.First(team => team.Roster.Contains(membershipId));

            PlayerResult result = ResultFor(match, subjectTeam);
            results.Add(result);
            switch (result)
            {
                case PlayerResult.Win: wins++; break;
                case PlayerResult.Draw: draws++; break;
                default: losses++; break;
            }

            if (subjectTeam.BibFlag)
            {
                bibAppearances++;
            }

            bool isWin = result == PlayerResult.Win;

            foreach (Guid teammateId in subjectTeam.Roster)
            {
                if (teammateId == membershipId)
                {
                    continue;
                }

                teammateCounts[teammateId] = teammateCounts.GetValueOrDefault(teammateId) + 1;
                if (isWin)
                {
                    teammateWins[teammateId] = teammateWins.GetValueOrDefault(teammateId) + 1;
                }
            }

            foreach (SeededStatsDataset.TeamData team in match.Teams)
            {
                if (team.TeamId == subjectTeam.TeamId)
                {
                    continue;
                }

                foreach (Guid opponentId in team.Roster)
                {
                    if (opponentId == membershipId)
                    {
                        continue;
                    }

                    opponentCounts[opponentId] = opponentCounts.GetValueOrDefault(opponentId) + 1;
                    if (isWin)
                    {
                        opponentWins[opponentId] = opponentWins.GetValueOrDefault(opponentId) + 1;
                    }
                }
            }
        }

        var snapshots = completed
            .SelectMany(match => match.Snapshots
                .Where(snapshot => snapshot.MembershipId == membershipId)
                .Select(snapshot => new MembershipStatsData.RatingSnapshotRow(
                    match.CompletedAt.GetValueOrDefault(), match.MatchId, snapshot.Mu, snapshot.Sigma)))
            .OrderBy(row => row.CompletedAt)
            .ThenBy(row => row.MatchId, UuidV7Comparer.Instance)
            .ToList();

        string NameOf(Guid id) =>
            squad.Memberships.FirstOrDefault(m => m.MembershipId == id)?.DisplayName ?? string.Empty;

        List<Guid> partnerIds = teammateCounts.Keys
            .Union(opponentCounts.Keys)
            .OrderBy(id => id, UuidV7Comparer.Instance)
            .ToList();

        var coAppearances = partnerIds
            .Select(id => new MembershipStatsData.CoAppearanceRow(
                id, NameOf(id), teammateCounts.GetValueOrDefault(id), opponentCounts.GetValueOrDefault(id)))
            .ToList();

        var partnerships = teammateCounts
            .OrderBy(pair => pair.Key, UuidV7Comparer.Instance)
            .Select(pair => new MembershipStatsData.PairedStatRow(
                pair.Key, NameOf(pair.Key), teammateWins.GetValueOrDefault(pair.Key), pair.Value))
            .ToList();

        var bogeyOpponents = opponentCounts
            .OrderBy(pair => pair.Key, UuidV7Comparer.Instance)
            .Select(pair => new MembershipStatsData.PairedStatRow(
                pair.Key, NameOf(pair.Key), opponentWins.GetValueOrDefault(pair.Key), pair.Value))
            .ToList();

        return new MembershipStatsData(
            Appearances: appearances.Count,
            Wins: wins,
            Draws: draws,
            Losses: losses,
            Results: results,
            Snapshots: snapshots,
            Mu: subject.Mu,
            Sigma: subject.Sigma,
            BibAppearances: bibAppearances,
            CoAppearances: coAppearances,
            Partnerships: partnerships,
            BogeyOpponents: bogeyOpponents);
    }

    /// <summary>
    /// Computes the eligible per-membership ranking rows for <paramref name="statistic"/> in
    /// <paramref name="squad"/>, mirroring <see cref="IStatsRepository.GetLeaderboardRowsAsync"/>. For
    /// the display-rating statistic the rows are the memberships with an <c>Established</c> rating
    /// (classified via <paramref name="engine"/> and mapped by <see cref="DisplayRatingCalculator"/>
    /// with <paramref name="parameters"/>); for every other statistic the rows are the memberships with
    /// at least one appearance, carrying either the precomputed value or (for a streak) the ordered
    /// <see cref="PlayerResult"/> sequence for the handler's fold. The rows are unordered, exactly as
    /// the SQL returns them.
    /// </summary>
    /// <param name="squad">The squad the leaderboard is scoped to.</param>
    /// <param name="statistic">The statistic the rows are ranked by.</param>
    /// <param name="engine">The rating engine used to classify state for the display-rating statistic.</param>
    /// <param name="parameters">The squad's display-rating parameters.</param>
    /// <returns>The eligible per-membership ranking rows.</returns>
    public static IReadOnlyList<LeaderboardRow> GetLeaderboardRows(
        SeededStatsDataset.SquadData squad,
        LeaderboardStatistic statistic,
        IRatingEngine engine,
        DisplayRatingParameters parameters)
    {
        ArgumentNullException.ThrowIfNull(squad);
        ArgumentNullException.ThrowIfNull(engine);

        return statistic == LeaderboardStatistic.DisplayRating
            ? DisplayRatingRows(squad, engine, parameters)
            : AppearanceBasedRows(squad, statistic);
    }

    /// <summary>
    /// Locates the subject membership within the squad, mirroring
    /// <see cref="IStatsRepository.FindMembershipAsync"/>: a <see cref="MembershipRef"/> when it
    /// belongs to the squad, otherwise <see langword="null"/>.
    /// </summary>
    /// <param name="squad">The squad the membership must belong to.</param>
    /// <param name="membershipId">The subject membership to locate.</param>
    /// <returns>The membership reference, or <see langword="null"/> when it is not a member of the squad.</returns>
    public static MembershipRef? FindMembership(SeededStatsDataset.SquadData squad, Guid membershipId)
    {
        ArgumentNullException.ThrowIfNull(squad);

        SeededStatsDataset.MembershipData? member =
            squad.Memberships.FirstOrDefault(m => m.MembershipId == membershipId);
        return member is null
            ? null
            : new MembershipRef(member.MembershipId, member.DisplayName, member.State, member.IsGuest);
    }

    private static IReadOnlyList<LeaderboardRow> DisplayRatingRows(
        SeededStatsDataset.SquadData squad, IRatingEngine engine, DisplayRatingParameters parameters)
    {
        var rows = new List<LeaderboardRow>();
        foreach (SeededStatsDataset.MembershipData member in squad.Memberships)
        {
            if (member.Mu is not double mu || member.Sigma is not double sigma)
            {
                continue;
            }

            var state = engine.GetState(new PlayerRating(mu, sigma));
            if (!state.IsSuccess)
            {
                continue;
            }

            int? displayRating = DisplayRatingCalculator.Compute(state.Value, mu, sigma, parameters);
            if (displayRating is null)
            {
                continue;
            }

            rows.Add(new LeaderboardRow(member.MembershipId, member.DisplayName, member.State, displayRating.Value, null));
        }

        return rows;
    }

    private static IReadOnlyList<LeaderboardRow> AppearanceBasedRows(
        SeededStatsDataset.SquadData squad, LeaderboardStatistic statistic)
    {
        bool needsResults =
            statistic is LeaderboardStatistic.WinStreak or LeaderboardStatistic.UnbeatenStreak;

        var appearances = new Dictionary<Guid, int>();
        var wins = new Dictionary<Guid, int>();
        var bibAppearances = new Dictionary<Guid, int>();
        var results = new Dictionary<Guid, List<PlayerResult>>();

        foreach (SeededStatsDataset.MatchData match in CompletedInOrder(squad))
        {
            foreach (SeededStatsDataset.TeamData team in match.Teams)
            {
                PlayerResult result = ResultFor(match, team);
                foreach (Guid membershipId in team.Roster)
                {
                    appearances[membershipId] = appearances.GetValueOrDefault(membershipId) + 1;

                    if (team.BibFlag)
                    {
                        bibAppearances[membershipId] = bibAppearances.GetValueOrDefault(membershipId) + 1;
                    }

                    if (result == PlayerResult.Win)
                    {
                        wins[membershipId] = wins.GetValueOrDefault(membershipId) + 1;
                    }

                    if (needsResults)
                    {
                        if (!results.TryGetValue(membershipId, out List<PlayerResult>? sequence))
                        {
                            sequence = [];
                            results[membershipId] = sequence;
                        }

                        sequence.Add(result);
                    }
                }
            }
        }

        double? ValueFor(Guid membershipId) => statistic switch
        {
            LeaderboardStatistic.Appearances => appearances.GetValueOrDefault(membershipId),
            LeaderboardStatistic.BibAppearances => bibAppearances.GetValueOrDefault(membershipId),
            LeaderboardStatistic.WinPercentage => WinPercentage.Compute(
                wins.GetValueOrDefault(membershipId), appearances.GetValueOrDefault(membershipId)),
            _ => appearances.GetValueOrDefault(membershipId)
        };

        var rows = new List<LeaderboardRow>(appearances.Count);
        foreach (Guid membershipId in appearances.Keys)
        {
            SeededStatsDataset.MembershipData member =
                squad.Memberships.First(m => m.MembershipId == membershipId);
            rows.Add(new LeaderboardRow(
                member.MembershipId,
                member.DisplayName,
                member.State,
                needsResults ? null : ValueFor(membershipId),
                needsResults ? results.GetValueOrDefault(membershipId, []) : null));
        }

        return rows;
    }

    /// <summary>The squad's completed matches in the stable chronological order (completion instant then match id).</summary>
    private static List<SeededStatsDataset.MatchData> CompletedInOrder(SeededStatsDataset.SquadData squad) =>
        squad.Matches
            .Where(match => match.State == MatchState.Completed)
            .OrderBy(match => match.CompletedAt)
            .ThenBy(match => match.MatchId, UuidV7Comparer.Instance)
            .ToList();

    /// <summary>
    /// Derives a team's <see cref="PlayerResult"/> from its placement in the match outcome: a win for
    /// the uniquely best score, a draw for a best score shared by two or more teams, a loss otherwise
    /// (Requirement 6.1, 6.5).
    /// </summary>
    private static PlayerResult ResultFor(SeededStatsDataset.MatchData match, SeededStatsDataset.TeamData team)
    {
        int bestScore = match.Teams.Max(t => t.Score);
        int teamsAtBest = match.Teams.Count(t => t.Score == bestScore);
        return team.Score == bestScore
            ? (teamsAtBest == 1 ? PlayerResult.Win : PlayerResult.Draw)
            : PlayerResult.Loss;
    }
}
