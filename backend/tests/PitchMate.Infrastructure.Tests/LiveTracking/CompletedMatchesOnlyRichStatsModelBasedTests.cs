using FsCheck;
using FsCheck.Xunit;
using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Stats;
using PitchMate.Domain.LiveTracking;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.LiveTracking;
using PitchMate.Infrastructure.Matches.Repositories;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Tests.Persistence;
using PitchMate.Infrastructure.Tests.Stats;

namespace PitchMate.Infrastructure.Tests.LiveTracking;

/// <summary>
/// Model-based property test for completed-matches-only rich statistics (task 13.4), validating design
/// <c>Property 17: Rich statistics are computed from completed matches only</c> against the real
/// <see cref="EventLogRichStatsSource"/> on a Testcontainers PostgreSQL instance with the production
/// EF Core migrations applied — never the EF in-memory provider or SQLite — using the pure Domain
/// <see cref="MatchEventLog"/> projection as the source-of-truth oracle.
/// <para>
/// Each iteration seeds a generated single-squad dataset (via the shared
/// <see cref="StatsDatasetSeeder"/>) whose matches span <em>every</em> <see cref="MatchState"/>, then
/// plants an append-only <see cref="MatchEvent"/> log on <b>every</b> match — completed and
/// non-completed alike — plus one extra <see cref="MatchState.Cancelled"/> match carrying a deliberate
/// "poison" log crediting a chosen membership with goals, a keeper stint, and conceded goals. It then
/// asserts three things:
/// </para>
/// <list type="number">
/// <item>For every membership, <see cref="EventLogRichStatsSource.GetForMembershipAsync"/> equals the
/// oracle summed over the squad's <see cref="MatchState.Completed"/> matches alone — so events on
/// non-completed and <c>Cancelled</c> matches contribute nothing (Requirement 10.7, 12.4).</item>
/// <item><see cref="EventLogRichStatsSource.GetTopScorerAsync"/> equals the oracle's top scorer pooled
/// over the completed matches' events alone (Requirement 10.6, 10.7).</item>
/// <item>The poison membership's statistics equal the completed-only oracle and are strictly lower
/// than an all-states oracle that <em>would</em> have counted the poison <c>Cancelled</c> match — a
/// sharp proof that the <c>Cancelled</c> match's recorded log was excluded (Requirement 10.7).</item>
/// </list>
/// <para>
/// Each iteration migrates, seeds, and drops its own throwaway database, so <see cref="MaxTest"/> is
/// kept modest; because every generated dataset carries a pool of fifteen to twenty memberships and up
/// to six matches across all states, a single iteration already performs dozens of independent
/// per-membership completed-only comparisons, so the run clears well over 100 logical checks in total.
/// Requires Docker.
/// </para>
/// <para>Validates: Requirements 10.7, 12.4.</para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class CompletedMatchesOnlyRichStatsModelBasedTests
{
    // Modest generated-dataset count: each seeds/drops a real database, yet every dataset yields many
    // per-membership completed-only comparisons, so total logical checks exceed 100.
    private const int MaxTest = 6;

    private const string Actor = "live-tracking-13-4";

    private readonly PostgreSqlContainerFixture _fixture;
    private readonly StatsDatasetSeeder _seeder = new();

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public CompletedMatchesOnlyRichStatsModelBasedTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Feature: live-tracking, Property 17: Rich statistics are computed from completed matches only —
    // for any squad whose matches span every state and carry an append-only event log, every rich
    // statistic the EventLogRichStatsSource reports equals the value obtained by projecting only the
    // squad's Completed matches' events; events belonging to Cancelled and non-Completed matches
    // contribute nothing.
    /// <summary>
    /// **Validates: Requirements 10.7, 12.4**
    /// </summary>
    [Property(MaxTest = MaxTest, Arbitrary = new[] { typeof(CompletedMatchesOnlyDatasetArbitraries) })]
    public Property RichStatisticsAreComputedFromCompletedMatchesOnly(StatsDatasetSpec spec) =>
        RunAsync(async () =>
        {
            await WithSeededDatabaseAsync(spec, AssertCompletedMatchesOnlyAsync);
            return true;
        });

    /// <summary>
    /// Asserts the completed-matches-only property for every membership and the top scorer, then the
    /// sharp poison-match exclusion check.
    /// </summary>
    private static async Task AssertCompletedMatchesOnlyAsync(IRichStatsSource source, SeededEventDataset dataset)
    {
        // (1) Every membership's rich statistics equal the completed-only oracle (Requirement 10.7).
        foreach (Guid membershipId in dataset.MembershipIds)
        {
            RichStats? actual =
                await source.GetForMembershipAsync(dataset.SquadId, membershipId, CancellationToken.None);
            RichStats expected = Aggregate(membershipId, dataset.CompletedMatches);

            // Tracking is enabled, so an enabled-but-empty membership reports zero, never null (Req 9.3).
            Assert.NotNull(actual);
            Assert.Equal(expected, actual);
        }

        // (2) The top scorer equals the oracle pooled over the completed matches' events alone
        //     (Requirement 10.6, 10.7).
        Guid? actualTopScorer = await source.GetTopScorerAsync(dataset.SquadId, CancellationToken.None);
        Guid? expectedTopScorer = MatchEventLog.TopScorer(
            dataset.CompletedMatches.SelectMany(match => match.Events));
        Assert.Equal(expectedTopScorer, actualTopScorer);

        // (3) Sharp exclusion proof: the poison membership scored goals, kept a stint, and conceded on
        //     a Cancelled match. Its reported statistics must equal the completed-only oracle and be
        //     strictly lower than an all-states oracle that would have counted the Cancelled match, so
        //     the Cancelled match's log demonstrably contributed nothing (Requirement 10.7, 12.4).
        RichStats poisonActual =
            (await source.GetForMembershipAsync(dataset.SquadId, dataset.PoisonMembershipId, CancellationToken.None))!;
        RichStats poisonCompletedOnly = Aggregate(dataset.PoisonMembershipId, dataset.CompletedMatches);
        RichStats poisonAllStates = Aggregate(dataset.PoisonMembershipId, dataset.AllMatches);

        Assert.Equal(poisonCompletedOnly, poisonActual);
        Assert.True(
            poisonAllStates.Goals > poisonActual.Goals,
            "The poison Cancelled match should have added goals that must be excluded from the reported statistics.");
    }

    /// <summary>
    /// Sums the pure per-match <see cref="MatchEventLog"/> projection across the given matches for one
    /// membership, mirroring exactly how <see cref="EventLogRichStatsSource"/> aggregates its
    /// per-match figures — so any divergence is a difference in the <em>scope</em> of matches read, not
    /// in the derivation itself.
    /// </summary>
    private static RichStats Aggregate(Guid membershipId, IEnumerable<SeededMatchEvents> matches)
    {
        int goals = 0;
        int cleanSheets = 0;
        int goalsConcededAsKeeper = 0;
        int keeperMinutes = 0;

        foreach (SeededMatchEvents match in matches)
        {
            MatchRichStatistics stats = MatchEventLog.ForMembership(membershipId, match.Events);

            goals += stats.Goals;
            goalsConcededAsKeeper += stats.ConcededAsKeeper;
            keeperMinutes += stats.KeeperMinutes;

            if (stats.KeptAnyStint && stats.ConcededAsKeeper == 0)
            {
                cleanSheets++;
            }
        }

        return new RichStats(
            Goals: goals,
            CleanSheets: cleanSheets,
            GoalsConcededAsKeeper: goalsConcededAsKeeper,
            KeeperTime: TimeSpan.FromMinutes(keeperMinutes));
    }

    /// <summary>
    /// Creates a fresh migrated database, seeds <paramref name="spec"/>, plants an event log on every
    /// seeded match plus an extra poison <c>Cancelled</c> match, and invokes <paramref name="body"/>
    /// with a real <see cref="EventLogRichStatsSource"/> reading it and the resolved dataset — dropping
    /// the database afterwards regardless of outcome.
    /// </summary>
    private async Task WithSeededDatabaseAsync(
        StatsDatasetSpec spec,
        Func<IRichStatsSource, SeededEventDataset, Task> body)
    {
        var databaseName = "livetracking_richstats_" + Guid.NewGuid().ToString("N");
        await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, databaseName);

        try
        {
            var connectionString =
                MigrationTestSupport.ConnectionStringForDatabase(_fixture.ConnectionString, databaseName);

            await using (var schema = CreateContext(connectionString))
            {
                await schema.Database.MigrateAsync();
            }

            SeededStatsDataset seededDataset;
            await using (var write = CreateContext(connectionString))
            {
                seededDataset = await _seeder.SeedAsync(write, spec, new FakeTimeProvider(), CancellationToken.None);
            }

            SeededStatsDataset.SquadData squad = seededDataset.Squads[0];
            var membershipIds = squad.Memberships.Select(member => member.MembershipId).ToList();
            Guid poisonMembershipId = membershipIds[0];

            // An extra Cancelled match, built through the real aggregate lifecycle, to plant a poison
            // log on (proving a Cancelled match contributes nothing even when it carries events).
            Guid poisonMatchId = await AddCancelledMatchAsync(connectionString, squad.SquadId);

            // Deterministic event generation over the seeded matches and the poison match.
            var random = new System.Random(20240517);
            var seededMatches = new List<SeededMatchEvents>();
            var allEvents = new List<MatchEvent>();

            foreach (SeededStatsDataset.MatchData match in squad.Matches)
            {
                IReadOnlyList<(Guid, IReadOnlyList<Guid>)> teams = ResolveTeams(match, membershipIds, random);
                IReadOnlyList<MatchEvent> events =
                    LiveTrackingRichStatsEventFactory.ForMatch(squad.SquadId, match.MatchId, teams, random);

                seededMatches.Add(new SeededMatchEvents(match.State, events));
                allEvents.AddRange(events);
            }

            IReadOnlyList<MatchEvent> poisonEvents =
                BuildPoisonEvents(squad.SquadId, poisonMatchId, poisonMembershipId);
            seededMatches.Add(new SeededMatchEvents(MatchState.Cancelled, poisonEvents));
            allEvents.AddRange(poisonEvents);

            // Append the whole log atomically through the append-only repository.
            await using (var write = CreateContext(connectionString))
            {
                await new EfMatchEventRepository(write).AppendAsync(allEvents, CancellationToken.None);
                await new UnitOfWork(write).SaveChangesAsync(CancellationToken.None);
            }

            await using (var read = CreateContext(connectionString))
            {
                var source = new EventLogRichStatsSource(
                    new EfSquadRepository(read), new EfMatchEventRepository(read));

                var dataset = new SeededEventDataset(
                    squad.SquadId, membershipIds, seededMatches, poisonMembershipId);

                await body(source, dataset);
            }
        }
        finally
        {
            await MigrationTestSupport.DropDatabaseAsync(_fixture.ConnectionString, databaseName);
        }
    }

    /// <summary>
    /// Resolves the teams (working <c>MatchTeam.Id</c> plus roster) an event log is built over. A
    /// rolled/played match uses its real captured teams; a teamless match (draft/confirmed/cancelled)
    /// synthesises two teams from the membership pool so it still carries a log to be excluded.
    /// </summary>
    private static IReadOnlyList<(Guid, IReadOnlyList<Guid>)> ResolveTeams(
        SeededStatsDataset.MatchData match,
        IReadOnlyList<Guid> membershipIds,
        System.Random random)
    {
        if (match.Teams.Count > 0)
        {
            return match.Teams
                .Select(team => (team.TeamId, (IReadOnlyList<Guid>)team.Roster))
                .ToList();
        }

        var shuffled = membershipIds.OrderBy(_ => random.Next()).ToList();
        int half = Math.Max(1, shuffled.Count / 2);
        IReadOnlyList<Guid> teamA = shuffled.Take(half).ToList();
        IReadOnlyList<Guid> teamB = shuffled.Skip(half).Take(half).ToList();

        return [(Guid.CreateVersion7(), teamA), (Guid.CreateVersion7(), teamB)];
    }

    /// <summary>
    /// Builds the poison log for a <c>Cancelled</c> match: the poison membership scores three goals for
    /// team A and keeps goal for team B across a stint that spans team A's goals, conceding all three.
    /// Were the Cancelled match counted, the membership would show three goals, three conceded, keeper
    /// minutes, and no clean sheet — so its exclusion is sharply observable.
    /// </summary>
    private static IReadOnlyList<MatchEvent> BuildPoisonEvents(Guid squadId, Guid matchId, Guid poisonMembershipId)
    {
        var teamA = Guid.CreateVersion7();
        var teamB = Guid.CreateVersion7();

        var events = new List<MatchEvent>
        {
            // The poison membership keeps team B from minute 0.
            new KeeperStintStartedEvent(
                Guid.CreateVersion7(), matchId, squadId, Minute(0), poisonMembershipId, teamB),
        };

        // Three goals for team A, credited to the poison membership, all within its team-B stint.
        foreach (int minute in new[] { 10, 20, 30 })
        {
            events.Add(new GoalScoredEvent(
                Guid.CreateVersion7(), matchId, squadId, Minute(minute), teamA, poisonMembershipId, ownGoal: false));
        }

        return events;
    }

    /// <summary>
    /// Builds and persists a <see cref="MatchState.Cancelled"/> match for <paramref name="squadId"/>
    /// through the real aggregate lifecycle (draft → confirm → cancel), returning its identity.
    /// </summary>
    private async Task<Guid> AddCancelledMatchAsync(string connectionString, Guid squadId)
    {
        var clock = new FakeTimeProvider();
        DateTimeOffset now = clock.GetUtcNow();
        DateTimeOffset day = now.AddDays(7);
        var matchId = Guid.CreateVersion7();

        Match match = CreateOrThrow(
            Match.CreateDraft(matchId, squadId, "Poison Cancelled", new[] { day }, now), "create draft");
        CheckOrThrow(
            match.Confirm(day, availableCount: 0, minimumThreshold: 0, Array.Empty<RegisteredMember>()), "confirm");
        CheckOrThrow(match.Cancel(), "cancel");

        await using var context = CreateContext(connectionString);
        await new EfMatchRepository(context).AddAsync(match, CancellationToken.None);
        await new UnitOfWork(context).SaveChangesAsync(CancellationToken.None);
        return matchId;
    }

    /// <summary>Builds a valid <see cref="MatchMinute"/> from a clamped whole minute in [0, 200].</summary>
    private static MatchMinute Minute(int value) => MatchMinute.Create(Math.Clamp(value, 0, 200)).Value;

    private static void CheckOrThrow(PitchMate.Domain.Matches.Result result, string step)
    {
        if (!result.IsSuccess)
        {
            throw new InvalidOperationException($"Poison-match step '{step}' failed: {result.Error?.Message}");
        }
    }

    private static Match CreateOrThrow(PitchMate.Domain.Matches.Result<Match> result, string step) =>
        result.IsSuccess && result.Value is not null
            ? result.Value
            : throw new InvalidOperationException($"Poison-match step '{step}' failed: {result.Error?.Message}");

    /// <summary>Creates a production <see cref="PitchMateDbContext"/> bound to the throwaway database.</summary>
    private static PitchMateDbContext CreateContext(string connectionString) =>
        new(
            MigrationTestSupport.BuildContextOptions(connectionString),
            new FakeTimeProvider(),
            new FakeCurrentUserAccessor(Actor));

    /// <summary>
    /// Bridges FsCheck's synchronous property model to the harness's asynchronous per-iteration
    /// database work. Blocking is safe: xUnit test execution has no synchronization context, so
    /// <c>GetAwaiter().GetResult()</c> cannot deadlock and it surfaces the original exception unwrapped.
    /// </summary>
    private static Property RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult().ToProperty();

    /// <summary>The resolved per-iteration dataset the assertions read.</summary>
    /// <param name="SquadId">The tracking-enabled squad under test.</param>
    /// <param name="MembershipIds">Every membership in the squad's pool.</param>
    /// <param name="AllMatches">Every match's state and planted event log, across all states.</param>
    /// <param name="PoisonMembershipId">The membership credited on the poison <c>Cancelled</c> match.</param>
    private sealed record SeededEventDataset(
        Guid SquadId,
        IReadOnlyList<Guid> MembershipIds,
        IReadOnlyList<SeededMatchEvents> AllMatches,
        Guid PoisonMembershipId)
    {
        /// <summary>The subset of matches in <see cref="MatchState.Completed"/> — the only contributors.</summary>
        public IEnumerable<SeededMatchEvents> CompletedMatches =>
            AllMatches.Where(match => match.State == MatchState.Completed);
    }

    /// <summary>One match's lifecycle state and the append-only event log planted on it.</summary>
    /// <param name="State">The match's lifecycle state.</param>
    /// <param name="Events">The events recorded against the match.</param>
    private sealed record SeededMatchEvents(MatchState State, IReadOnlyList<MatchEvent> Events);
}
