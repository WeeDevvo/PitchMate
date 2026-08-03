using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Stats;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;
using PitchMate.Domain.Stats;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Stats;

/// <summary>
/// EF Core implementation of <see cref="IStatsRepository"/> over the shared
/// <see cref="PitchMateDbContext"/>, providing the squad-scoped, <c>Completed</c>-only aggregation
/// the stats read surface is shaped from (Requirement 2.1, 2.3, 2.5). Registered scoped so it shares
/// the request's context; every query honours the global soft-delete query filter.
/// <para>
/// The match aggregate persists its immutable <see cref="Match.KickoffLineup"/> and its
/// <see cref="Match.RecordedResult"/> as opaque <c>jsonb</c> documents (value-converted, so not
/// LINQ-queryable), while the working <see cref="MatchTeam"/> rows expose a native <c>uuid[]</c>
/// roster, a bib flag, and the team identity the recorded per-team scores are keyed on. For a
/// <see cref="MatchState.Completed"/> match the teams are frozen at the last lock and therefore equal
/// the captured kickoff lineup one-to-one — this is exactly the correspondence
/// <see cref="Match.DeriveOutcome"/> relies on to feed the rating engine — so the aggregation reads
/// the queryable <see cref="MatchTeam"/> rows as the completed match's lineup and maps each team's
/// recorded score by team identity to derive its placement. All squad/state scoping and the
/// membership-containment filter are pushed into Postgres, and only the subject membership's own
/// matches (bounded by its appearance count) are materialised — never a whole-squad row set
/// (Requirement 2.5).
/// </para>
/// </summary>
/// <remarks>
/// The <see cref="IRatingEngine"/> and <see cref="IDisplayRatingParametersSource"/> dependencies are
/// used solely by the <c>Display_Rating</c> leaderboard, where the store aggregates each membership's
/// current μ/σ and the pure Domain classification/mapping
/// (<see cref="IRatingEngine.GetState"/> then <see cref="DisplayRatingCalculator.Compute"/>) turns it
/// into the ranking value and drives eligibility (a value is present only for an <c>Established</c>
/// rating — Requirement 4.5, 7.2). Every other leaderboard statistic and the whole Profile aggregate
/// are computed without them.
/// </remarks>
internal sealed class EfStatsRepository(
    PitchMateDbContext db,
    IRatingEngine ratingEngine,
    IDisplayRatingParametersSource displayRatingParameters) : IStatsRepository
{
    /// <inheritdoc />
    public async Task<MembershipStatsData?> GetMembershipStatsAsync(
        Guid squadId, Guid membershipId, CancellationToken ct)
    {
        // The subject must belong to the target squad; otherwise conceal it with a null so the handler
        // returns a uniform NotFound (Requirement 3.6). The soft-delete filter is applied automatically.
        bool belongsToSquad = await db.Set<SquadMembership>()
            .AnyAsync(member => member.Id == membershipId && member.SquadId == squadId, ct);
        if (!belongsToSquad)
        {
            return null;
        }

        // Completed matches of the squad — the only matches that contribute to statistics
        // (Requirement 2.3). Filtering is pushed into Postgres.
        IQueryable<Match> completed = db.Set<Match>()
            .Where(match => match.SquadId == squadId && match.State == MatchState.Completed);

        // The distinct completed matches the subject appeared in the kickoff lineup of, derived from the
        // working-team rosters (which equal the kickoff lineup for a completed match). The containment
        // filter and the completed-match join are evaluated in Postgres, so only the subject's matches
        // are ever returned (Requirement 2.5, 5.1, 5.2, 5.3).
        List<Guid> appearanceMatchIds = await db.Set<MatchTeam>()
            .Where(team => team.Roster.Contains(membershipId))
            .Join(completed, team => team.MatchId, match => match.Id, (team, match) => match.Id)
            .Distinct()
            .ToListAsync(ct);

        // The subject's completed matches in chronological order (completion instant then match id,
        // matching the stable order used everywhere else), carrying each match's recorded result so the
        // per-team scores can be mapped to placements (Requirement 8.1, 9.1).
        var matchInfos = await db.Set<Match>()
            .Where(match => appearanceMatchIds.Contains(match.Id))
            .OrderBy(match => match.CompletedAt)
            .ThenBy(match => match.Id)
            .Select(match => new { match.Id, match.RecordedResult })
            .ToListAsync(ct);

        // Every team of each of the subject's matches — identity (for score mapping), bib flag, and
        // roster (for appearances, placement, co-appearance, and partnership derivation).
        var teamRows = await db.Set<MatchTeam>()
            .Where(team => appearanceMatchIds.Contains(team.MatchId))
            .Select(team => new { team.MatchId, team.Id, team.BibFlag, team.Roster })
            .ToListAsync(ct);

        // The subject's rating snapshots, one per completed match it has a snapshot in, ordered
        // chronologically for the rating progression (Requirement 8.1, 8.2).
        var snapshotRows = await (
            from snapshot in db.Set<RatingSnapshot>()
            join match in completed on snapshot.MatchId equals match.Id
            where snapshot.SquadMembershipId == membershipId
            orderby match.CompletedAt, match.Id
            select new { match.CompletedAt, snapshot.MatchId, snapshot.Mu, snapshot.Sigma })
            .ToListAsync(ct);

        // The subject's current rating (μ, σ), or none when it has never participated (Requirement 7.7).
        var currentRating = await db.Set<MembershipRating>()
            .Where(rating => rating.SquadMembershipId == membershipId)
            .Select(rating => new { rating.Mu, rating.Sigma })
            .FirstOrDefaultAsync(ct);

        var teamsByMatch = teamRows
            .GroupBy(row => row.MatchId)
            .ToDictionary(group => group.Key, group => group.ToList());

        var results = new List<PlayerResult>(matchInfos.Count);
        int wins = 0, draws = 0, losses = 0, bibAppearances = 0;

        // Per-partner accumulators, keyed by the other membership's identity.
        var teammateCounts = new Dictionary<Guid, int>();
        var opponentCounts = new Dictionary<Guid, int>();
        var teammateWins = new Dictionary<Guid, int>();
        var opponentWins = new Dictionary<Guid, int>();

        foreach (var matchInfo in matchInfos)
        {
            if (!teamsByMatch.TryGetValue(matchInfo.Id, out var teams) || teams.Count == 0)
            {
                continue;
            }

            var subjectTeam = teams.FirstOrDefault(team => team.Roster.Contains(membershipId));
            if (subjectTeam is null)
            {
                continue;
            }

            // Map each team's recorded final score by team identity; a team with no recorded score
            // (not expected for a completed match) scores zero.
            var scoreByTeamId = new Dictionary<Guid, int>();
            if (matchInfo.RecordedResult is not null)
            {
                foreach (TeamScore teamScore in matchInfo.RecordedResult.TeamScores)
                {
                    scoreByTeamId[teamScore.TeamId] = teamScore.Score;
                }
            }

            int ScoreOf(Guid teamId) => scoreByTeamId.TryGetValue(teamId, out int score) ? score : 0;

            int subjectScore = ScoreOf(subjectTeam.Id);
            int bestScore = teams.Max(team => ScoreOf(team.Id));
            int teamsAtBest = teams.Count(team => ScoreOf(team.Id) == bestScore);

            // Win = uniquely best placement, Draw = best placement shared, Loss = worse than best
            // (Requirement 6.1, 6.5).
            PlayerResult result = subjectScore == bestScore
                ? (teamsAtBest == 1 ? PlayerResult.Win : PlayerResult.Draw)
                : PlayerResult.Loss;

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

            // Teammates share the subject's kickoff team; opponents are on any other team. Each pair is
            // counted at most once per match because the rosters partition the participants
            // (Requirement 10.1, 10.2, 10.5).
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

            foreach (var team in teams)
            {
                if (team.Id == subjectTeam.Id)
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

        // Resolve the display names of every other membership the subject shared a match with — the
        // "Former player" placeholder is already carried by an anonymised membership (Requirement 14.4).
        var partnerIds = teammateCounts.Keys.Union(opponentCounts.Keys).ToList();
        Dictionary<Guid, string> namesById = partnerIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await db.Set<SquadMembership>()
                .Where(member => member.SquadId == squadId && partnerIds.Contains(member.Id))
                .Select(member => new { member.Id, member.DisplayName })
                .ToDictionaryAsync(member => member.Id, member => member.DisplayName, ct);

        string NameOf(Guid id) => namesById.TryGetValue(id, out string? name) ? name : string.Empty;

        var coAppearances = partnerIds
            .Select(id => new MembershipStatsData.CoAppearanceRow(
                id,
                NameOf(id),
                teammateCounts.GetValueOrDefault(id),
                opponentCounts.GetValueOrDefault(id)))
            .ToList();

        var partnerships = teammateCounts
            .Select(pair => new MembershipStatsData.PairedStatRow(
                pair.Key,
                NameOf(pair.Key),
                teammateWins.GetValueOrDefault(pair.Key),
                pair.Value))
            .ToList();

        var bogeyOpponents = opponentCounts
            .Select(pair => new MembershipStatsData.PairedStatRow(
                pair.Key,
                NameOf(pair.Key),
                opponentWins.GetValueOrDefault(pair.Key),
                pair.Value))
            .ToList();

        var snapshots = snapshotRows
            .Select(row => new MembershipStatsData.RatingSnapshotRow(
                row.CompletedAt.GetValueOrDefault(),
                row.MatchId,
                row.Mu,
                row.Sigma))
            .ToList();

        return new MembershipStatsData(
            Appearances: matchInfos.Count,
            Wins: wins,
            Draws: draws,
            Losses: losses,
            Results: results,
            Snapshots: snapshots,
            Mu: currentRating?.Mu,
            Sigma: currentRating?.Sigma,
            BibAppearances: bibAppearances,
            CoAppearances: coAppearances,
            Partnerships: partnerships,
            BogeyOpponents: bogeyOpponents);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<LeaderboardRow>> GetLeaderboardRowsAsync(
        Guid squadId, LeaderboardStatistic statistic, CancellationToken ct) =>
        statistic == LeaderboardStatistic.DisplayRating
            ? await GetDisplayRatingRowsAsync(squadId, ct)
            : await GetAppearanceBasedRowsAsync(squadId, statistic, ct);

    /// <summary>
    /// Builds the eligible ranking rows for every leaderboard statistic derived from the completed-match
    /// lineups — Appearances, Win_Percentage, Bib_Appearances, and the two streaks. All squad/state
    /// scoping and the lineup join are pushed into Postgres; because a team's recorded final scores live
    /// in the opaque <c>jsonb</c> result (not LINQ-queryable) and the streaks are an inherently
    /// sequential fold, the compact per-team lineup rows and per-match scores are reduced in memory —
    /// exactly the constraint task 5.1 documented. Only memberships with at least one appearance are
    /// returned, so a counting statistic already carries its eligibility (Requirement 4.1, 4.4). A streak
    /// statistic carries the membership's ordered <see cref="PlayerResult"/> sequence for the handler's
    /// pure fold; every other statistic carries a precomputed value.
    /// </summary>
    private async Task<IReadOnlyList<LeaderboardRow>> GetAppearanceBasedRowsAsync(
        Guid squadId, LeaderboardStatistic statistic, CancellationToken ct)
    {
        // Completed matches of the squad — the only matches that contribute to statistics
        // (Requirement 2.3). All filtering is pushed into Postgres.
        IQueryable<Match> completed = db.Set<Match>()
            .Where(match => match.SquadId == squadId && match.State == MatchState.Completed);

        // Every team of every completed squad match: identity (for score mapping), bib flag, and roster.
        // The completed-match join is evaluated in Postgres so no non-completed match leaks in.
        var teamRows = await db.Set<MatchTeam>()
            .Join(completed, team => team.MatchId, match => match.Id, (team, _) => team)
            .Select(team => new { team.MatchId, team.Id, team.BibFlag, team.Roster })
            .ToListAsync(ct);

        // The completed matches in chronological order (completion instant then match id — the stable
        // order used everywhere else), each carrying its recorded result so per-team scores map to
        // placements (Requirement 6.1, 9.1).
        var matchInfos = await completed
            .OrderBy(match => match.CompletedAt)
            .ThenBy(match => match.Id)
            .Select(match => new { match.Id, match.RecordedResult })
            .ToListAsync(ct);

        var teamsByMatch = teamRows
            .GroupBy(row => row.MatchId)
            .ToDictionary(group => group.Key, group => group.ToList());

        bool needsResults =
            statistic is LeaderboardStatistic.WinStreak or LeaderboardStatistic.UnbeatenStreak;

        // Per-membership accumulators, keyed by membership identity.
        var appearances = new Dictionary<Guid, int>();
        var wins = new Dictionary<Guid, int>();
        var bibAppearances = new Dictionary<Guid, int>();
        var results = new Dictionary<Guid, List<PlayerResult>>();

        foreach (var matchInfo in matchInfos)
        {
            if (!teamsByMatch.TryGetValue(matchInfo.Id, out var teams) || teams.Count == 0)
            {
                continue;
            }

            // Map each team's recorded final score by team identity; a team with no recorded score
            // (not expected for a completed match) scores zero.
            var scoreByTeamId = new Dictionary<Guid, int>();
            if (matchInfo.RecordedResult is not null)
            {
                foreach (TeamScore teamScore in matchInfo.RecordedResult.TeamScores)
                {
                    scoreByTeamId[teamScore.TeamId] = teamScore.Score;
                }
            }

            int ScoreOf(Guid teamId) => scoreByTeamId.TryGetValue(teamId, out int score) ? score : 0;

            int bestScore = teams.Max(team => ScoreOf(team.Id));
            int teamsAtBest = teams.Count(team => ScoreOf(team.Id) == bestScore);

            foreach (var team in teams)
            {
                // Win = uniquely best placement, Draw = best placement shared, Loss = worse than best
                // (Requirement 6.1, 6.5).
                PlayerResult result = ScoreOf(team.Id) == bestScore
                    ? (teamsAtBest == 1 ? PlayerResult.Win : PlayerResult.Draw)
                    : PlayerResult.Loss;

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
                        if (!results.TryGetValue(membershipId, out var sequence))
                        {
                            sequence = [];
                            results[membershipId] = sequence;
                        }

                        sequence.Add(result);
                    }
                }
            }
        }

        // Resolve the display name and lifecycle state of every membership with at least one appearance;
        // an anonymised membership already carries the "Former player" placeholder (Requirement 4.6, 14.5).
        var eligibleIds = appearances.Keys.ToList();
        if (eligibleIds.Count == 0)
        {
            return [];
        }

        var members = await db.Set<SquadMembership>()
            .Where(member => member.SquadId == squadId && eligibleIds.Contains(member.Id))
            .Select(member => new { member.Id, member.DisplayName, member.State })
            .ToListAsync(ct);

        return members
            .Select(member => new LeaderboardRow(
                member.Id,
                member.DisplayName,
                member.State,
                needsResults ? null : ValueFor(statistic, member.Id),
                needsResults ? results.GetValueOrDefault(member.Id, []) : null))
            .ToList();

        double? ValueFor(LeaderboardStatistic stat, Guid membershipId) => stat switch
        {
            LeaderboardStatistic.Appearances => appearances.GetValueOrDefault(membershipId),
            LeaderboardStatistic.BibAppearances => bibAppearances.GetValueOrDefault(membershipId),
            LeaderboardStatistic.WinPercentage => WinPercentage.Compute(
                wins.GetValueOrDefault(membershipId), appearances.GetValueOrDefault(membershipId)),
            _ => appearances.GetValueOrDefault(membershipId)
        };
    }

    /// <summary>
    /// Builds the eligible <c>Display_Rating</c> ranking rows. The store aggregates each squad
    /// membership's current μ/σ from its 1:1 <see cref="MembershipRating"/> (scoped to the squad in
    /// Postgres), then the pure Domain pipeline turns it into the ranking value:
    /// <see cref="IRatingEngine.GetState"/> classifies the rating and
    /// <see cref="DisplayRatingCalculator.Compute"/> maps it with the squad's
    /// <see cref="DisplayRatingParameters"/>. A membership whose rating is still
    /// <see cref="RatingState.Provisional"/> has no display number, so it is excluded — the leaderboard
    /// only ranks memberships with a value present (Requirement 4.5, 7.2, 7.4).
    /// </summary>
    private async Task<IReadOnlyList<LeaderboardRow>> GetDisplayRatingRowsAsync(
        Guid squadId, CancellationToken ct)
    {
        DisplayRatingParameters parameters = await displayRatingParameters.GetAsync(squadId, ct);

        // Each squad membership joined to its current rating; a membership with no rating yet (never
        // participated) has no row and is naturally excluded. Scoping/join are pushed into Postgres.
        var ratingRows = await (
            from member in db.Set<SquadMembership>()
            where member.SquadId == squadId
            join rating in db.Set<MembershipRating>() on member.Id equals rating.SquadMembershipId
            select new { member.Id, member.DisplayName, member.State, rating.Mu, rating.Sigma })
            .ToListAsync(ct);

        var rows = new List<LeaderboardRow>(ratingRows.Count);
        foreach (var row in ratingRows)
        {
            var state = ratingEngine.GetState(new Rating(row.Mu, row.Sigma));
            if (!state.IsSuccess)
            {
                continue;
            }

            int? displayRating = DisplayRatingCalculator.Compute(
                state.Value, row.Mu, row.Sigma, parameters);
            if (displayRating is null)
            {
                // Provisional rating: no display number, so no leaderboard value (Requirement 7.4).
                continue;
            }

            rows.Add(new LeaderboardRow(row.Id, row.DisplayName, row.State, displayRating.Value, null));
        }

        return rows;
    }

    /// <inheritdoc />
    public async Task<MembershipRef?> FindMembershipAsync(Guid squadId, Guid membershipId, CancellationToken ct) =>
        await db.Set<SquadMembership>()
            .Where(member => member.Id == membershipId && member.SquadId == squadId)
            .Select(member => new MembershipRef(
                member.Id, member.DisplayName, member.State, member.UserId == null))
            .FirstOrDefaultAsync(ct);
}
