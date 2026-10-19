using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using RatingEngineConfig = PitchMate.Domain.Rating.RatingEngineConfig;
using PitchMate.Infrastructure.Matches.Queries;
using PitchMate.Infrastructure;
using PitchMate.Infrastructure.Tests.Persistence;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Integration tests for <see cref="EfWorkingTeamsSource"/> and the working-teams handler over it
/// (match-read-models task 11.6), against <b>real PostgreSQL</b> with the production migrations applied.
/// <para>
/// Two direct-SQL <b>negative controls</b> plant states the aggregate forbids, because without them the
/// clauses that handle those states would be true only by construction: a rostered identity with no
/// participant row (the placeholder clause), and another squad's membership planted as a participant
/// (the squad scoping of the membership join). The statement count is pinned at three whatever the
/// participant and team counts.
/// </para>
/// <para>
/// <b>Validates: Requirements 4.7, 4.18, 13.2.</b>
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WorkingTeamsSourceIntegrationTests
{
    private static readonly IRatingEngine Engine = new PlackettLuceRatingEngine(new RatingEngineConfig());

    private static MatchListSourceHarness? _shared;

    private readonly MatchListSourceHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    public WorkingTeamsSourceIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _harness = _shared ??= new MatchListSourceHarness(fixture, "working_teams_source");
    }

    [Fact]
    public async Task RolledMatch_AgreesWithTheOracleIncludingThePrediction()
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(new MatchListDatasetSpec.SquadSpec(
            MemberCount: 14, RatedCount: 6, Matches: [new MatchListDatasetSpec.MatchSpec(MatchState.TeamsRolled, [4], ParticipantCount: 12)]));
        Match match = squad.Matches[0];

        WorkingTeamsView view = await ReadAsOrganiserAsync(squad, match);

        WorkingTeamsReferenceOracle.AssertAgrees(WorkingTeamsReferenceOracle.Expected(squad, match, Engine), view);
        Assert.Equal(2, view.Teams.Count);
        Assert.NotNull(view.Prediction);
        Assert.Empty(view.UnassignedParticipants);
    }

    [Fact]
    public async Task MatchWithNoTeams_ReportsNoTeamsNoPredictionAndEveryParticipantUnassigned()
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(new MatchListDatasetSpec.SquadSpec(
            MemberCount: 6, Matches: [new MatchListDatasetSpec.MatchSpec(MatchState.Confirmed, [3], ParticipantCount: 4)]));
        Match match = squad.Matches[0];

        WorkingTeamsView view = await ReadAsOrganiserAsync(squad, match);

        Assert.Empty(view.Teams);
        Assert.Null(view.Prediction);
        Assert.Equal(match.Participants.OrderBy(static p => p.RosterPosition).Select(static p => p.SquadMembershipId), view.UnassignedParticipants);
    }

    [Fact]
    public async Task SoftDeletedSquadOrMatch_IsNotVisible()
    {
        SeededMatchListDataset.SquadData deletedSquad = await _harness.SeedSquadAsync(new MatchListDatasetSpec.SquadSpec(
            MemberCount: 12, Matches: [new MatchListDatasetSpec.MatchSpec(MatchState.TeamsRolled, [3], ParticipantCount: 10)], SoftDeleteSquad: true));
        SeededMatchListDataset.SquadData deletedMatch = await _harness.SeedSquadAsync(new MatchListDatasetSpec.SquadSpec(
            MemberCount: 12, Matches: [new MatchListDatasetSpec.MatchSpec(MatchState.TeamsRolled, [3], ParticipantCount: 10, SoftDeleted: true)]));

        Assert.Null(await _harness.FindWorkingTeamsAsync(deletedSquad.Matches[0].Id));
        Assert.Null(await _harness.FindWorkingTeamsAsync(deletedMatch.Matches[0].Id));
    }

    [Fact]
    public async Task EveryLifecycleState_AndInterleavedSquads_AgreeWithTheOracle()
    {
        SeededMatchListDataset seeded = await _harness.SeedAsync(new MatchListDatasetSpec(
        [
            new MatchListDatasetSpec.SquadSpec(14, RatedCount: 3, Matches:
            [
                new(MatchState.GatheringAvailability, [2]),
                new(MatchState.Confirmed, [4], ParticipantCount: 10, ProposeTeamsWithoutLock: true),
                new(MatchState.TeamsRolled, [6], ParticipantCount: 11, MoveAfterLock: true),
                new(MatchState.InProgress, [8], ParticipantCount: 12),
                new(MatchState.Completed, [10], ParticipantCount: 10),
                new(MatchState.Cancelled, [12], ParticipantCount: 10, CancelFromRolled: true),
            ]),
            new MatchListDatasetSpec.SquadSpec(12, Matches: [new(MatchState.TeamsRolled, [5], ParticipantCount: 10)]),
        ]));

        foreach (SeededMatchListDataset.SquadData squad in seeded.Squads)
        {
            foreach (Match match in squad.Matches)
            {
                WorkingTeamsReferenceOracle.AssertAgrees(
                    WorkingTeamsReferenceOracle.Expected(squad, match, Engine), await ReadAsOrganiserAsync(squad, match));
            }
        }
    }

    // Negative control 1 — a rostered identity with no participant row reports the placeholder, and the
    // read still succeeds. Without this plant the placeholder clause would be dead code.
    [Fact]
    public async Task RosteredIdentityWithNoParticipant_ReportsThePlaceholder()
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(new MatchListDatasetSpec.SquadSpec(
            MemberCount: 12, Matches: [new MatchListDatasetSpec.MatchSpec(MatchState.TeamsRolled, [3], ParticipantCount: 10)]));
        Match match = squad.Matches[0];
        Guid stranger = Guid.CreateVersion7();
        Guid teamId = match.Teams.OrderBy(static team => team.Id, PitchMate.Domain.Common.UuidV7Comparer.Instance).First().Id;

        await _harness.AppendToTeamRosterAsync(teamId, stranger);
        WorkingTeamsView view = await ReadAsOrganiserAsync(squad, match);

        RosterEntry planted = view.Teams.Single(team => team.TeamId == teamId).Roster[^1];
        Assert.Equal(stranger, planted.SquadMembershipId);
        Assert.Equal(SquadMembership.DisplayNamePlaceholder, planted.DisplayName);
        Assert.NotNull(view.Prediction);
    }

    // Negative control 2 — another squad's membership, planted as a participant and on a roster, does
    // not resolve to that membership's name. A membership join without the squad clause would report it.
    [Fact]
    public async Task CrossSquadParticipant_DoesNotResolveThroughAnotherSquadsMembership()
    {
        SeededMatchListDataset seeded = await _harness.SeedAsync(new MatchListDatasetSpec(
        [
            new MatchListDatasetSpec.SquadSpec(12, Matches: [new(MatchState.TeamsRolled, [3], ParticipantCount: 10)]),
            new MatchListDatasetSpec.SquadSpec(12, RatedCount: 12, Matches: [new(MatchState.TeamsRolled, [4], ParticipantCount: 10)]),
        ]));
        SeededMatchListDataset.SquadData target = seeded.SquadAt(0);
        SeededMatchListDataset.SquadData other = seeded.SquadAt(1);
        Match match = target.Matches[0];
        MatchParticipant foreign = other.Matches[0].Participants.First();
        Guid teamId = match.Teams.OrderBy(static team => team.Id, PitchMate.Domain.Common.UuidV7Comparer.Instance).First().Id;

        await _harness.PlantParticipantCopyAsync(other.Matches[0].Id, foreign.SquadMembershipId, match.Id);
        await _harness.AppendToTeamRosterAsync(teamId, foreign.SquadMembershipId);

        WorkingTeamsProjection? projection = await _harness.FindWorkingTeamsAsync(match.Id);

        Assert.NotNull(projection);
        RosterEntry planted = projection!.Teams.Single(team => team.TeamId == teamId).Roster[^1];
        Assert.Equal(foreign.SquadMembershipId, planted.SquadMembershipId);
        Assert.NotEqual(SquadMembership.DisplayNamePlaceholder, foreign.DisplayName);
        Assert.Equal(SquadMembership.DisplayNamePlaceholder, planted.DisplayName);
        Assert.False(projection.RatingsByMembershipId.ContainsKey(foreign.SquadMembershipId));
        Assert.True(other.Ratings.ContainsKey(foreign.SquadMembershipId));
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(40, 0)]
    [InlineData(0, 4)]
    [InlineData(40, 4)]
    public async Task StatementCount_IsThree_WhateverTheParticipantAndTeamCounts(int participants, int teams)
    {
        MatchListDatasetSpec.TeamPlan? plan = teams == 0
            ? null
            : new MatchListDatasetSpec.TeamPlan(
                [.. Enumerable.Range(0, teams).Select(index => new MatchListDatasetSpec.PlannedTeam($"T{index}", index == 0, participants / teams))],
                []);

        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(new MatchListDatasetSpec.SquadSpec(
            MemberCount: Math.Max(participants, 2),
            RatedCount: participants / 2,
            Matches: [new MatchListDatasetSpec.MatchSpec(MatchState.Confirmed, [3], ParticipantCount: participants, Teams: plan)]));

        (WorkingTeamsProjection? projection, CommandCountingInterceptor commands) =
            await _harness.FindWorkingTeamsCapturingCommandsAsync(squad.Matches[0].Id);

        Assert.NotNull(projection);
        Assert.Equal(teams, projection!.Teams.Count);
        Assert.Equal(participants, projection.ParticipantIds.Count);
        Assert.Equal(3, commands.ExecutedCommandCount);
    }

    private async Task<WorkingTeamsView> ReadAsOrganiserAsync(SeededMatchListDataset.SquadData squad, Match match)
    {
        Result<WorkingTeamsView> result = await _harness.GetWorkingTeamsAsync(squad.Organiser.UserId!.Value, match.Id, Engine);
        Assert.True(result.IsSuccess, result.Error?.Message);
        return result.Value!;
    }
}
