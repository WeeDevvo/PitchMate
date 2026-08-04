using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Stats;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Stats;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Performance integration test for the stats read surface (task 9.2), validating
/// <c>Requirement 2.7</c>: for a squad with up to 500 completed matches, a Profile and a Leaderboard
/// each return within 2000 milliseconds.
/// <para>
/// It seeds a single squad of ten registered, active members whose ten-player kickoff lineups mean
/// every member appears in all 500 completed matches — a deliberately heavy per-membership workload
/// (500 appearances, nine recurring co-appearance partners, 500 rating snapshots) that stresses the
/// on-read SQL aggregation harder than a realistic squad would. It then drives the real
/// <see cref="GetPlayerProfileHandler"/> and <see cref="GetLeaderboardHandler"/> end-to-end over a
/// real PostgreSQL instance (the shared Testcontainers fixture, reusing the
/// <see cref="StatsDatasetSeeder"/> from task 6.1), timing each call and asserting it completes within
/// the budget. Requires Docker.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class StatsPerformanceIntegrationTests
{
    /// <summary>The completed-match count Requirement 2.7 bounds the performance guarantee at.</summary>
    private const int CompletedMatchCount = 500;

    /// <summary>The per-view latency budget from Requirement 2.7.</summary>
    private const long PerformanceBudgetMilliseconds = 2000;

    /// <summary>The size of the shared membership pool; equal to the total roster so every member plays every match.</summary>
    private const int MemberCount = 10;

    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public StatsPerformanceIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Feature: stats-and-summaries, Requirement 2.7: Profile and Leaderboard within 2000 ms at 500 completed matches
    [Fact]
    public async Task ProfileAndLeaderboard_ForSquadWith500CompletedMatches_EachReturnWithinBudget()
    {
        StatsDatasetSpec spec = BuildSpecWith500CompletedMatches();

        var databaseName = "stats_perf_" + Guid.NewGuid().ToString("N");
        await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, databaseName);

        try
        {
            string connectionString =
                MigrationTestSupport.ConnectionStringForDatabase(_fixture.ConnectionString, databaseName);

            await using (var schema = CreateContext(connectionString))
            {
                await schema.Database.MigrateAsync();
            }

            SeededStatsDataset seeded;
            await using (var write = CreateContext(connectionString))
            {
                seeded = await new StatsDatasetSeeder()
                    .SeedAsync(write, spec, new FakeTimeProvider(), CancellationToken.None);
            }

            await using var read = CreateContext(connectionString);

            var ratingEngine = new PlackettLuceRatingEngine(new RatingEngineConfig());
            var statsRepository = new EfStatsRepository(read, ratingEngine, new SquadDisplayRatingParametersSource());
            var membershipRepository = new EfSquadMembershipRepository(read);
            var squadRepository = new EfSquadRepository(read);

            var profileHandler = new GetPlayerProfileHandler(
                membershipRepository,
                squadRepository,
                statsRepository,
                new SquadDisplayRatingParametersSource(),
                new EmptyRichStatsSource(),
                ratingEngine);
            var leaderboardHandler = new GetLeaderboardHandler(membershipRepository, statsRepository);

            SeededStatsDataset.SquadData squad = seeded.SquadAt(0);

            // Resolve a registered, active member from the database to act as both the authenticated
            // requester and the profile subject. A registered member is created active with a backing
            // user, so it is authorised (Requirement 1.1) and — because the pool equals the roster —
            // appears in all 500 completed matches (the worst-case profile workload).
            var requester = await read.Set<SquadMembership>()
                .Where(member => member.SquadId == squad.SquadId && member.UserId != null)
                .Select(member => new { member.Id, member.UserId })
                .FirstAsync();

            Guid requestingUserId = requester.UserId!.Value;
            Guid subjectMembershipId = requester.Id;

            // --- Profile: time the full on-read aggregation and shaping (Requirement 2.7). ---
            var profileCommand = new GetPlayerProfileCommand(requestingUserId, squad.SquadId, subjectMembershipId);
            var profileStopwatch = Stopwatch.StartNew();
            var profileResult = await profileHandler.HandleAsync(profileCommand, CancellationToken.None);
            profileStopwatch.Stop();

            Assert.True(
                profileResult.IsSuccess,
                $"The profile read failed: {profileResult.Error?.Code} {profileResult.Error?.Message}");
            Assert.Equal(CompletedMatchCount, profileResult.Value!.Record.Appearances);
            Assert.True(
                profileStopwatch.ElapsedMilliseconds <= PerformanceBudgetMilliseconds,
                $"Profile took {profileStopwatch.ElapsedMilliseconds} ms for {CompletedMatchCount} completed matches, " +
                $"exceeding the {PerformanceBudgetMilliseconds} ms budget (Requirement 2.7).");

            // --- Leaderboard: time the full on-read aggregation and ranking (Requirement 2.7). ---
            var leaderboardCommand = new GetLeaderboardCommand(
                requestingUserId, squad.SquadId, LeaderboardStatistic.WinPercentage);
            var leaderboardStopwatch = Stopwatch.StartNew();
            var leaderboardResult =
                await leaderboardHandler.HandleAsync(leaderboardCommand, CancellationToken.None);
            leaderboardStopwatch.Stop();

            Assert.True(
                leaderboardResult.IsSuccess,
                $"The leaderboard read failed: {leaderboardResult.Error?.Code} {leaderboardResult.Error?.Message}");
            Assert.Equal(MemberCount, leaderboardResult.Value!.Entries.Count);
            Assert.True(
                leaderboardStopwatch.ElapsedMilliseconds <= PerformanceBudgetMilliseconds,
                $"Leaderboard took {leaderboardStopwatch.ElapsedMilliseconds} ms for {CompletedMatchCount} completed matches, " +
                $"exceeding the {PerformanceBudgetMilliseconds} ms budget (Requirement 2.7).");
        }
        finally
        {
            await MigrationTestSupport.DropDatabaseAsync(_fixture.ConnectionString, databaseName);
        }
    }

    /// <summary>
    /// Builds a single squad of <see cref="MemberCount"/> registered, active members (each carrying a
    /// low-σ rating) and <see cref="CompletedMatchCount"/> completed 5v5 matches. Because the roster
    /// size (10) equals the pool size, every member appears in every match, so the subject accrues the
    /// maximum appearances/co-appearances/snapshots the aggregation must reduce. Distinct completion
    /// offsets give the matches a deterministic chronological order.
    /// </summary>
    private static StatsDatasetSpec BuildSpecWith500CompletedMatches()
    {
        var members = new List<StatsDatasetSpec.MembershipSpec>(MemberCount);
        for (int i = 0; i < MemberCount; i++)
        {
            members.Add(new StatsDatasetSpec.MembershipSpec(
                IsGuest: false,
                Inactive: false,
                Anonymise: false,
                Rating: new StatsDatasetSpec.RatingSpec(Mu: 25.0, Sigma: 1.0)));
        }

        var matches = new List<StatsDatasetSpec.MatchSpec>(CompletedMatchCount);
        for (int m = 0; m < CompletedMatchCount; m++)
        {
            matches.Add(new StatsDatasetSpec.MatchSpec(
                State: MatchState.Completed,
                Fidelity: ResultFidelity.Basic,
                TeamSizes: [5, 5],
                ShuffleSeed: m,
                Scores: [3, 1],
                BibTeamIndex: m % 2,
                CompletedOffsetSeconds: m));
        }

        return new StatsDatasetSpec([new StatsDatasetSpec.SquadSpec(LiveMatchTracking: false, members, matches)]);
    }

    /// <summary>Creates a production <see cref="PitchMateDbContext"/> bound to the throwaway database.</summary>
    private static PitchMateDbContext CreateContext(string connectionString) =>
        new(
            MigrationTestSupport.BuildContextOptions(connectionString),
            new FakeTimeProvider(),
            new FakeCurrentUserAccessor());
}
