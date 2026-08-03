using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using ProposeResult = PitchMate.Domain.Matches.Result<PitchMate.Application.Matches.Abstractions.TeamProposal>;
using AdjustResult = PitchMate.Domain.Matches.Result;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Unit tests for the team-rolling handlers' delegation to the balancer and the silly-name generator
/// (task 16.2, Requirements 8.1, 8.4). They drive the real <see cref="ProposeTeamsHandler"/> and
/// <see cref="AdjustTeamsHandler"/> against in-memory fakes — a match seeded in
/// <see cref="MatchState.Confirmed"/> or locked into <see cref="MatchState.TeamsRolled"/>, a
/// membership repository supplying the acting owner and the participants, ratings supplied so no
/// cold-start seeding is needed, a recording balancer, and a recording silly-name generator — and
/// assert two things:
/// <list type="bullet">
///   <item><see cref="ProposeTeamsHandler"/> invokes <see cref="ITeamBalancer.ProposeAsync"/> exactly
///   once and returns its proposal while leaving the match's lifecycle state unchanged
///   (Requirement 8.1);</item>
///   <item>renaming a team draws a generated name from <see cref="ISillyNameGenerator"/> only when the
///   admin supplies none — a supplied name is used verbatim and the generator is never consulted
///   (Requirement 8.4).</item>
/// </list>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class TeamRollingHandlerTests
{
    /// <summary>A fixed UTC anchor the match is drafted against; the single candidate/confirmed day sits after it.</summary>
    private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>The single, valid, strictly-future confirmed day.</summary>
    private static readonly DateTimeOffset ConfirmedDay = Anchor.AddDays(7);

    private const string Location = "Hackney Marshes, Pitch 12";

    // Requirement 8.1: proposing teams for a Confirmed match delegates to the balancer exactly once,
    // returns the balancer's proposal, and does not change the match's lifecycle state or working teams.
    [Fact]
    public async Task ProposeTeams_Confirmed_InvokesBalancerOnce_AndLeavesStateUnchanged()
    {
        Harness h = Harness.Confirmed(participantCount: 10);

        ProposeResult result = await h.ProposeHandler.HandleAsync(
            new ProposeTeamsCommand(h.OwnerUserId, h.MatchId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        // The balancer was consulted exactly once and its proposal was returned as produced.
        Assert.Equal(1, h.Balancer.CallCount);
        Assert.Equal(2, result.Value!.Teams.Count);
        Assert.Equal(0.0, result.Value!.DrawProbability);

        // A proposal is side-effect-free: the match stays Confirmed with no working teams captured.
        Assert.Equal(MatchState.Confirmed, h.Match.State);
        Assert.Empty(h.Match.Teams);
        Assert.Null(h.Match.KickoffLineup);
    }

    // Requirement 8.1: proposing teams for an already-rolled (TeamsRolled) match delegates to the
    // balancer exactly once and leaves the locked state and captured kickoff lineup untouched.
    [Fact]
    public async Task ProposeTeams_TeamsRolled_InvokesBalancerOnce_AndLeavesStateUnchanged()
    {
        Harness h = Harness.TeamsRolled(participantCount: 10);
        KickoffLineup lineupBefore = h.Match.KickoffLineup!;

        ProposeResult result = await h.ProposeHandler.HandleAsync(
            new ProposeTeamsCommand(h.OwnerUserId, h.MatchId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, h.Balancer.CallCount);

        // The match remains locked and the captured kickoff lineup is the very same instance.
        Assert.Equal(MatchState.TeamsRolled, h.Match.State);
        Assert.Same(lineupBefore, h.Match.KickoffLineup);
    }

    // Requirement 8.4: when the admin supplies a team name, it is applied verbatim and the silly-name
    // generator is never consulted.
    [Fact]
    public async Task AdjustTeams_SetTeamName_WithSuppliedName_DoesNotInvokeSillyGenerator()
    {
        Harness h = Harness.WithWorkingTeams(participantCount: 10);
        Guid teamId = h.Match.Teams.First().Id;
        const string supplied = "Custom Warriors";

        AdjustResult result = await h.AdjustHandler.HandleAsync(
            new AdjustTeamsCommand(h.OwnerUserId, h.MatchId, new TeamAdjustment.SetTeamName(teamId, supplied)),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(0, h.SillyNames.CallCount);
        Assert.Equal(supplied, h.Match.Teams.First(t => t.Id == teamId).TeamName);
        Assert.Equal(1, h.UnitOfWork.SaveCallCount);
    }

    // Requirement 8.4: when the admin supplies no name (null or blank), a generated name is drawn from
    // the silly-name generator exactly once and applied to the team.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task AdjustTeams_SetTeamName_WithNoName_DrawsFromSillyGenerator(string? supplied)
    {
        Harness h = Harness.WithWorkingTeams(participantCount: 10);
        Guid teamId = h.Match.Teams.First().Id;

        AdjustResult result = await h.AdjustHandler.HandleAsync(
            new AdjustTeamsCommand(h.OwnerUserId, h.MatchId, new TeamAdjustment.SetTeamName(teamId, supplied)),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        // The generator was consulted exactly once and its output is the applied name.
        Assert.Equal(1, h.SillyNames.CallCount);
        Assert.Equal("Generated Silly Name 1", h.Match.Teams.First(t => t.Id == teamId).TeamName);
        Assert.Equal(1, h.UnitOfWork.SaveCallCount);
    }

    /// <summary>
    /// Wires the two team-rolling handlers to in-memory fakes over a single match: an active owner (so
    /// the organiser gate passes), a given number of registered participants each with a supplied
    /// rating, a recording balancer, a recording silly-name generator, and a save-counting unit of work.
    /// The factory methods stage the match in the state a test needs.
    /// </summary>
    private sealed class Harness
    {
        public required ProposeTeamsHandler ProposeHandler { get; init; }
        public required AdjustTeamsHandler AdjustHandler { get; init; }
        public required Match Match { get; init; }
        public required RecordingTeamBalancer Balancer { get; init; }
        public required RecordingSillyNameGenerator SillyNames { get; init; }
        public required TeamRollingUnitOfWork UnitOfWork { get; init; }
        public required Guid MatchId { get; init; }
        public required Guid OwnerUserId { get; init; }

        /// <summary>Builds a harness whose match is Confirmed with the given number of participants and no working teams.</summary>
        public static Harness Confirmed(int participantCount) => Build(participantCount, roll: false, locked: false);

        /// <summary>Builds a harness whose match has working teams applied (still editable, state Confirmed).</summary>
        public static Harness WithWorkingTeams(int participantCount) => Build(participantCount, roll: true, locked: false);

        /// <summary>Builds a harness whose match is locked into TeamsRolled with a captured kickoff lineup.</summary>
        public static Harness TeamsRolled(int participantCount) => Build(participantCount, roll: true, locked: true);

        private static Harness Build(int participantCount, bool roll, bool locked)
        {
            Guid squadId = Guid.NewGuid();
            Guid ownerUserId = Guid.NewGuid();

            // The acting owner: an active registered organiser of the squad, so RequireOrganiser passes.
            SquadMembership owner = SquadMembership.CreateOwner(squadId, ownerUserId, "Owner").Value!;

            // A Confirmed match seeded with an empty pool, then filled with the requested participants.
            Match match = Match.CreateDraft(Guid.CreateVersion7(), squadId, Location, [ConfirmedDay], Anchor).Value!;
            match.Confirm(ConfirmedDay, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);

            var members = new List<SquadMembership> { owner };
            var participantIds = new List<Guid>(participantCount);
            for (int i = 0; i < participantCount; i++)
            {
                SquadMembership member =
                    SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {i + 1}").Value!;
                match.AddParticipant(member);
                members.Add(member);
                participantIds.Add(member.Id);
            }

            if (roll)
            {
                int half = participantIds.Count / 2;
                var teams = new List<ProposedTeam>
                {
                    new("Reds", BibFlag: true, participantIds.Take(half).ToList()),
                    new("Blues", BibFlag: false, participantIds.Skip(half).ToList()),
                };
                match.ApplyTeamProposal(teams);

                if (locked)
                {
                    match.Lock();
                }
            }

            var balancer = new RecordingTeamBalancer();
            var sillyNames = new RecordingSillyNameGenerator();
            var unitOfWork = new TeamRollingUnitOfWork();
            var matches = new TeamRollingMatchRepository(match);
            var memberships = new TeamRollingMembershipRepository(members.ToArray());
            var ratings = new TeamRollingRatingRepository();
            var ratingEngine = new UnusedRatingEngine();

            var proposeHandler = new ProposeTeamsHandler(matches, memberships, ratings, ratingEngine, balancer);
            var adjustHandler = new AdjustTeamsHandler(
                matches, memberships, ratings, ratingEngine, balancer, sillyNames, unitOfWork);

            return new Harness
            {
                ProposeHandler = proposeHandler,
                AdjustHandler = adjustHandler,
                Match = match,
                Balancer = balancer,
                SillyNames = sillyNames,
                UnitOfWork = unitOfWork,
                MatchId = match.Id,
                OwnerUserId = ownerUserId,
            };
        }
    }
}
