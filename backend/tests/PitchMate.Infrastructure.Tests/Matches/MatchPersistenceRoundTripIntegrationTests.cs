using Microsoft.EntityFrameworkCore;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Matches.Repositories;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Tests.Persistence;
using PlayerRating = PitchMate.Domain.Rating.Rating;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Persistence round-trip integration tests for the match-lifecycle infrastructure, exercised
/// against a <em>real</em> PostgreSQL instance via the shared Testcontainers fixture with the
/// production EF Core migrations applied — never the EF in-memory provider or SQLite, so they
/// observe actual <c>uuid</c>/<c>timestamptz</c>/<c>jsonb</c> mapping, constraint, and transaction
/// behaviour (per coding-standards: "run against real PostgreSQL via Testcontainers, and apply EF
/// migrations against the container"). Each test runs against its own freshly created, migrated
/// database on the shared server, so it is isolated from every other test.
/// <para>
/// The tests confirm two guarantees:
/// </para>
/// <list type="number">
/// <item>The match-lifecycle migration applies cleanly to a fresh database, creating every match
/// table (Requirement 12.1, 12.4).</item>
/// <item>A fully populated <see cref="Match"/> — its candidate days, participants (registered and
/// guest), working teams, captured <see cref="KickoffLineup"/>, recorded <see cref="MatchResult"/>,
/// completion instant, plus each participant's <see cref="MembershipRating"/> and per-match
/// <see cref="RatingSnapshot"/> — persists through the repositories and <see cref="PitchMateDbContext"/>
/// and reloads faithfully via <see cref="EfMatchRepository.GetByIdAsync"/> and the completed-match
/// ordering query (Requirement 12.1, 12.4).</item>
/// </list>
/// <para>Validates: Requirements 12.1, 12.4.</para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class MatchPersistenceRoundTripIntegrationTests
{
    // Match tables created by the AddMatchLifecycle migration (snake_case, singular entity names).
    private static readonly string[] MatchTables =
    [
        "match",
        "membership_rating",
        "availability_response",
        "match_participant",
        "match_team",
        "rating_snapshot"
    ];

    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public MatchPersistenceRoundTripIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Requirement 12.1, 12.4 — the production migrations, including AddMatchLifecycle, apply cleanly to
    // a fresh database, creating every match table.
    /// <summary>
    /// Applying the production EF Core migrations to a fresh database creates every match-lifecycle
    /// table.
    /// </summary>
    [Fact]
    public async Task Migrations_ApplyCleanly_CreatingEveryMatchTable()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            foreach (var table in MatchTables)
            {
                Assert.True(
                    await MigrationTestSupport.TableExistsAsync(connectionString, "public", table),
                    $"Expected the match table '{table}' to exist after applying migrations.");
            }
        });
    }

    // Requirement 12.1, 12.4 — a match walked through its full lifecycle and completed, together with
    // its participants' current ratings and per-match snapshots, persists and reloads faithfully.
    /// <summary>
    /// A fully populated, completed match with participants, teams, a captured kickoff lineup, a
    /// recorded result, membership ratings, and rating snapshots persists and reloads with every field
    /// intact, and appears in the squad's chronological completed-match ordering.
    /// </summary>
    [Fact]
    public async Task CompletedMatch_WithFullGraph_PersistsAndReloadsFaithfully()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            var clock = new FakeTimeProvider();
            var nowUtc = clock.GetUtcNow();
            var confirmedDay = nowUtc.AddDays(7);
            var secondDay = nowUtc.AddDays(14);
            var completedAt = confirmedDay.AddHours(1);

            // --- Seed the squad and its memberships (FK targets for the match graph). ---
            // Nine registered members who will mark the confirmed day, plus one guest, giving a 5v5.
            Squad squad = Squad.Create("Weekend Warriors").Value!;
            var squadId = squad.Id;

            var registered = new List<SquadMembership>();
            for (var i = 0; i < 9; i++)
            {
                registered.Add(SquadMembership
                    .CreateRegistered(squadId, Guid.CreateVersion7(), $"Player {i + 1}")
                    .Value!);
            }

            SquadMembership guestMembership = SquadMembership
                .CreateGuest(squadId, "Ringer", skillTier: null, lawfulBasisAckAt: nowUtc)
                .Value!;

            await using (var seed = CreateContext(connectionString, clock))
            {
                await new EfSquadRepository(seed).AddAsync(squad, CancellationToken.None);
                var members = new EfSquadMembershipRepository(seed);

                // An owner (organiser); not a participant, present so the squad is well-formed.
                SquadMembership owner = SquadMembership.CreateOwner(squadId, Guid.CreateVersion7(), "Skipper").Value!;
                await members.AddAsync(owner, CancellationToken.None);

                foreach (var member in registered)
                {
                    await members.AddAsync(member, CancellationToken.None);
                }

                await members.AddAsync(guestMembership, CancellationToken.None);

                await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);
            }

            // --- Build the match aggregate through its full lifecycle in memory. ---
            Match match = Match.CreateDraft(
                Guid.CreateVersion7(),
                squadId,
                "Hackney Marshes, Pitch 3",
                [confirmedDay, secondDay],
                nowUtc).Value!;

            // Every registered member marks the confirmed day so confirmation seeds them as participants.
            foreach (var member in registered)
            {
                Assert.True(
                    match.SubmitAvailability(member.Id, [confirmedDay], nowUtc).IsSuccess);
            }

            var registeredMembers = registered
                .Select(m => new RegisteredMember(m.Id, m.DisplayName))
                .ToList();

            Assert.True(
                match.Confirm(confirmedDay, availableCount: registeredMembers.Count, minimumThreshold: 9, registeredMembers)
                    .IsSuccess);
            Assert.Equal(9, match.Participants.Count);

            // Add the guest participant (permitted while Confirmed) to complete the 5v5 pool. The
            // already-seeded guest membership instance is reused so AddParticipant references its id.
            Assert.True(match.AddParticipant(guestMembership).IsSuccess);
            Assert.Equal(10, match.Participants.Count);

            // Partition the ten participants into two named teams, one wearing bibs.
            var participantIds = match.Participants
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
            Assert.NotNull(match.KickoffLineup);

            Assert.True(match.Start().IsSuccess);

            var teamAId = match.Teams.First(t => t.TeamName == "Reds").Id;
            var teamBId = match.Teams.First(t => t.TeamName == "Blues").Id;
            var result = new MatchResult(
                ResultFidelity.Basic,
                [new TeamScore(teamAId, 3), new TeamScore(teamBId, 2)]);
            Assert.True(match.RecordResult(result, liveTrackingEnabled: false).IsSuccess);

            Assert.True(match.Complete(completedAt).IsSuccess);

            // Per-participant seeded rating and post-match snapshot, deterministic per membership.
            var ratingByMembership = participantIds.ToDictionary(
                id => id,
                id => new PlayerRating(25.0 + (id.GetHashCode() % 5), 8.333 - (Math.Abs(id.GetHashCode()) % 3)));

            // --- Persist the match graph, ratings, and snapshots atomically. ---
            await using (var write = CreateContext(connectionString, clock))
            {
                await new EfMatchRepository(write).AddAsync(match, CancellationToken.None);

                var ratings = new EfMembershipRatingRepository(write);
                foreach (var membershipId in participantIds)
                {
                    await ratings.AddAsync(
                        MembershipRating.Create(membershipId, ratingByMembership[membershipId]),
                        CancellationToken.None);
                    await write.Set<RatingSnapshot>().AddAsync(
                        RatingSnapshot.Capture(match.Id, membershipId, ratingByMembership[membershipId]),
                        CancellationToken.None);
                }

                await new UnitOfWork(write).SaveChangesAsync(CancellationToken.None);
            }

            // --- Reload through a fresh context and assert faithful round-trip. ---
            await using (var read = CreateContext(connectionString, clock))
            {
                Match? reloaded = await new EfMatchRepository(read).GetByIdAsync(match.Id, CancellationToken.None);

                Assert.NotNull(reloaded);
                Assert.Equal(squadId, reloaded!.SquadId);
                Assert.Equal(MatchState.Completed, reloaded.State);
                Assert.Equal("Hackney Marshes, Pitch 3", reloaded.Location);
                Assert.NotNull(reloaded.ConfirmedDay);
                Assert.Equal(confirmedDay, reloaded.ConfirmedDay!.Value.Instant);
                Assert.NotNull(reloaded.CompletedAt);
                Assert.Equal(completedAt, reloaded.CompletedAt!.Value);

                // Candidate days preserved (both, by instant).
                var reloadedDays = reloaded.CandidateDays.Select(d => d.Instant).OrderBy(i => i).ToList();
                Assert.Equal(new[] { confirmedDay, secondDay }.OrderBy(i => i), reloadedDays);

                // Participants: ten, registered + one guest, display names and guest flags intact.
                Assert.Equal(10, reloaded.Participants.Count);
                var reloadedGuest = reloaded.Participants.Single(p => p.IsGuest);
                Assert.Equal(guestMembership.Id, reloadedGuest.SquadMembershipId);
                Assert.Equal("Ringer", reloadedGuest.DisplayName);
                Assert.Equal(9, reloaded.Participants.Count(p => !p.IsGuest));
                Assert.Equal(
                    participantIds.OrderBy(i => i),
                    reloaded.Participants.Select(p => p.SquadMembershipId).OrderBy(i => i));

                // Working teams: two, names and single bib flag and rosters intact.
                Assert.Equal(2, reloaded.Teams.Count);
                MatchTeam reds = reloaded.Teams.Single(t => t.TeamName == "Reds");
                MatchTeam blues = reloaded.Teams.Single(t => t.TeamName == "Blues");
                Assert.False(reds.BibFlag);
                Assert.True(blues.BibFlag);
                Assert.Equal(teamAIds, reds.Roster);
                Assert.Equal(teamBIds, blues.Roster);

                // Kickoff lineup (jsonb) preserved: two teams, one bib, rosters mirror the locked teams.
                Assert.NotNull(reloaded.KickoffLineup);
                Assert.Equal(2, reloaded.KickoffLineup!.Teams.Count);
                Assert.Equal(1, reloaded.KickoffLineup.Teams.Count(t => t.BibFlag));
                KickoffTeam lineupReds = reloaded.KickoffLineup.Teams.Single(t => t.TeamName == "Reds");
                KickoffTeam lineupBlues = reloaded.KickoffLineup.Teams.Single(t => t.TeamName == "Blues");
                Assert.Equal(teamAIds, lineupReds.ParticipantMembershipIds);
                Assert.Equal(teamBIds, lineupBlues.ParticipantMembershipIds);

                // Recorded result (jsonb) preserved: fidelity and per-team scores.
                Assert.NotNull(reloaded.RecordedResult);
                Assert.Equal(ResultFidelity.Basic, reloaded.RecordedResult!.Fidelity);
                Assert.Equal(3, reloaded.RecordedResult.TeamScores.Single(s => s.TeamId == teamAId).Score);
                Assert.Equal(2, reloaded.RecordedResult.TeamScores.Single(s => s.TeamId == teamBId).Score);

                // Membership ratings: one per participant, μ/σ intact.
                var ratingRepo = new EfMembershipRatingRepository(read);
                foreach (var membershipId in participantIds)
                {
                    MembershipRating? rating = await ratingRepo.GetAsync(membershipId, CancellationToken.None);
                    Assert.NotNull(rating);
                    Assert.Equal(ratingByMembership[membershipId].Mu, rating!.Mu, precision: 9);
                    Assert.Equal(ratingByMembership[membershipId].Sigma, rating.Sigma, precision: 9);
                }

                // Rating snapshots: one per participant for this match, μ/σ intact.
                var snapshots = await read.Set<RatingSnapshot>()
                    .Where(s => s.MatchId == match.Id)
                    .ToListAsync(CancellationToken.None);
                Assert.Equal(10, snapshots.Count);
                foreach (var snapshot in snapshots)
                {
                    Assert.Equal(ratingByMembership[snapshot.SquadMembershipId].Mu, snapshot.Mu, precision: 9);
                    Assert.Equal(ratingByMembership[snapshot.SquadMembershipId].Sigma, snapshot.Sigma, precision: 9);
                }

                // The completed match appears in the squad's chronological completed ordering.
                IReadOnlyList<Match> completed = await new EfMatchRepository(read)
                    .ListChronologicalCompletedForSquadAsync(squadId, CancellationToken.None);
                Assert.Single(completed);
                Assert.Equal(match.Id, completed[0].Id);
            }
        });
    }

    /// <summary>
    /// Creates a production <see cref="PitchMateDbContext"/> bound to the throwaway database using the
    /// supplied clock so audit stamping observes a controllable instant.
    /// </summary>
    private static PitchMateDbContext CreateContext(string connectionString, TimeProvider clock) =>
        new(
            MigrationTestSupport.BuildContextOptions(connectionString),
            clock,
            new FakeCurrentUserAccessor());

    /// <summary>
    /// Creates a uniquely-named empty database on the shared server, applies the production EF Core
    /// migrations to it (validating the match-lifecycle migration too), runs the test body against a
    /// connection string targeting it, and drops it afterwards regardless of outcome.
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
}
