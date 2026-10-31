using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Domain.Stats;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Stats;

/// <summary>
/// EF Core implementation of <see cref="ISquadCardSource"/>, beside the rest of the squad-scoped stats
/// aggregation (<see cref="EfStatsRepository"/>): the active player count, the next open match, and the
/// viewer's last five results, each a squad-scoped query.
/// <para>
/// A result is derived exactly as the player profile derives it — the uniquely best final score is a
/// win, a shared best a draw, anything else a loss — from the working-team rosters, which equal the
/// kickoff lineup once a match is completed.
/// </para>
/// </summary>
internal sealed class EfSquadCardSource(PitchMateDbContext db) : ISquadCardSource
{
    /// <summary>How many recent results a squad card shows.</summary>
    internal const int FormLength = 5;

    private static readonly MatchState[] OpenStates =
    [
        MatchState.GatheringAvailability,
        MatchState.Confirmed,
        MatchState.TeamsRolled,
        MatchState.InProgress,
    ];

    public async Task<SquadCardFacts> ReadAsync(Guid squadId, Guid? membershipId, CancellationToken cancellationToken)
    {
        int playerCount = await db.Set<SquadMembership>()
            .CountAsync(
                membership => membership.SquadId == squadId && membership.State == MembershipState.Active,
                cancellationToken);

        UpcomingMatchFacts? nextMatch = await ReadNextMatchAsync(squadId, cancellationToken);

        IReadOnlyList<PlayerResult> form = membershipId is { } id
            ? await ReadRecentFormAsync(squadId, id, cancellationToken)
            : [];

        return new SquadCardFacts(playerCount, nextMatch, form);
    }

    private async Task<UpcomingMatchFacts?> ReadNextMatchAsync(Guid squadId, CancellationToken cancellationToken)
    {
        // A squad has few open matches at once, and the candidate days are a jsonb array, so the open
        // matches are read whole and the soonest chosen here.
        List<Match> open = await db.Set<Match>()
            .AsNoTracking()
            .Where(match => match.SquadId == squadId && OpenStates.Contains(match.State))
            .ToListAsync(cancellationToken);

        Match? next = open
            .OrderBy(match => match.State == MatchState.InProgress ? 0 : 1)
            .ThenBy(match => match.ConfirmedDay?.Instant
                ?? (match.CandidateDays.Count > 0 ? match.CandidateDays.Min(day => day.Instant) : DateTimeOffset.MaxValue))
            .ThenBy(match => match.Id)
            .FirstOrDefault();

        return next is null
            ? null
            : new UpcomingMatchFacts(
                next.Id,
                next.State,
                next.ConfirmedDay?.Instant,
                next.Location,
                next.CandidateDays.Count);
    }

    private async Task<IReadOnlyList<PlayerResult>> ReadRecentFormAsync(
        Guid squadId,
        Guid membershipId,
        CancellationToken cancellationToken)
    {
        IQueryable<Match> completed = db.Set<Match>()
            .Where(match => match.SquadId == squadId && match.State == MatchState.Completed);

        // The viewer's most recent completed matches, newest first by the stable replay order
        // (completion instant, then id).
        var recent = await db.Set<MatchTeam>()
            .Where(team => team.Roster.Contains(membershipId))
            .Join(completed, team => team.MatchId, match => match.Id, (team, match) => match)
            .Distinct()
            .OrderByDescending(match => match.CompletedAt)
            .ThenByDescending(match => match.Id)
            .Take(FormLength)
            .Select(match => new { match.Id, match.RecordedResult })
            .ToListAsync(cancellationToken);

        if (recent.Count == 0)
        {
            return [];
        }

        List<Guid> matchIds = recent.Select(match => match.Id).ToList();
        var teamsByMatch = (await db.Set<MatchTeam>()
                .Where(team => matchIds.Contains(team.MatchId))
                .Select(team => new { team.MatchId, team.Id, team.Roster })
                .ToListAsync(cancellationToken))
            .GroupBy(team => team.MatchId)
            .ToDictionary(group => group.Key, group => group.ToList());

        var form = new List<PlayerResult>(recent.Count);

        // Oldest first, so the card reads left to right towards the latest result.
        foreach (var match in Enumerable.Reverse(recent))
        {
            if (!teamsByMatch.TryGetValue(match.Id, out var teams)
                || teams.FirstOrDefault(team => team.Roster.Contains(membershipId)) is not { } viewerTeam)
            {
                continue;
            }

            var scoreByTeamId = new Dictionary<Guid, int>();
            if (match.RecordedResult is not null)
            {
                foreach (TeamScore teamScore in match.RecordedResult.TeamScores)
                {
                    scoreByTeamId[teamScore.TeamId] = teamScore.Score;
                }
            }

            int ScoreOf(Guid teamId) => scoreByTeamId.TryGetValue(teamId, out int score) ? score : 0;

            int viewerScore = ScoreOf(viewerTeam.Id);
            int bestScore = teams.Max(team => ScoreOf(team.Id));
            int teamsAtBest = teams.Count(team => ScoreOf(team.Id) == bestScore);

            form.Add(viewerScore == bestScore
                ? (teamsAtBest == 1 ? PlayerResult.Win : PlayerResult.Draw)
                : PlayerResult.Loss);
        }

        return form;
    }
}
