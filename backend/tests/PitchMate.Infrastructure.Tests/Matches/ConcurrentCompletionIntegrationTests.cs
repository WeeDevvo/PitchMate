using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure;
using PitchMate.Infrastructure.Matches.Repositories;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Tests.Persistence;

// PitchMate.Domain.Matches, PitchMate.Domain.Squads, and PitchMate.Domain.Rating each define their
// own Result / Result<T> triad, so the unqualified names are ambiguous. This test never uses an
// unqualified Result; the rating engine's leaf types are aliased, the rating Result<T> is qualified
// inside the decorator, and the completion Result<CompleteMatchResult> is aliased below.
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using RatingEngineConfig = PitchMate.Domain.Rating.RatingEngineConfig;
using SkillTier = PitchMate.Domain.Rating.SkillTier;
using RatingState = PitchMate.Domain.Rating.RatingState;
using RatingMatchUpdate = PitchMate.Domain.Rating.MatchUpdate;
using RatingMatchOutcome = PitchMate.Domain.Rating.MatchOutcome;
using ReplayMatch = PitchMate.Domain.Rating.ReplayMatch;
using MatchPrediction = PitchMate.Domain.Rating.MatchPrediction;
using TeamRoster = PitchMate.Domain.Rating.TeamRoster;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using NotificationResult = PitchMate.Domain.Notifications.Result;
using CompletionResult = PitchMate.Domain.Matches.Result<PitchMate.Application.Matches.UseCases.CompleteMatchResult>;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Integration tests for idempotent, concurrent match completion, exercised against a <em>real</em>
/// PostgreSQL instance via the shared Testcontainers fixture with the production EF Core migrations
/// applied — never the EF in-memory provider or SQLite, so they observe the actual <c>xmin</c>
/// optimistic-concurrency semantics the change tracker alone cannot reproduce (per coding-standards:
/// "run against real PostgreSQL via Testcontainers, and apply EF migrations against the container").
/// Each test runs against its own freshly created, migrated database on the shared server, so it is
/// isolated from every other test.
/// <para>
/// The test drives two <see cref="CompleteMatchHandler"/> invocations for the same in-progress match,
/// each in its own scope (its own <see cref="PitchMateDbContext"/>, repositories, and unit of work)
/// exactly as two real concurrent requests would. A shared <see cref="Barrier"/> woven into the
/// rating engine forces both completions to read the match as <see cref="MatchState.InProgress"/>
/// before either commits, so the row's <c>xmin</c> token — not the change tracker — must arbitrate
/// the race. It confirms the two product guarantees:
/// </para>
/// <list type="number">
/// <item>The rating update is applied <b>exactly once</b>: only one set of per-participant
/// <see cref="RatingSnapshot"/> rows exists and each membership rating is overwritten a single time —
/// the <c>xmin</c> guard lets at most one completion win (Requirement 13.4, 13.6).</item>
/// <item>The match ends <see cref="MatchState.Completed"/> and the losing completion observes it as
/// already completed and returns the existing recorded result without applying a second update
/// (Requirement 13.6).</item>
/// </list>
/// <para>Validates: Requirements 13.4, 13.6.</para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ConcurrentCompletionIntegrationTests
{
    private const int ParticipantCount = 10;

    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public ConcurrentCompletionIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Requirement 13.4, 13.6 — two concurrent completions of the same in-progress match, each in its
    // own scope and forced to read InProgress before either commits, apply the single rating update
    // exactly once: the xmin token permits one winner, and the loser observes the match as Completed
    // and returns the already-recorded result rather than re-applying.
    /// <summary>
    /// Two concurrent completions of one in-progress match yield exactly one applied rating update —
    /// one set of snapshots, membership ratings updated once — with the match left
    /// <see cref="MatchState.Completed"/>, one completion reporting a fresh completion and the other an
    /// idempotent already-completed no-op that returns the same recorded result.
    /// </summary>
    [Fact]
    public async Task ConcurrentCompletions_ApplyTheRatingUpdateExactlyOnce_LoserObservesCompleted()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            var clock = new FakeTimeProvider();
            var nowUtc = clock.GetUtcNow();
            var confirmedDay = nowUtc.AddDays(7);
            var secondDay = nowUtc.AddDays(14);

            var ownerUserId = Guid.CreateVersion7();

            // --- Seed the squad, its memberships, and an in-progress match with a recorded result. ---
            Squad squad = Squad.Create("Weekend Warriors").Value!;
            Guid squadId = squad.Id;

            var registered = new List<SquadMembership>();
            for (var i = 0; i < ParticipantCount; i++)
            {
                registered.Add(SquadMembership
                    .CreateRegistered(squadId, Guid.CreateVersion7(), $"Player {i + 1}")
                    .Value!);
            }

            SquadMembership owner = SquadMembership.CreateOwner(squadId, ownerUserId, "Skipper").Value!;

            await using (var seed = CreateContext(connectionString, clock))
            {
                await new EfSquadRepository(seed).AddAsync(squad, CancellationToken.None);
                var members = new EfSquadMembershipRepository(seed);
                await members.AddAsync(owner, CancellationToken.None);
                foreach (var member in registered)
                {
                    await members.AddAsync(member, CancellationToken.None);
                }

                await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);
            }

            // Walk the match through its lifecycle in memory, stopping in InProgress with a recorded
            // result so completion has everything it needs (a captured kickoff lineup and a result).
            Match match = Match.CreateDraft(
                Guid.CreateVersion7(),
                squadId,
                "Hackney Marshes, Pitch 3",
                [confirmedDay, secondDay],
                nowUtc).Value!;
            Guid matchId = match.Id;

            foreach (var member in registered)
            {
                Assert.True(match.SubmitAvailability(member.Id, [confirmedDay], nowUtc).IsSuccess);
            }

            var registeredMembers = registered
                .Select(m => new RegisteredMember(m.Id, m.DisplayName))
                .ToList();

            Assert.True(match.Confirm(
                confirmedDay,
                availableCount: registeredMembers.Count,
                minimumThreshold: ParticipantCount,
                registeredMembers).IsSuccess);
            Assert.Equal(ParticipantCount, match.Participants.Count);

            List<Guid> participantIds = match.Participants
                .OrderBy(p => p.RosterPosition)
                .Select(p => p.SquadMembershipId)
                .ToList();

            var teamAIds = participantIds.Take(5).ToList();
            var teamBIds = participantIds.Skip(5).Take(5).ToList();

            Assert.True(match.ApplyTeamProposal(
            [
                new ProposedTeam("Reds", BibFlag: false, teamAIds),
                new ProposedTeam("Blues", BibFlag: true, teamBIds)
            ]).IsSuccess);

            Assert.True(match.Lock().IsSuccess);
            Assert.True(match.Start().IsSuccess);

            var teamAId = match.Teams.First(t => t.TeamName == "Reds").Id;
            var teamBId = match.Teams.First(t => t.TeamName == "Blues").Id;
            var result = new MatchResult(
                ResultFidelity.Basic,
                [new TeamScore(teamAId, 3), new TeamScore(teamBId, 2)]);
            Assert.True(match.RecordResult(result, liveTrackingEnabled: false).IsSuccess);
            Assert.Equal(MatchState.InProgress, match.State);

            // Deterministic, distinct pre-seeded ratings, so completion only *updates* existing rows
            // (no cold-start inserts) and the xmin race resolves purely on the match/rating rows.
            Dictionary<Guid, PlayerRating> seededRatings = participantIds
                .Select((id, index) => (id, index))
                .ToDictionary(x => x.id, x => new PlayerRating(Mu: 22.0 + x.index, Sigma: 6.0));

            await using (var write = CreateContext(connectionString, clock))
            {
                await new EfMatchRepository(write).AddAsync(match, CancellationToken.None);
                var ratings = new EfMembershipRatingRepository(write);
                foreach (var id in participantIds)
                {
                    await ratings.AddAsync(MembershipRating.Create(id, seededRatings[id]), CancellationToken.None);
                }

                await new UnitOfWork(write).SaveChangesAsync(CancellationToken.None);
            }

            // --- Drive two concurrent completions, forced to interleave via the shared barrier. ---
            // The barrier releases only once BOTH completions have read the InProgress match and
            // reached the single rating update, so both attempt to commit against the same xmin.
            using var barrier = new Barrier(2);
            var gatedEngine = new BarrierRatingEngine(new PlackettLuceRatingEngine(new RatingEngineConfig()), barrier);
            var command = new CompleteMatchCommand(ownerUserId, matchId);

            Task<CompletionResult> RunCompletionAsync() => Task.Run(async () =>
            {
                await using var context = CreateContext(connectionString, clock);
                var handler = new CompleteMatchHandler(
                    new EfMatchRepository(context),
                    new EfMembershipRatingRepository(context),
                    new EfRepository<RatingSnapshot>(context),
                    new EfSquadMembershipRepository(context),
                    new EfSquadRepository(context),
                    gatedEngine,
                    new UnitOfWork(context),
                    clock,
                    new NoOpNotificationPublisher(),
                    NullLogger<CompleteMatchHandler>.Instance);

                return await handler.HandleAsync(command, CancellationToken.None);
            });

            CompletionResult[] outcomes = await Task.WhenAll(RunCompletionAsync(), RunCompletionAsync());

            // Both requests succeed: the winner applies the update, the loser is an idempotent no-op.
            Assert.All(outcomes, o => Assert.True(o.IsSuccess, o.Error?.Message));

            // Exactly one fresh completion and exactly one already-completed observation
            // (Requirement 13.6): the xmin guard let a single completion win the race.
            Assert.Equal(1, outcomes.Count(o => !o.Value!.AlreadyCompleted));
            Assert.Equal(1, outcomes.Count(o => o.Value!.AlreadyCompleted));

            // Both return the same recorded result — the loser observes the existing result, not a
            // re-derived one (Requirement 13.6).
            CompleteMatchResult fresh = outcomes.Single(o => !o.Value!.AlreadyCompleted).Value!;
            CompleteMatchResult idempotent = outcomes.Single(o => o.Value!.AlreadyCompleted).Value!;
            Assert.Equal(matchId, idempotent.MatchId);
            Assert.Equal(fresh.Fidelity, idempotent.Fidelity);
            Assert.Equal(
                fresh.TeamScores.OrderBy(s => s.TeamId).Select(s => (s.TeamId, s.Score)),
                idempotent.TeamScores.OrderBy(s => s.TeamId).Select(s => (s.TeamId, s.Score)));

            // --- Verify the persisted state: the update was applied exactly once. ---
            await using (var verify = CreateContext(connectionString, clock))
            {
                Match? reloaded = await new EfMatchRepository(verify).GetByIdAsync(matchId, CancellationToken.None);
                Assert.NotNull(reloaded);
                Assert.Equal(MatchState.Completed, reloaded!.State);
                Assert.NotNull(reloaded.CompletedAt);

                // Exactly one snapshot per participant — a single applied update, not two
                // (Requirement 13.4). Two updates would have written two sets (20 rows).
                List<RatingSnapshot> snapshots = await verify.Set<RatingSnapshot>()
                    .Where(s => s.MatchId == matchId)
                    .ToListAsync(CancellationToken.None);
                Assert.Equal(ParticipantCount, snapshots.Count);
                Assert.Equal(
                    participantIds.OrderBy(i => i),
                    snapshots.Select(s => s.SquadMembershipId).OrderBy(i => i));

                // Each participant has exactly one current rating, updated once: it moved off its seed
                // and equals its single post-update snapshot (so no second update was layered on).
                var ratingRepo = new EfMembershipRatingRepository(verify);
                foreach (var id in participantIds)
                {
                    MembershipRating? current = await ratingRepo.GetAsync(id, CancellationToken.None);
                    Assert.NotNull(current);

                    RatingSnapshot snapshot = snapshots.Single(s => s.SquadMembershipId == id);
                    Assert.Equal(snapshot.Mu, current!.Mu, precision: 9);
                    Assert.Equal(snapshot.Sigma, current.Sigma, precision: 9);

                    // The completion genuinely applied an update: the current rating is not the seed.
                    bool changed =
                        Math.Abs(current.Mu - seededRatings[id].Mu) > 1e-9
                        || Math.Abs(current.Sigma - seededRatings[id].Sigma) > 1e-9;
                    Assert.True(changed, $"Participant {id}'s rating should have been updated exactly once.");
                }
            }
        });
    }

    /// <summary>
    /// Creates a production <see cref="PitchMateDbContext"/> bound to the throwaway database using the
    /// supplied clock so audit stamping and the completion instant observe a controllable instant.
    /// </summary>
    private static PitchMateDbContext CreateContext(string connectionString, TimeProvider clock) =>
        new(
            MigrationTestSupport.BuildContextOptions(connectionString),
            clock,
            new FakeCurrentUserAccessor());

    /// <summary>
    /// Creates a uniquely-named empty database on the shared server, applies the production EF Core
    /// migrations to it, runs the test body against a connection string targeting it, and drops it
    /// afterwards regardless of outcome.
    /// </summary>
    private async Task WithMigratedDatabaseAsync(Func<string, Task> body)
    {
        var databaseName = "match_" + Guid.NewGuid().ToString("N");
        await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, databaseName);

        try
        {
            var connectionString =
                MigrationTestSupport.ConnectionStringForDatabase(_fixture.ConnectionString, databaseName);

            await using (var schema = CreateContext(connectionString, new FakeTimeProvider()))
            {
                await schema.Database.MigrateAsync();
            }

            await body(connectionString);
        }
        finally
        {
            await MigrationTestSupport.DropDatabaseAsync(_fixture.ConnectionString, databaseName);
        }
    }

    /// <summary>
    /// An <see cref="IRatingEngine"/> decorator that delegates every operation to a real inner engine
    /// (so the completions apply genuine PlackettLuce updates) but rendezvous on a shared
    /// <see cref="Barrier"/> at the single rating update. Because <see cref="CompleteMatchHandler"/>
    /// calls <see cref="UpdateRatings"/> only after it has loaded the match, this guarantees both
    /// concurrent completions have read the match as in progress before either commits — forcing the
    /// row's <c>xmin</c> token to arbitrate the race rather than a serialised read (Requirement 13.4).
    /// </summary>
    private sealed class BarrierRatingEngine(IRatingEngine inner, Barrier barrier) : IRatingEngine
    {
        // A generous ceiling so a genuinely stuck test fails fast instead of hanging the suite; the
        // rendezvous itself completes in milliseconds once both threads arrive.
        private static readonly TimeSpan RendezvousTimeout = TimeSpan.FromSeconds(30);

        public PitchMate.Domain.Rating.Result<PlayerRating> CreateRating(SkillTier? tier = null) =>
            inner.CreateRating(tier);

        public PitchMate.Domain.Rating.Result<RatingState> GetState(PlayerRating rating) =>
            inner.GetState(rating);

        public PitchMate.Domain.Rating.Result<RatingMatchUpdate> UpdateRatings(RatingMatchOutcome outcome)
        {
            // Rendezvous: block until both concurrent completions reach the single rating update, so
            // both have already read the in-progress match and will contend on the same xmin.
            barrier.SignalAndWait(RendezvousTimeout);
            return inner.UpdateRatings(outcome);
        }

        public PitchMate.Domain.Rating.Result<IReadOnlyList<PlayerRating>> Replay(
            IReadOnlyList<PlayerRating> initialRatings,
            IReadOnlyList<ReplayMatch> matches) => inner.Replay(initialRatings, matches);

        public PitchMate.Domain.Rating.Result<PlayerRating> DecayInactivity(PlayerRating rating, int inactiveDays) =>
            inner.DecayInactivity(rating, inactiveDays);

        public PitchMate.Domain.Rating.Result<MatchPrediction> Predict(IReadOnlyList<TeamRoster> rosters) =>
            inner.Predict(rosters);
    }

    /// <summary>
    /// A no-op notification publisher: the <see cref="CompleteMatchHandler"/> raises a
    /// <c>ResultPosted</c> broadcast after a committed completion, but this test asserts only the
    /// database-enforced concurrency and idempotence guarantees, so the publish is an isolated success
    /// that persists and sends nothing.
    /// </summary>
    private sealed class NoOpNotificationPublisher : PitchMate.Application.Notifications.INotificationPublisher
    {
        public Task<NotificationResult> PublishAsync(
            PitchMate.Domain.Notifications.NotificationType type,
            Guid squadId,
            IReadOnlyCollection<Guid> directedTargetMembershipIds,
            PitchMate.Application.Notifications.NotificationContext context,
            CancellationToken cancellationToken) =>
            Task.FromResult(NotificationResult.Ok());
    }
}
