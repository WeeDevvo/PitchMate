using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Stats;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Stats;
using PitchMate.Infrastructure.Tests.Persistence;

// Both PitchMate.Domain.Matches and PitchMate.Domain.Rating expose a Result<T>; the stats handler
// returns the Application.Stats one, so bind an explicit alias to it.
using StatsResult = PitchMate.Application.Stats.Result<PitchMate.Application.Stats.PlayerProfile>;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Cross-cutting integration test for the rich-statistics forward-compatibility seam (task 9.3),
/// exercised end-to-end through the real <see cref="GetPlayerProfileHandler"/>, the real
/// <see cref="EfStatsRepository"/> aggregation, and the MVP <see cref="EmptyRichStatsSource"/> against
/// a Testcontainers PostgreSQL instance. It confirms the two behaviours the gated
/// <c>IRichStatsSource</c> must guarantee while no live-tracking data yet exists (Requirement 13.1,
/// 13.2):
/// <list type="bullet">
/// <item>a squad with <see cref="SquadFeature.LiveMatchTracking"/> <b>enabled</b> reports rich
/// statistics as <em>"no data"</em> — <see cref="PlayerProfile.Rich"/> is present but its every field
/// is <see langword="null"/> — while its always-available statistics are computed normally; and</item>
/// <item>a squad with the feature <b>disabled</b> omits rich statistics <em>entirely</em> —
/// <see cref="PlayerProfile.Rich"/> is itself <see langword="null"/>, with no placeholder.</item>
/// </list>
/// Each case seeds a squad (with a completed match so the profile is genuinely populated) via the
/// shared <see cref="StatsDatasetSeeder"/> into its own throwaway database, adds an active registered
/// requester so the read passes the existence-concealing authorisation gate, and reads a subject
/// membership's profile. Requires Docker.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class RichStatsForwardCompatibilityIntegrationTests
{
    private readonly PostgreSqlContainerFixture _fixture;
    private readonly StatsDatasetSeeder _seeder = new();
    private readonly IRatingEngine _ratingEngine = new PlackettLuceRatingEngine(new RatingEngineConfig());

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public RichStatsForwardCompatibilityIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        ArgumentNullException.ThrowIfNull(fixture);
        _fixture = fixture;
    }

    /// <summary>
    /// **Validates: Requirement 13.1** — an enabled squad surfaces the rich-statistics block but, with
    /// no live-tracking detail captured yet, reports every rich field as "no data" (all <c>null</c>),
    /// while the always-available statistics are computed normally.
    /// </summary>
    [Fact]
    public async Task EnabledSquad_ReportsRichStatisticsAsNoData()
    {
        await WithSeededSquadAsync(liveTracking: true, async (handler, requesterUserId, squadId, subjectId) =>
        {
            StatsResult result = await handler.HandleAsync(
                new GetPlayerProfileCommand(requesterUserId, squadId, subjectId), CancellationToken.None);

            Assert.True(result.IsSuccess, result.Error?.Message);
            PlayerProfile profile = result.Value!;

            // The rich block is present (the feature is enabled) ...
            Assert.NotNull(profile.Rich);

            // ... but reports "no data": every field is null rather than zero (Requirement 13.1, 13.2).
            Assert.Null(profile.Rich!.Goals);
            Assert.Null(profile.Rich.CleanSheets);
            Assert.Null(profile.Rich.GoalsConcededAsKeeper);
            Assert.Null(profile.Rich.KeeperTime);

            // The always-available statistics still compute normally alongside the gated rich block —
            // the subject played the seeded completed match, so it has at least one appearance.
            Assert.True(profile.Record.Appearances >= 1);
        });
    }

    /// <summary>
    /// **Validates: Requirement 13.2** — a squad without the <c>LiveMatchTracking</c> feature omits the
    /// rich-statistics block entirely: <see cref="PlayerProfile.Rich"/> is <see langword="null"/>, with
    /// no placeholder.
    /// </summary>
    [Fact]
    public async Task DisabledSquad_OmitsRichStatisticsEntirely()
    {
        await WithSeededSquadAsync(liveTracking: false, async (handler, requesterUserId, squadId, subjectId) =>
        {
            StatsResult result = await handler.HandleAsync(
                new GetPlayerProfileCommand(requesterUserId, squadId, subjectId), CancellationToken.None);

            Assert.True(result.IsSuccess, result.Error?.Message);
            PlayerProfile profile = result.Value!;

            // The feature is disabled: the rich block is omitted with no placeholder (Requirement 13.2).
            Assert.Null(profile.Rich);

            // The always-available statistics are still returned for the subject.
            Assert.True(profile.Record.Appearances >= 1);
        });
    }

    /// <summary>
    /// Seeds a single squad — with <paramref name="liveTracking"/> configured and one completed 5v5
    /// match so the subject has real always-available statistics — into a fresh migrated throwaway
    /// database, adds an active registered requester so the read passes authorisation, builds the real
    /// <see cref="GetPlayerProfileHandler"/> over the production repositories/sources, and invokes
    /// <paramref name="body"/> with the handler, the requester's user id, the squad id, and a subject
    /// membership id — dropping the database afterwards regardless of outcome.
    /// </summary>
    private async Task WithSeededSquadAsync(
        bool liveTracking,
        Func<GetPlayerProfileHandler, Guid, Guid, Guid, Task> body)
    {
        var databaseName = "stats_rich_" + Guid.NewGuid().ToString("N");
        await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, databaseName);

        try
        {
            var connectionString =
                MigrationTestSupport.ConnectionStringForDatabase(_fixture.ConnectionString, databaseName);

            await using (var schema = CreateContext(connectionString))
            {
                await schema.Database.MigrateAsync();
            }

            // --- Seed the squad, its members, and one completed match via the shared seeder. ---
            SeededStatsDataset seeded;
            await using (var write = CreateContext(connectionString))
            {
                seeded = await _seeder.SeedAsync(write, BuildSpec(liveTracking), new FakeTimeProvider(), CancellationToken.None);
            }

            SeededStatsDataset.SquadData squad = seeded.SquadAt(0);
            Guid subjectId = squad.Memberships[0].MembershipId;

            // --- Add an active registered requester so the read passes the authorisation gate. ---
            var requesterUserId = Guid.CreateVersion7();
            await using (var write = CreateContext(connectionString))
            {
                var members = new EfSquadMembershipRepository(write);
                SquadMembership requester = SquadMembership
                    .CreateRegistered(squad.SquadId, requesterUserId, "Requester")
                    .Value!;
                await members.AddAsync(requester, CancellationToken.None);
                await new UnitOfWork(write).SaveChangesAsync(CancellationToken.None);
            }

            // --- Read the subject's profile through the real handler stack. ---
            await using (var read = CreateContext(connectionString))
            {
                var stats = new EfStatsRepository(read, _ratingEngine, new SquadDisplayRatingParametersSource());
                var handler = new GetPlayerProfileHandler(
                    new EfSquadMembershipRepository(read),
                    new EfSquadRepository(read),
                    stats,
                    new SquadDisplayRatingParametersSource(),
                    new EmptyRichStatsSource(),
                    _ratingEngine);

                await body(handler, requesterUserId, squad.SquadId, subjectId);
            }
        }
        finally
        {
            await MigrationTestSupport.DropDatabaseAsync(_fixture.ConnectionString, databaseName);
        }
    }

    /// <summary>
    /// One squad with <paramref name="liveTracking"/> set, ten registered members, and a single
    /// completed 5v5 <c>Basic</c> match drawing its full roster from the pool so every member has an
    /// appearance. The result fidelity is <c>Basic</c> for both squads — rich gating depends only on
    /// the squad feature flag, never on the recorded fidelity.
    /// </summary>
    private static StatsDatasetSpec BuildSpec(bool liveTracking)
    {
        var members = new List<StatsDatasetSpec.MembershipSpec>(10);
        for (int i = 0; i < 10; i++)
        {
            members.Add(new StatsDatasetSpec.MembershipSpec(IsGuest: false, Inactive: false, Anonymise: false, Rating: null));
        }

        var matches = new List<StatsDatasetSpec.MatchSpec>
        {
            new(
                MatchState.Completed,
                ResultFidelity.Basic,
                TeamSizes: [5, 5],
                ShuffleSeed: 7,
                Scores: [3, 1],
                BibTeamIndex: 1,
                CompletedOffsetSeconds: 0)
        };

        return new StatsDatasetSpec([new StatsDatasetSpec.SquadSpec(liveTracking, members, matches)]);
    }

    /// <summary>Creates a production <see cref="PitchMateDbContext"/> bound to the throwaway database.</summary>
    private static PitchMateDbContext CreateContext(string connectionString) =>
        new(
            MigrationTestSupport.BuildContextOptions(connectionString),
            new FakeTimeProvider(),
            new FakeCurrentUserAccessor());
}
