using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Matches.Queries;
using PitchMate.Infrastructure.Tests.Persistence;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Integration tests for <see cref="EfRosterDisplayNameSource"/> and the team sheet it feeds
/// (match-read-models task 13.7), against <b>real PostgreSQL</b>. Live, anonymised and blank-named
/// participants resolve by the one display-name rule; a soft-deleted membership resolves to the
/// placeholder; and a locked identity with no live participant reports the placeholder on the sheet
/// rather than the empty name the old projection substituted.
/// <para><b>Validates: Requirements 10.7, 13.2.</b></para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class TeamSheetDisplayNameIntegrationTests
{
    private static MatchListSourceHarness? _shared;

    private readonly MatchListSourceHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    public TeamSheetDisplayNameIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _harness = _shared ??= new MatchListSourceHarness(fixture, "team_sheet_names");
    }

    [Fact]
    public async Task LiveAndAnonymisedParticipants_ResolveByTheRule()
    {
        // Every member plays; the last two are anonymised afterwards.
        SeededMatchListDataset.SquadData squad = await SeedRolledAsync(anonymised: 2);
        Match match = squad.Matches[0];

        IReadOnlyDictionary<Guid, string> names = await _harness.ListRosterNamesAsync(match.Id);

        Assert.Equal(match.Participants.Count, names.Count);
        foreach (MatchParticipant participant in match.Participants)
        {
            Assert.Equal(WorkingTeamsReferenceOracle.DisplayNameOf(squad, match, participant.SquadMembershipId), names[participant.SquadMembershipId]);
        }

        Assert.Equal(2, names.Values.Count(static name => name == SquadMembership.DisplayNamePlaceholder));
    }

    [Fact]
    public async Task BlankCapturedName_ResolvesToThePlaceholder()
    {
        SeededMatchListDataset.SquadData squad = await SeedRolledAsync(anonymised: 0);
        Match match = squad.Matches[0];
        Guid blanked = match.Participants.First().SquadMembershipId;

        await _harness.PlantCapturedDisplayNameAsync(match.Id, blanked, "   ");

        Assert.Equal(SquadMembership.DisplayNamePlaceholder, (await _harness.ListRosterNamesAsync(match.Id))[blanked]);
    }

    [Fact]
    public async Task SoftDeletedMembership_ResolvesToThePlaceholder()
    {
        SeededMatchListDataset.SquadData squad = await SeedRolledAsync(anonymised: 0);
        Match match = squad.Matches[0];
        Guid removed = match.Participants.Last().SquadMembershipId;

        await _harness.SoftDeleteMembershipAsync(removed);

        Assert.Equal(SquadMembership.DisplayNamePlaceholder, (await _harness.ListRosterNamesAsync(match.Id))[removed]);
    }

    [Fact]
    public async Task LockedIdentityWithNoLiveParticipant_ReportsThePlaceholderOnTheSheet_NotAnEmptyName()
    {
        SeededMatchListDataset.SquadData squad = await SeedRolledAsync(anonymised: 0);
        Match match = squad.Matches[0];
        Guid orphaned = match.KickoffLineup!.Teams[0].ParticipantMembershipIds[0];

        await _harness.PlantDeletedParticipantAsync(match.Id, orphaned);
        Result<TeamSheet> sheet = await _harness.GetTeamSheetAsync(squad.Organiser.UserId!.Value, match.Id);

        Assert.True(sheet.IsSuccess, sheet.Error?.Message);
        Assert.False((await _harness.ListRosterNamesAsync(match.Id)).ContainsKey(orphaned));
        RosterEntry entry = sheet.Value!.Teams[0].Roster.Single(e => e.SquadMembershipId == orphaned);
        Assert.Equal(SquadMembership.DisplayNamePlaceholder, entry.DisplayName);
        TeamSheetReferenceOracle.AssertProjects(squad, match, sheet.Value, new HashSet<Guid> { orphaned });
    }

    private Task<SeededMatchListDataset.SquadData> SeedRolledAsync(int anonymised) =>
        _harness.SeedSquadAsync(new MatchListDatasetSpec.SquadSpec(
            MemberCount: 10,
            AnonymisedCount: anonymised,
            Matches: [new MatchListDatasetSpec.MatchSpec(MatchState.TeamsRolled, [3], ParticipantCount: 10)]));
}
