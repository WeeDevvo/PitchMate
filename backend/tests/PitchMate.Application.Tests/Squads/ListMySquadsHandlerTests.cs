using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;
using MatchState = PitchMate.Domain.Matches.MatchState;
using PlayerResult = PitchMate.Domain.Stats.PlayerResult;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Example tests for the squad card facts on <see cref="ListMySquadsHandler"/>: each squad's card is
/// read for the caller's own membership in it, and the player count, next match and recent form are
/// returned as the source reports them. Which squads are listed is
/// <c>SquadReadProperties.Property33</c>'s; the facts themselves are tested against PostgreSQL in
/// <c>SquadCardSourceIntegrationTests</c>.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class ListMySquadsHandlerTests
{
    [Fact]
    public async Task ReadsEachCardForTheCallersMembership_AndReturnsItsFacts()
    {
        var store = new SquadStore();
        Guid userId = Guid.NewGuid();
        Squad squad = Squad.Create("Thursday Ballers").Value!;
        store.AddCommittedSquad(squad, softDeleted: false);
        SquadMembership membership = SquadMembership.CreateRegistered(squad.Id, userId, "Conor").Value!;
        store.AddCommittedMembership(membership);

        var scheduledAt = new DateTimeOffset(2026, 11, 9, 10, 0, 0, TimeSpan.Zero);
        var matchId = Guid.CreateVersion7();
        var cards = new FakeSquadCardSource();
        cards.Seed(squad.Id, new SquadCardFacts(
            14,
            new UpcomingMatchFacts(matchId, MatchState.TeamsRolled, scheduledAt, "Hackney Marshes", 3),
            [PlayerResult.Win, PlayerResult.Draw, PlayerResult.Loss]));

        var handler = new ListMySquadsHandler(
            new FakeSquadRepository(store),
            new FakeSquadMembershipRepository(store),
            cards);

        var result = await handler.HandleAsync(new ListMySquadsCommand(userId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        MySquadSummary summary = Assert.Single(result.Value!);
        Assert.Equal(14, summary.PlayerCount);
        Assert.Equal(
            new MySquadNextMatch(matchId, MatchState.TeamsRolled, scheduledAt, "Hackney Marshes", 3),
            summary.NextMatch);
        Assert.Equal([PlayerResult.Win, PlayerResult.Draw, PlayerResult.Loss], summary.RecentForm);
        Assert.Equal([(squad.Id, (Guid?)membership.Id)], cards.Reads);
    }

    [Fact]
    public async Task ASquadWithNoOpenMatch_HasNoNextMatch()
    {
        var store = new SquadStore();
        Guid userId = Guid.NewGuid();
        Squad squad = Squad.Create("Uni Old Boys").Value!;
        store.AddCommittedSquad(squad, softDeleted: false);
        store.AddCommittedMembership(SquadMembership.CreateRegistered(squad.Id, userId, "Conor").Value!);

        var handler = new ListMySquadsHandler(
            new FakeSquadRepository(store),
            new FakeSquadMembershipRepository(store),
            new FakeSquadCardSource());

        var result = await handler.HandleAsync(new ListMySquadsCommand(userId), CancellationToken.None);

        MySquadSummary summary = Assert.Single(result.Value!);
        Assert.Null(summary.NextMatch);
        Assert.Empty(summary.RecentForm);
    }
}
