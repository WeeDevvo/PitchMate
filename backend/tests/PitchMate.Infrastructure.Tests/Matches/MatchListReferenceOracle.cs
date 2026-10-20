using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// The <c>Reference_Oracle</c> for the match list read (match-read-models task 7.1): a pure, in-memory
/// model of what <see cref="PitchMate.Infrastructure.Matches.Queries.EfMatchListSource"/> must answer
/// for a seeded squad, computed from the <see cref="Match"/> aggregates that produced the rows.
/// <para>
/// It <b>reuses the Domain rules rather than restating them</b>: the order is
/// <see cref="MatchSchedulingOrder.ForMatchList"/>, and every projected member is read straight off the
/// aggregate. That is what keeps the SQL and the specification provably in step — a change to the
/// ordering rule moves the oracle with it. The list projection carries no display names, so the
/// Domain's display-name rule (<see cref="ParticipantDisplayName"/>) has no part in this oracle; the
/// detail and working-teams oracles of tasks 10.9 and 11.9 are where it applies.
/// </para>
/// <para>
/// The agreement relation is <b>structural equality</b>: every member of every entry, the order of
/// every collection, the entry count and the truncation signal (<see cref="AssertAgrees"/>). The
/// records' own equality cannot serve, because their collection members compare by reference.
/// </para>
/// </summary>
internal static class MatchListReferenceOracle
{
    /// <summary>
    /// The page the read must return for <paramref name="squad"/> under <paramref name="limit"/>: the
    /// first <c>min(n, limit)</c> admitted matches in scheduling order, truncated iff <c>n &gt; limit</c>.
    /// </summary>
    /// <param name="squad">The seeded squad.</param>
    /// <param name="limit">The caller's entry limit.</param>
    public static MatchListPage Expected(SeededMatchListDataset.SquadData squad, int limit = MatchListLimits.MaximumEntries)
    {
        ArgumentNullException.ThrowIfNull(squad);

        IReadOnlyList<Match> ordered = MatchSchedulingOrder.ForMatchList(squad.Admitted);

        return new MatchListPage(
            [.. ordered.Take(limit).Select(EntryOf)],
            Truncated: ordered.Count > limit);
    }

    /// <summary>
    /// The list entry the specification assigns to one match (Requirements 1.4–1.7, 1.12): location
    /// verbatim; the confirmed day if any; candidate days only while gathering availability, in stored
    /// order; a participant count over guests and registered members alike; locked team names and bib
    /// flags in locked-team order whenever a kickoff lineup exists; and the recorded result and
    /// completion instant only for a completed match.
    /// </summary>
    /// <param name="match">The aggregate that produced the row.</param>
    public static MatchListEntry EntryOf(Match match)
    {
        ArgumentNullException.ThrowIfNull(match);

        bool completed = match.State == MatchState.Completed;

        return new MatchListEntry(
            match.Id,
            match.State,
            match.Location,
            match.ConfirmedDay?.Instant,
            match.State == MatchState.GatheringAvailability
                ? [.. match.CandidateDays.Select(day => day.Instant)]
                : [],
            match.Participants.Count,
            match.KickoffLineup is { } lineup
                ? [.. lineup.Teams.Select(team => new LockedTeamSummary(team.TeamName, team.BibFlag))]
                : [],
            completed && match.RecordedResult is { } result
                ? new RecordedResultView(result.Fidelity, [.. result.TeamScores])
                : null,
            completed ? match.CompletedAt : null);
    }

    /// <summary>
    /// Asserts <paramref name="actual"/> agrees with <paramref name="expected"/> structurally: the
    /// truncation signal, the entry count and order, and every member of every entry including the
    /// order of each collection member.
    /// </summary>
    /// <param name="expected">The oracle's page.</param>
    /// <param name="actual">The implementation's page; <see langword="null"/> fails.</param>
    public static void AssertAgrees(MatchListPage expected, MatchListPage? actual)
    {
        ArgumentNullException.ThrowIfNull(expected);
        Assert.NotNull(actual);

        Assert.Equal(expected.Truncated, actual!.Truncated);
        Assert.Equal(
            expected.Entries.Select(entry => entry.MatchId),
            actual.Entries.Select(entry => entry.MatchId));

        for (int i = 0; i < expected.Entries.Count; i++)
        {
            AssertEntryAgrees(expected.Entries[i], actual.Entries[i]);
        }
    }

    /// <summary>Asserts one entry agrees with the oracle's, member by member.</summary>
    /// <param name="expected">The oracle's entry.</param>
    /// <param name="actual">The implementation's entry.</param>
    public static void AssertEntryAgrees(MatchListEntry expected, MatchListEntry actual)
    {
        ArgumentNullException.ThrowIfNull(expected);
        ArgumentNullException.ThrowIfNull(actual);

        Assert.Equal(expected.MatchId, actual.MatchId);
        Assert.Equal(expected.State, actual.State);
        Assert.Equal(expected.Location, actual.Location);
        Assert.Equal(expected.ConfirmedDay, actual.ConfirmedDay);
        Assert.Equal(expected.CandidateDays, actual.CandidateDays);
        Assert.Equal(expected.ParticipantCount, actual.ParticipantCount);
        Assert.Equal(expected.LockedTeams, actual.LockedTeams);
        Assert.Equal(expected.CompletedAt, actual.CompletedAt);

        if (expected.RecordedResult is null)
        {
            Assert.Null(actual.RecordedResult);
        }
        else
        {
            Assert.NotNull(actual.RecordedResult);
            Assert.Equal(expected.RecordedResult.Fidelity, actual.RecordedResult!.Fidelity);
            Assert.Equal(expected.RecordedResult.TeamScores, actual.RecordedResult.TeamScores);
        }
    }
}
