using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Matches.Queries;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Captured-SQL and command-count assertions over <see cref="EfMatchListSource"/>
/// (match-read-models task 5.4), run against <b>real PostgreSQL</b> with the production EF
/// migrations applied. Docker is required.
/// <para>
/// Where the task 5.3 integration tests assert what the read <em>answers</em>, these assert what it
/// <em>costs and where the work happens</em> — the two claims the answer alone cannot evidence:
/// </para>
/// <list type="bullet">
/// <item>
/// <b>Requirement 1.12</b> — the ordering, the bound and the participant count are evaluated inside
/// the database, and no denormalised summary table is read. A read that pulled a squad's whole match
/// history and sorted, truncated and counted in memory would return an <em>identical</em> page, so
/// only the statement text can tell the two apart.
/// </item>
/// <item>
/// <b>Requirement 1.13</b> — the round-trip count is fixed. One squad holding a single match and one
/// squad at the 200-entry bound must cost the same single command, so the read's cost is independent
/// of how many matches a squad has accumulated.
/// </item>
/// </list>
/// <para>
/// Both read through <see cref="MatchListSourceHarness.ListForSquadCapturingCommandsAsync"/>, which
/// runs the production source over a context carrying a <see cref="CommandCountingInterceptor"/> —
/// the same interceptor Property 25 reuses across all three match reads.
/// </para>
/// <para>
/// <b>Validates: Requirements 1.12, 1.13.</b>
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class MatchListSourceCommandBudgetIntegrationTests
{
    /// <summary>
    /// The tables the statement is permitted to read. Asserting <em>equality</em> against this set,
    /// rather than merely the absence of some named summary table, is what makes the
    /// "no denormalised summary table" claim durable: a read model introduced later would have to
    /// appear here to pass, which is a deliberate decision rather than a silent drift.
    /// </summary>
    private static readonly string[] PermittedTables = ["squad", "match", "match_participant"];

    /// <summary>
    /// The class's harness, held <see langword="static"/> so xUnit's per-test class instantiation
    /// does not re-run the drop-and-migrate, and bound to this class's <em>own</em> database name so
    /// it cannot collide with <see cref="MatchListSourceIntegrationTests"/>'s.
    /// </summary>
    private static MatchListSourceHarness? _shared;

    private readonly MatchListSourceHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public MatchListSourceCommandBudgetIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _harness = _shared ??= new MatchListSourceHarness(fixture, "match_list_source_commands");
    }

    /// <summary>
    /// **Validates: Requirement 1.12** — the read is one statement, and that statement carries the
    /// <c>ORDER BY</c>, the <c>LIMIT</c> and the <c>count(*)</c>, so the ordering of Requirement 1.9,
    /// the bound of Requirement 1.10 and the participant count of Requirement 1.4 are all evaluated
    /// by the database rather than in memory.
    /// <para>
    /// The dataset is chosen so each clause has something to do: several matches so the
    /// <c>ORDER BY</c> sorts, participants on the confirmed and rolled matches so the
    /// <c>count(*)</c> counts a non-zero number, and a limit below the seeded match count so the
    /// <c>LIMIT</c> genuinely truncates. A page that came back correct with any of the three
    /// evaluated client-side would still fail here.
    /// </para>
    /// </summary>
    [Fact]
    public async Task ListForSquad_IssuesOneStatement_ThatOrdersBoundsAndCountsInsideTheDatabase()
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(
            new MatchListDatasetSpec.SquadSpec(
                MemberCount: 14,
                Matches:
                [
                    Draft([4, 9]),
                    Confirmed([6, 11], participantCount: 3),
                    Rolled([3], participantCount: 10),
                    Completed([7], participantCount: 11, completedOffsetSeconds: 30)
                ]));

        const int limit = 2;
        (MatchListPage? page, CommandCountingInterceptor commands) =
            await _harness.ListForSquadCapturingCommandsAsync(squad.SquadId, limit);

        // The read really did the work the clauses are being asserted about.
        Assert.NotNull(page);
        Assert.Equal(limit, page!.Entries.Count);
        Assert.True(page.Truncated);
        Assert.Contains(page.Entries, entry => entry.ParticipantCount > 0);

        // One statement, whose text is the evidence for everything below.
        Assert.Equal(1, commands.ExecutedCommandCount);
        string sql = commands.SingleCommandText;

        Assert.Contains("ORDER BY", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("LIMIT", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("count(*)", sql, StringComparison.OrdinalIgnoreCase);

        // Caller input is bound, never interpolated: the squad identity reaches the server as a
        // parameter and appears nowhere in the statement's text.
        Assert.DoesNotContain(squad.SquadId.ToString(), sql, StringComparison.OrdinalIgnoreCase);

        // And nothing outside the normalised match tables is read — in particular no denormalised
        // summary or read-model table (decision DA1: stats are computed on read).
        Assert.Equal(
            PermittedTables.Order(StringComparer.Ordinal),
            TablesReadBy(sql).Order(StringComparer.Ordinal));
    }

    /// <summary>
    /// **Validates: Requirement 1.13** — the round-trip count is fixed, whatever the data. A squad
    /// holding one admitted match, a squad holding 201 (so the read answers at the 200-entry bound
    /// and reports truncation), and a visible squad holding none all cost the <em>same</em> single
    /// command.
    /// <para>
    /// The three are compared to each other as well as to one, because the claim is independence
    /// rather than a magic number: a source that issued a second query to count, to detect
    /// truncation, or to distinguish "no matches" from "squad not visible" would still issue exactly
    /// one for some of these cases while issuing two for others.
    /// </para>
    /// </summary>
    [Fact]
    public async Task ListForSquad_ExecutesTheSameOneCommand_WhateverTheSquadsMatchCount()
    {
        SeededMatchListDataset seeded = await _harness.SeedAsync(new MatchListDatasetSpec(
        [
            // One admitted match.
            new MatchListDatasetSpec.SquadSpec(MemberCount: 2, Matches: [Draft([1])]),

            // One match beyond the declared maximum, so the read answers a full page and truncates.
            new MatchListDatasetSpec.SquadSpec(
                MemberCount: 2,
                Matches: [.. Enumerable.Range(1, MatchListLimits.MaximumEntries + 1).Select(offset => Draft([offset]))]),

            // Visible, and holding nothing — the lateral join's placeholder-row case.
            new MatchListDatasetSpec.SquadSpec(MemberCount: 2, Matches: [])
        ]));

        (MatchListPage? single, CommandCountingInterceptor singleCommands) =
            await _harness.ListForSquadCapturingCommandsAsync(seeded.SquadAt(0).SquadId, MatchListLimits.MaximumEntries);
        (MatchListPage? atBound, CommandCountingInterceptor atBoundCommands) =
            await _harness.ListForSquadCapturingCommandsAsync(seeded.SquadAt(1).SquadId, MatchListLimits.MaximumEntries);
        (MatchListPage? empty, CommandCountingInterceptor emptyCommands) =
            await _harness.ListForSquadCapturingCommandsAsync(seeded.SquadAt(2).SquadId, MatchListLimits.MaximumEntries);

        // The three reads really did span the range of data volumes being compared.
        Assert.NotNull(single);
        Assert.NotNull(atBound);
        Assert.NotNull(empty);
        Assert.Single(single!.Entries);
        Assert.Equal(MatchListLimits.MaximumEntries, atBound!.Entries.Count);
        Assert.True(atBound.Truncated);
        Assert.Empty(empty!.Entries);

        Assert.Equal(1, singleCommands.ExecutedCommandCount);
        Assert.Equal(singleCommands.ExecutedCommandCount, atBoundCommands.ExecutedCommandCount);
        Assert.Equal(singleCommands.ExecutedCommandCount, emptyCommands.ExecutedCommandCount);
    }

    /// <summary>
    /// **Validates: Requirement 1.13** — a squad that is not visible costs the same one command. The
    /// concealment decision is the outer <c>WHERE</c> returning zero rows, not a separate existence
    /// probe, so a soft-deleted squad and an absent one are both answered without a second round
    /// trip — and therefore without a timing difference a caller could read the answer from.
    /// </summary>
    [Fact]
    public async Task ListForSquad_ExecutesTheSameOneCommand_ForASquadThatIsNotVisible()
    {
        SeededMatchListDataset.SquadData deleted = await _harness.SeedSquadAsync(
            new MatchListDatasetSpec.SquadSpec(
                MemberCount: 2,
                Matches: [Draft([5])],
                SoftDeleteSquad: true));

        (MatchListPage? deletedPage, CommandCountingInterceptor deletedCommands) =
            await _harness.ListForSquadCapturingCommandsAsync(deleted.SquadId, MatchListLimits.MaximumEntries);
        (MatchListPage? absentPage, CommandCountingInterceptor absentCommands) =
            await _harness.ListForSquadCapturingCommandsAsync(Guid.CreateVersion7(), MatchListLimits.MaximumEntries);

        Assert.Null(deletedPage);
        Assert.Null(absentPage);
        Assert.Equal(1, deletedCommands.ExecutedCommandCount);
        Assert.Equal(1, absentCommands.ExecutedCommandCount);
    }

    // --- Spec helpers -------------------------------------------------------------------------

    private static MatchListDatasetSpec.MatchSpec Draft(int[] candidateDayOffsets) =>
        new(MatchState.GatheringAvailability, candidateDayOffsets);

    private static MatchListDatasetSpec.MatchSpec Confirmed(int[] candidateDayOffsets, int participantCount) =>
        new(MatchState.Confirmed, candidateDayOffsets, ParticipantCount: participantCount);

    private static MatchListDatasetSpec.MatchSpec Rolled(int[] candidateDayOffsets, int participantCount) =>
        new(MatchState.TeamsRolled, candidateDayOffsets, ParticipantCount: participantCount);

    private static MatchListDatasetSpec.MatchSpec Completed(
        int[] candidateDayOffsets,
        int participantCount,
        int completedOffsetSeconds) =>
        new(
            MatchState.Completed,
            candidateDayOffsets,
            ParticipantCount: participantCount,
            CompletedOffsetSeconds: completedOffsetSeconds);

    // --- SQL inspection -----------------------------------------------------------------------

    /// <summary>
    /// The set of tables a statement reads, taken as the quoted identifier following each
    /// <c>FROM</c> or <c>JOIN</c>.
    /// <para>
    /// Quoting is what makes this reliable rather than approximate: the source builds every table
    /// reference as a quoted identifier read off the EF model, while the statement's one non-table
    /// <c>FROM</c> source — the <c>jsonb_array_elements</c> set-returning function — is unquoted, and
    /// <c>LEFT JOIN LATERAL (</c> is followed by a parenthesis rather than an identifier. Both are
    /// therefore skipped without needing to be named here.
    /// </para>
    /// </summary>
    private static IReadOnlyCollection<string> TablesReadBy(string sql)
    {
        string[] tokens = sql.Split(
            [' ', '\t', '\r', '\n', '(', ')', ','],
            StringSplitOptions.RemoveEmptyEntries);

        var tables = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 1; i < tokens.Length; i++)
        {
            bool follows =
                tokens[i - 1].Equals("FROM", StringComparison.OrdinalIgnoreCase)
                || tokens[i - 1].Equals("JOIN", StringComparison.OrdinalIgnoreCase);

            if (follows && tokens[i].Length > 2 && tokens[i][0] == '"' && tokens[i][^1] == '"')
            {
                tables.Add(tokens[i].Trim('"'));
            }
        }

        return tables;
    }
}
