using PitchMate.Application.Common;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.LiveTracking;
using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.LiveTracking;
// PitchMate.Domain.Matches, PitchMate.Domain.Squads, and PitchMate.Domain.LiveTracking each define a
// Result/Result<T> triad. Import only PitchMate.Domain.LiveTracking above so the unqualified
// Result<BatchResult> the harness returns binds to the live-tracking triad, and pull in the specific
// Match/Squad types by alias.
using Match = PitchMate.Domain.Matches.Match;
using MatchState = PitchMate.Domain.Matches.MatchState;
using MatchResult = PitchMate.Domain.Matches.MatchResult;
using ProposedTeam = PitchMate.Domain.Matches.ProposedTeam;
using ResultFidelity = PitchMate.Domain.Matches.ResultFidelity;
using TeamScore = PitchMate.Domain.Matches.TeamScore;
using Squad = PitchMate.Domain.Squads.Squad;
using SquadFeature = PitchMate.Domain.Squads.SquadFeature;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;
using BatchResult = PitchMate.Domain.LiveTracking.BatchResult;

namespace PitchMate.Application.Tests.LiveTracking;

/// <summary>
/// The role an acting user holds in the match's squad, used by the harness to select which
/// pre-created membership (or none) a recording request acts as.
/// </summary>
internal enum ActorRole
{
    /// <summary>An active registered owner — permitted to record.</summary>
    Owner,

    /// <summary>An active registered admin — permitted to record.</summary>
    Admin,

    /// <summary>An active registered plain member — not permitted.</summary>
    Member,

    /// <summary>A once-admin membership that is now inactive — not permitted.</summary>
    InactiveAdmin,

    /// <summary>A user who holds no membership in the match's squad — not permitted.</summary>
    NonMember,
}

/// <summary>
/// A hand-written, in-memory harness for <see cref="RecordEventBatchHandler"/> that assembles the real
/// handler over real fakes — a single squad-scoped match staged in a chosen <see cref="MatchState"/>
/// with the <c>LiveMatchTracking</c> flag on or off, an append-only event store, a membership set
/// spanning every <see cref="ActorRole"/>, a squad repository, a save-counting unit of work, and a
/// mutable current-user accessor. It walks the match aggregate through its real lifecycle so the
/// kickoff lineup, working teams, and participants are genuine, and exposes the team and roster
/// identities so tests can build valid or invalid submissions. No database and no mocking framework.
/// </summary>
internal sealed class RecordEventBatchWorld
{
    private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset MatchDay = Anchor.AddDays(7);

    private readonly Dictionary<ActorRole, Guid> _actorUserIds;

    private RecordEventBatchWorld(
        RecordEventBatchHandler handler,
        Match match,
        Guid squadId,
        InMemoryMatchEventRepository events,
        CountingUnitOfWork unitOfWork,
        MutableCurrentUserAccessor currentUser,
        Dictionary<ActorRole, Guid> actorUserIds,
        IReadOnlyList<Guid> teamAroster,
        IReadOnlyList<Guid> teamBroster,
        Guid teamAId,
        Guid teamBId)
    {
        Handler = handler;
        Match = match;
        SquadId = squadId;
        Events = events;
        UnitOfWork = unitOfWork;
        CurrentUser = currentUser;
        _actorUserIds = actorUserIds;
        TeamARoster = teamAroster;
        TeamBRoster = teamBroster;
        TeamAId = teamAId;
        TeamBId = teamBId;
    }

    public RecordEventBatchHandler Handler { get; }

    public Match Match { get; }

    public Guid SquadId { get; }

    public InMemoryMatchEventRepository Events { get; }

    public CountingUnitOfWork UnitOfWork { get; }

    public MutableCurrentUserAccessor CurrentUser { get; }

    /// <summary>The working <c>MatchTeam.Id</c> of the first team; the target of most generated goals.</summary>
    public Guid TeamAId { get; }

    /// <summary>The working <c>MatchTeam.Id</c> of the second team.</summary>
    public Guid TeamBId { get; }

    /// <summary>The ordered participant membership ids on the first team.</summary>
    public IReadOnlyList<Guid> TeamARoster { get; }

    /// <summary>The ordered participant membership ids on the second team.</summary>
    public IReadOnlyList<Guid> TeamBRoster { get; }

    /// <summary>The backing user id of the acting owner (the default authorised actor).</summary>
    public Guid OwnerUserId => _actorUserIds[ActorRole.Owner];

    /// <summary>Resolves the backing user id for <paramref name="role"/>, or a fresh non-member id.</summary>
    public Guid UserIdFor(ActorRole role) =>
        role == ActorRole.NonMember ? Guid.NewGuid() : _actorUserIds[role];

    /// <summary>
    /// Builds a world with a match in <paramref name="state"/> and the squad flag set per
    /// <paramref name="liveTrackingEnabled"/>. The match carries <paramref name="playerCount"/>
    /// participants (default 10) split into two teams of <paramref name="teamASize"/> (default 5) and
    /// the remainder, both within the 5..8 lock rule.
    /// </summary>
    public static RecordEventBatchWorld Build(
        MatchState state,
        bool liveTrackingEnabled = true,
        int playerCount = 10,
        int teamASize = 5)
    {
        Squad squad = Squad.Create("The Squad").Value!;
        if (liveTrackingEnabled)
        {
            squad.SetFeature(SquadFeature.LiveMatchTracking, enabled: true);
        }

        Guid squadId = squad.Id;

        // Authorisation actors spanning every role the gate distinguishes.
        var actorUserIds = new Dictionary<ActorRole, Guid>();
        var authMemberships = new List<SquadMembership>();

        Guid ownerUserId = Guid.NewGuid();
        SquadMembership owner = SquadMembership.CreateOwner(squadId, ownerUserId, "Owner").Value!;
        actorUserIds[ActorRole.Owner] = ownerUserId;
        authMemberships.Add(owner);

        Guid adminUserId = Guid.NewGuid();
        SquadMembership admin = SquadMembership.CreateRegistered(squadId, adminUserId, "Admin").Value!;
        admin.PromoteToAdmin();
        actorUserIds[ActorRole.Admin] = adminUserId;
        authMemberships.Add(admin);

        Guid memberUserId = Guid.NewGuid();
        SquadMembership member = SquadMembership.CreateRegistered(squadId, memberUserId, "Member").Value!;
        actorUserIds[ActorRole.Member] = memberUserId;
        authMemberships.Add(member);

        Guid inactiveUserId = Guid.NewGuid();
        SquadMembership inactiveAdmin = SquadMembership.CreateRegistered(squadId, inactiveUserId, "Formerly Admin").Value!;
        inactiveAdmin.PromoteToAdmin();
        inactiveAdmin.Deactivate();
        actorUserIds[ActorRole.InactiveAdmin] = inactiveUserId;
        authMemberships.Add(inactiveAdmin);

        // Player memberships that populate the match's playing pool.
        var players = new List<SquadMembership>(playerCount);
        for (var i = 0; i < playerCount; i++)
        {
            players.Add(SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {i + 1}").Value!);
        }

        Match match = Match.CreateDraft(Guid.CreateVersion7(), squadId, "Hackney Marshes", [MatchDay], Anchor).Value!;

        IReadOnlyList<Guid> teamAroster = [];
        IReadOnlyList<Guid> teamBroster = [];
        Guid teamAId = Guid.Empty;
        Guid teamBId = Guid.Empty;

        if (state != MatchState.GatheringAvailability)
        {
            match.Confirm(MatchDay, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);
            foreach (SquadMembership player in players)
            {
                match.AddParticipant(player);
            }

            if (state != MatchState.Confirmed)
            {
                var participantIds = players.Select(p => p.Id).ToList();
                teamAroster = participantIds.Take(teamASize).ToList();
                teamBroster = participantIds.Skip(teamASize).ToList();

                var proposal = new List<ProposedTeam>
                {
                    new("Reds", BibFlag: true, teamAroster),
                    new("Blues", BibFlag: false, teamBroster),
                };
                match.ApplyTeamProposal(proposal);
                match.Lock();

                teamAId = match.Teams.ElementAt(0).Id;
                teamBId = match.Teams.ElementAt(1).Id;

                switch (state)
                {
                    case MatchState.TeamsRolled:
                        break;

                    case MatchState.Cancelled:
                        match.Cancel();
                        break;

                    default:
                        match.Start();
                        if (state == MatchState.Completed)
                        {
                            var result = new MatchResult(ResultFidelity.Basic, new[]
                            {
                                new TeamScore(teamAId, 1),
                                new TeamScore(teamBId, 0),
                            });
                            match.RecordResult(result, liveTrackingEnabled: true);
                            match.Complete(Anchor.AddHours(2));
                        }

                        break;
                }
            }
        }

        var events = new InMemoryMatchEventRepository();
        var matches = new SingleMatchRepository(match);
        var memberships = new ConfiguredMembershipRepository(authMemberships);
        var squads = new SingleSquadRepository(squad);
        var unitOfWork = new CountingUnitOfWork();
        var currentUser = new MutableCurrentUserAccessor { CurrentUserId = ownerUserId.ToString() };

        var handler = new RecordEventBatchHandler(matches, memberships, squads, events, unitOfWork, currentUser);

        return new RecordEventBatchWorld(
            handler, match, squadId, events, unitOfWork, currentUser, actorUserIds,
            teamAroster, teamBroster, teamAId, teamBId);
    }

    /// <summary>Runs the handler as <paramref name="role"/> against the world's match.</summary>
    public Result<BatchResult> Record(ActorRole role, params EventSubmission[] events) =>
        RecordAs(UserIdFor(role), Match.Id, events);

    /// <summary>Runs the handler as the acting owner against the world's match.</summary>
    public Result<BatchResult> Record(params EventSubmission[] events) =>
        RecordAs(OwnerUserId, Match.Id, events);

    /// <summary>Runs the handler as <paramref name="actingUserId"/> against <paramref name="matchId"/>.</summary>
    public Result<BatchResult> RecordAs(Guid actingUserId, Guid matchId, params EventSubmission[] events)
    {
        CurrentUser.CurrentUserId = actingUserId == Guid.Empty ? null : actingUserId.ToString();
        return Handler
            .HandleAsync(new RecordEventBatchCommand(matchId, events), CancellationToken.None)
            .GetAwaiter()
            .GetResult();
    }

    /// <summary>A valid goal submission for the first team with a fresh GUID v7 id and the given minute/scorer.</summary>
    public EventSubmission ValidGoal(int minute = 10, Guid? scorer = null, bool ownGoal = false) =>
        new(Guid.CreateVersion7(), EventKind.GoalScored, minute, ScoringTeamId: TeamAId, ScorerMembershipId: scorer, OwnGoal: ownGoal);
}
