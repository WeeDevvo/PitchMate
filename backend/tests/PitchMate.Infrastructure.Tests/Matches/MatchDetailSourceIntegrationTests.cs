using PitchMate.Application.Matches.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Matches.Queries;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Integration tests for <see cref="EfMatchDetailSource"/> (match-read-models task 10.6), run against
/// <b>real PostgreSQL</b> with the production migrations applied. Docker is required.
/// <para>
/// Each case pins one behaviour that lives in SQL: the inner join that hides a match in a squad inside
/// its deletion grace period, the left joins that keep a participant-less match's header, the explicit
/// soft-delete filters, the roster-position order, and the <c>CASE</c> that is the SQL form of the
/// display-name rule. Every expectation comes from <see cref="MatchDetailReferenceOracle"/>.
/// </para>
/// <para>
/// <b>Validates: Requirements 2.4, 2.13, 5.10, 13.2.</b>
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class MatchDetailSourceIntegrationTests
{
    /// <summary>One lazily migrated database for the class, held static across xUnit's per-test instances.</summary>
    private static MatchListSourceHarness? _shared;

    private readonly MatchListSourceHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    public MatchDetailSourceIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _harness = _shared ??= new MatchListSourceHarness(fixture, "match_detail_source");
    }

    [Fact]
    public async Task PopulatedMatch_ProjectsEveryMemberWithParticipantsInRosterOrder()
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(new MatchListDatasetSpec.SquadSpec(
            MemberCount: 14,
            GuestCount: 2,
            Matches: [new MatchListDatasetSpec.MatchSpec(MatchState.Completed, [9, 4], ParticipantCount: 12, GuestParticipantCount: 2)]));
        Match match = squad.Matches[0];

        MatchDetailProjection? detail = await _harness.FindDetailAsync(match.Id);

        MatchDetailReferenceOracle.AssertAgrees(MatchDetailReferenceOracle.Projection(squad, match), detail);
        Assert.Equal(12, detail!.Participants.Count);
        Assert.Equal(2, detail.Participants.Count(static participant => participant.IsGuest));
        Assert.NotNull(detail.RecordedResult);
        Assert.NotNull(detail.CompletedAt);
    }

    [Fact]
    public async Task MatchWithNoParticipants_StillReturnsItsHeader()
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(new MatchListDatasetSpec.SquadSpec(
            MemberCount: 4,
            Matches: [new MatchListDatasetSpec.MatchSpec(MatchState.GatheringAvailability, [5, 2, 8])]));
        Match match = squad.Matches[0];

        MatchDetailProjection? detail = await _harness.FindDetailAsync(match.Id);

        MatchDetailReferenceOracle.AssertAgrees(MatchDetailReferenceOracle.Projection(squad, match), detail);
        Assert.Empty(detail!.Participants);
        Assert.Equal(3, detail.CandidateDays.Count);
    }

    [Fact]
    public async Task MatchInASoftDeletedSquad_IsNotVisible()
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(new MatchListDatasetSpec.SquadSpec(
            MemberCount: 4,
            Matches: [new MatchListDatasetSpec.MatchSpec(MatchState.Confirmed, [3], ParticipantCount: 2)],
            SoftDeleteSquad: true));

        Assert.Null(await _harness.FindDetailAsync(squad.Matches[0].Id));
    }

    [Fact]
    public async Task SoftDeletedMatch_IsNotVisible()
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(new MatchListDatasetSpec.SquadSpec(
            MemberCount: 4,
            Matches: [new MatchListDatasetSpec.MatchSpec(MatchState.Confirmed, [3], ParticipantCount: 2, SoftDeleted: true)]));

        Assert.Null(await _harness.FindDetailAsync(squad.Matches[0].Id));
    }

    [Fact]
    public async Task AbsentMatch_IsNotVisible() =>
        Assert.Null(await _harness.FindDetailAsync(Guid.CreateVersion7()));

    [Fact]
    public async Task InterleavedSquads_EachMatchReportsItsOwnSquadAndPool()
    {
        SeededMatchListDataset seeded = await _harness.SeedAsync(new MatchListDatasetSpec(
        [
            new MatchListDatasetSpec.SquadSpec(12, [Confirmed([2], 4), Rolled([6], 10)]),
            new MatchListDatasetSpec.SquadSpec(12, [Confirmed([1], 3), Confirmed([4], 5), Rolled([8], 11)]),
        ]));

        foreach (SeededMatchListDataset.SquadData squad in seeded.Squads)
        {
            foreach (Match match in squad.Matches)
            {
                MatchDetailProjection? detail = await _harness.FindDetailAsync(match.Id);

                MatchDetailReferenceOracle.AssertAgrees(MatchDetailReferenceOracle.Projection(squad, match), detail);
                Assert.Equal(squad.SquadId, detail!.SquadId);
            }
        }
    }

    [Fact]
    public async Task AnonymisedParticipants_ReportThePlaceholderAndKeepTheirCapturedGuestFlag()
    {
        // Every member plays and the last two are anonymised afterwards.
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(new MatchListDatasetSpec.SquadSpec(
            MemberCount: 10,
            Matches: [Rolled([5], 10)],
            AnonymisedCount: 2));
        Match match = squad.Matches[0];

        MatchDetailProjection? detail = await _harness.FindDetailAsync(match.Id);

        MatchDetailReferenceOracle.AssertAgrees(MatchDetailReferenceOracle.Projection(squad, match), detail);
        List<ParticipantViewOf> anonymised =
        [
            .. detail!.Participants
                .Where(participant => squad.MembershipById(participant.SquadMembershipId).DisplayNameNormalized is null)
                .Select(static participant => new ParticipantViewOf(participant.DisplayName, participant.IsGuest)),
        ];

        Assert.Equal(2, anonymised.Count);
        Assert.All(anonymised, static view =>
        {
            Assert.Equal(SquadMembership.DisplayNamePlaceholder, view.DisplayName);
            Assert.False(view.IsGuest);
        });
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t\n")]
    public async Task BlankCapturedName_ReportsThePlaceholder(string blank)
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(new MatchListDatasetSpec.SquadSpec(
            MemberCount: 4,
            Matches: [Confirmed([3], 3)]));
        Match match = squad.Matches[0];
        Guid blanked = match.Participants.First().SquadMembershipId;

        await _harness.PlantCapturedDisplayNameAsync(match.Id, blanked, blank);
        MatchDetailProjection? detail = await _harness.FindDetailAsync(match.Id);

        Assert.NotNull(detail);
        Assert.Equal(
            ParticipantDisplayName.Resolve(blank, membershipResolved: true, isAnonymised: false),
            detail!.Participants.Single(participant => participant.SquadMembershipId == blanked).DisplayName);
        Assert.Equal(SquadMembership.DisplayNamePlaceholder, detail.Participants.Single(participant => participant.SquadMembershipId == blanked).DisplayName);
    }

    [Fact]
    public async Task RosterPositionsWithGaps_StillOrderAscending()
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(new MatchListDatasetSpec.SquadSpec(
            MemberCount: 9,
            Matches: [new MatchListDatasetSpec.MatchSpec(MatchState.Confirmed, [3], ParticipantCount: 5, RemovedParticipantCount: 2)]));
        Match match = squad.Matches[0];

        MatchDetailProjection? detail = await _harness.FindDetailAsync(match.Id);

        MatchDetailReferenceOracle.AssertAgrees(MatchDetailReferenceOracle.Projection(squad, match), detail);
        List<int> positions = [.. detail!.Participants.Select(static participant => participant.RosterPosition)];
        Assert.Equal(positions.Order(), positions);
        Assert.True(positions[^1] - positions[0] + 1 > positions.Count, $"Expected gaps in {string.Join(",", positions)}.");
    }

    private static MatchListDatasetSpec.MatchSpec Confirmed(int[] days, int participants) =>
        new(MatchState.Confirmed, days, ParticipantCount: participants);

    private static MatchListDatasetSpec.MatchSpec Rolled(int[] days, int participants) =>
        new(MatchState.TeamsRolled, days, ParticipantCount: participants);

    private readonly record struct ParticipantViewOf(string DisplayName, bool IsGuest);
}
