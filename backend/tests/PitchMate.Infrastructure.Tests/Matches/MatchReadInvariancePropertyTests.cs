using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Matches.Queries;
using PitchMate.Infrastructure.Matches.Repositories;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Tests.Persistence;
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using RatingEngineConfig = PitchMate.Domain.Rating.RatingEngineConfig;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Model-based property tests for the reads' side-effect freedom and cost (match-read-models tasks
/// 14.4–14.5), on Testcontainers PostgreSQL. Requires Docker.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class MatchReadInvariancePropertyTests
{
    private const int MaxTest = 10;

    private static readonly IRatingEngine Engine = new PlackettLuceRatingEngine(new RatingEngineConfig());

    private static MatchListSourceHarness? _shared;

    private readonly MatchListSourceHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    public MatchReadInvariancePropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = _shared ??= new MatchListSourceHarness(fixture, "match_read_invariance");
    }

    // Feature: match-read-models, Property 24: Every read leaves the database exactly as it found it, and
    // is deterministic.
    /// <summary>
    /// **Validates: Requirements 1.14, 2.9, 3.11, 4.17, 11.8, 11.11, 13.8, 13.9** — for every match, the
    /// row-level snapshot of the match, participant, team, availability-response and squad
    /// membership-rating rows (every column, audit and soft-delete included) is identical before and
    /// after the list, detail and working-teams reads — so no seeded rating is ever persisted and no
    /// <c>updated_at</c> is stamped — and two successive calls of each read return structurally equal
    /// values. (The Domain conjunct, that producing the team sheet leaves the aggregate unchanged, is
    /// <c>MatchTeamSheetGateTests.ProducingTheSheetIsPure</c>.)
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property EveryReadLeavesTheDatabaseAsItFoundItAndIsDeterministic() =>
        Prop.ForAll(Arb.From(MatchListDatasetGenerators.Dataset()), spec => RunAsync(async () =>
        {
            SeededMatchListDataset seeded = await _harness.SeedAsync(spec);

            foreach (SeededMatchListDataset.SquadData squad in seeded.Squads)
            {
                Guid caller = squad.Organiser.UserId!.Value;

                foreach (Match match in squad.Admitted)
                {
                    IReadOnlyList<string> before = await _harness.SnapshotRowsAsync(squad.SquadId, match.Id);
                    Assert.NotEmpty(before);

                    MatchListPage? list1 = await _harness.ListForSquadAsync(squad.SquadId, MatchListLimits.MaximumEntries);
                    Result<MatchDetail> detail1 = await _harness.GetDetailAsync(caller, match.Id);
                    Result<WorkingTeamsView> teams1 = await _harness.GetWorkingTeamsAsync(caller, match.Id, Engine);

                    Assert.Equal(before, await _harness.SnapshotRowsAsync(squad.SquadId, match.Id));

                    MatchListPage? list2 = await _harness.ListForSquadAsync(squad.SquadId, MatchListLimits.MaximumEntries);
                    Result<MatchDetail> detail2 = await _harness.GetDetailAsync(caller, match.Id);
                    Result<WorkingTeamsView> teams2 = await _harness.GetWorkingTeamsAsync(caller, match.Id, Engine);

                    MatchListReferenceOracle.AssertAgrees(list1!, list2);
                    AssertDetailsEqual(detail1.Value!, detail2.Value!);
                    WorkingTeamsReferenceOracle.AssertAgrees(teams1.Value!, teams2.Value);
                }
            }

            return true;
        }));

    // Feature: match-read-models, Property 25: The round-trip count is fixed, whatever the data.
    /// <summary>
    /// **Validates: Requirements 1.13, 2.12, 4.18** — through the real handlers over the production EF
    /// gateways, the list read executes 2 commands for a squad of 1 to 201 matches, the detail read 3 for
    /// a match of 0 to 40 participants and 1 to 14 candidate days, and the working-teams read 4 for a
    /// match of 0 to 40 participants and 0 to 4 teams.
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property TheRoundTripCountIsFixedWhateverTheData() =>
        Prop.ForAll(
            Arb.From(
                from matches in Gen.OneOf(Gen.Choose(1, 12), Gen.Elements(50, MatchListLimits.MaximumEntries + 1))
                from participants in Gen.OneOf(Gen.Choose(0, 12), Gen.Elements(39, 40))
                from days in Gen.Choose(1, 14)
                from teams in Gen.Choose(0, 4)
                select (Matches: matches, Participants: participants, Days: days, Teams: teams)),
            size => RunAsync(async () =>
            {
                // The list read over a squad of `Matches` drafts.
                SeededMatchListDataset.SquadData listed = (await _harness.SeedAsync(
                    MatchListDatasetGenerators.BoundDataset(size.Matches).Sample(0, 1).First())).SquadAt(0);
                Guid listCaller = listed.Organiser.UserId!.Value;

                int listCommands = await _harness.CountCommandsAsync(async context =>
                {
                    var handler = new GetMatchListHandler(new EfMatchListSource(context), new EfSquadMembershipRepository(context));
                    Assert.True((await handler.HandleAsync(new GetMatchListCommand(listCaller, listed.SquadId), CancellationToken.None)).IsSuccess);
                });

                // The detail and working-teams reads over one confirmed match of the generated shape.
                MatchListDatasetSpec.TeamPlan? plan = size.Teams == 0
                    ? null
                    : new MatchListDatasetSpec.TeamPlan(
                        [.. Enumerable.Range(0, size.Teams).Select(index => new MatchListDatasetSpec.PlannedTeam(
                            $"T{index}", index == 0, size.Participants / size.Teams + (index < size.Participants % size.Teams ? 1 : 0)))],
                        []);

                SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(new MatchListDatasetSpec.SquadSpec(
                    MemberCount: Math.Max(size.Participants, 2),
                    RatedCount: size.Participants / 2,
                    Matches:
                    [
                        new MatchListDatasetSpec.MatchSpec(
                            MatchState.Confirmed,
                            [.. Enumerable.Range(1, size.Days)],
                            ParticipantCount: size.Participants,
                            Teams: plan),
                    ]));
                Guid caller = squad.Organiser.UserId!.Value;
                Guid matchId = squad.Matches[0].Id;

                int detailCommands = await _harness.CountCommandsAsync(async context =>
                {
                    var handler = new GetMatchDetailHandler(
                        new EfMatchDetailSource(context), new EfSquadMembershipRepository(context), new EfAvailabilityRepository(context));
                    Assert.True((await handler.HandleAsync(new GetMatchDetailCommand(caller, matchId), CancellationToken.None)).IsSuccess);
                });

                int teamsCommands = await _harness.CountCommandsAsync(async context =>
                {
                    var handler = new GetWorkingTeamsHandler(new EfWorkingTeamsSource(context), new EfSquadMembershipRepository(context), Engine);
                    Assert.True((await handler.HandleAsync(new GetWorkingTeamsCommand(caller, matchId), CancellationToken.None)).IsSuccess);
                });

                Assert.Equal(2, listCommands);
                Assert.Equal(3, detailCommands);
                Assert.Equal(4, teamsCommands);
                return true;
            }));

    private static void AssertDetailsEqual(MatchDetail first, MatchDetail second)
    {
        MatchDetailReferenceOracle.AssertAgrees(
            new MatchDetailProjection(
                first.MatchId, first.SquadId, first.State, first.Location, first.CandidateDays,
                first.ConfirmedDay, first.Participants, first.RecordedResult, first.CompletedAt),
            first.CallerAvailability,
            second);
    }

    private static bool RunAsync(Func<Task<bool>> body) => body().GetAwaiter().GetResult();
}
