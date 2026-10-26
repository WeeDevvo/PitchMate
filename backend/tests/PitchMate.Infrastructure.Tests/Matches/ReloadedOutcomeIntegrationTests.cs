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
/// A match read back from PostgreSQL derives its outcome — and projects its team sheet — against the
/// teams the result was recorded for, whatever order its working teams load in.
/// <para>
/// <see cref="MatchTeam"/> rows carry no position, so a reloaded match's working teams come back in
/// the database's order rather than the order they were locked in. Two teams created in the same
/// millisecond have version-7 identities whose order is random, so for a run of seeded matches some
/// reload swapped. For every one the winning team's kickoff roster must take the better rank and the
/// sheet must name each team's own identity; the test also asserts at least one match did reload
/// swapped, so it cannot pass vacuously.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ReloadedOutcomeIntegrationTests
{
    private const int MatchCount = 40;
    private const int TeamSize = 5;

    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public ReloadedOutcomeIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    /// <summary>
    /// For every reloaded match the team that scored more is ranked first, its sheet entry carries its
    /// own identity, and at least one match reloaded with its working teams out of locked order.
    /// </summary>
    [Fact]
    public async Task ReloadedMatch_RanksAndSheetsTheTeamTheScoreWasRecordedFor()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            var clock = new FakeTimeProvider();
            var nowUtc = clock.GetUtcNow();
            var day = nowUtc.AddDays(7);

            Squad squad = Squad.Create("Reload Rovers").Value!;
            var members = Enumerable.Range(1, TeamSize * 2)
                .Select(i => SquadMembership.CreateRegistered(squad.Id, Guid.CreateVersion7(), $"Player {i}").Value!)
                .ToList();

            await using (var seed = CreateContext(connectionString, clock))
            {
                await new EfSquadRepository(seed).AddAsync(squad, CancellationToken.None);
                var memberships = new EfSquadMembershipRepository(seed);
                foreach (var member in members)
                {
                    await memberships.AddAsync(member, CancellationToken.None);
                }

                await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);
            }

            // Each match: Reds (first five) beat Blues (last five) 3-0, recorded against the working teams.
            var winnersByMatch = new Dictionary<Guid, (Guid RedsTeamId, IReadOnlyList<Guid> RedsRoster)>();
            await using (var write = CreateContext(connectionString, clock))
            {
                var repository = new EfMatchRepository(write);
                for (var m = 0; m < MatchCount; m++)
                {
                    Match match = Match.CreateDraft(Guid.CreateVersion7(), squad.Id, "Pitch 1", [day], nowUtc).Value!;
                    Assert.True(match.Confirm(day, []).IsSuccess);
                    foreach (var member in members)
                    {
                        Assert.True(match.AddParticipant(member).IsSuccess);
                    }

                    var reds = members.Take(TeamSize).Select(member => member.Id).ToList();
                    var blues = members.Skip(TeamSize).Select(member => member.Id).ToList();
                    Assert.True(match.ApplyTeamProposal(
                    [
                        new ProposedTeam("Reds", BibFlag: false, reds),
                        new ProposedTeam("Blues", BibFlag: true, blues)
                    ]).IsSuccess);
                    Assert.True(match.Lock().IsSuccess);
                    Assert.True(match.Start().IsSuccess);

                    var redsId = match.Teams.Single(team => team.TeamName == "Reds").Id;
                    var bluesId = match.Teams.Single(team => team.TeamName == "Blues").Id;
                    Assert.True(match.RecordResult(
                        new MatchResult(ResultFidelity.Basic, [new TeamScore(redsId, 3), new TeamScore(bluesId, 0)]),
                        liveTrackingEnabled: false).IsSuccess);

                    winnersByMatch[match.Id] = (redsId, reds);
                    await repository.AddAsync(match, CancellationToken.None);
                }

                await new UnitOfWork(write).SaveChangesAsync(CancellationToken.None);
            }

            var ratings = members.ToDictionary(member => member.Id, _ => new PlayerRating(Mu: 25.0, Sigma: 8.0));
            var names = members.ToDictionary(member => member.Id, member => member.DisplayName);
            var reloadedSwapped = 0;

            await using (var read = CreateContext(connectionString, clock))
            {
                var repository = new EfMatchRepository(read);
                foreach (var (matchId, (redsTeamId, redsRoster)) in winnersByMatch)
                {
                    Match reloaded = (await repository.GetByIdAsync(matchId, CancellationToken.None))!;
                    if (reloaded.Teams.First().Id != redsTeamId)
                    {
                        reloadedSwapped++;
                    }

                    var outcome = reloaded.DeriveOutcome(ratings);
                    Assert.True(outcome.IsSuccess, outcome.Error?.Message);

                    // The kickoff lineup keeps Reds first; the winning roster must hold rank 1.
                    var lineup = reloaded.KickoffLineup!.Teams;
                    Assert.Equal(redsRoster, lineup[0].ParticipantMembershipIds);
                    Assert.Equal(1, outcome.Value!.Teams[0].Rank);
                    Assert.Equal(2, outcome.Value.Teams[1].Rank);

                    var sheet = reloaded.ProduceTeamSheet(names).Value!;
                    Assert.Equal(redsTeamId, sheet.Teams.Single(team => team.TeamName == "Reds").TeamId);
                }
            }

            Assert.True(reloadedSwapped > 0, "No match reloaded with its teams out of locked order; the test exercised nothing.");
        });
    }

    private static PitchMateDbContext CreateContext(string connectionString, TimeProvider clock) =>
        new(
            MigrationTestSupport.BuildContextOptions(connectionString),
            clock,
            new FakeCurrentUserAccessor());

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
