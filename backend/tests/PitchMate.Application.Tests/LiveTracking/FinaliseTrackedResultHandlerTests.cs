using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using PitchMate.Application.Common;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.LiveTracking;
using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Application.Notifications;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.LiveTracking;
// PitchMate.Domain.Matches, PitchMate.Domain.Rating, PitchMate.Domain.Squads and
// PitchMate.Domain.LiveTracking each define their own Result/Result<T> triad. Import only
// PitchMate.Domain.LiveTracking above so the unqualified Result<FinaliseTrackedResultResult> the
// handler returns binds to the live-tracking triad, and pull in the specific match-lifecycle, rating
// and squad types by alias (mirroring the handler under test and the sibling completion fakes).
using MembershipRating = PitchMate.Domain.Matches.MembershipRating;
using RatingSnapshot = PitchMate.Domain.Matches.RatingSnapshot;
using Match = PitchMate.Domain.Matches.Match;
using MatchState = PitchMate.Domain.Matches.MatchState;
using MatchResult = PitchMate.Domain.Matches.MatchResult;
using ProposedTeam = PitchMate.Domain.Matches.ProposedTeam;
using ResultFidelity = PitchMate.Domain.Matches.ResultFidelity;
using TeamScore = PitchMate.Domain.Matches.TeamScore;
using Squad = PitchMate.Domain.Squads.Squad;
using SquadFeature = PitchMate.Domain.Squads.SquadFeature;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;
using MembershipState = PitchMate.Domain.Squads.MembershipState;
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using SkillTier = PitchMate.Domain.Rating.SkillTier;
using RatingState = PitchMate.Domain.Rating.RatingState;
using RatingMatchOutcome = PitchMate.Domain.Rating.MatchOutcome;
using RatingMatchUpdate = PitchMate.Domain.Rating.MatchUpdate;
using ReplayMatch = PitchMate.Domain.Rating.ReplayMatch;
using MatchPrediction = PitchMate.Domain.Rating.MatchPrediction;
using TeamRoster = PitchMate.Domain.Rating.TeamRoster;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using NotificationType = PitchMate.Domain.Notifications.NotificationType;
using NotifResult = PitchMate.Domain.Notifications.Result;

namespace PitchMate.Application.Tests.LiveTracking;

/// <summary>
/// Example-based success- and failure-path tests for <see cref="FinaliseTrackedResultHandler"/>, plus
/// the exactly-one-rating-update assertion that is the core of task 9.3 (Requirements 8.3, 8.4).
/// <para>
/// The handler under test delegates completion to the real match-lifecycle
/// <see cref="CompleteMatchHandler"/>, which owns the single, idempotent rating update. Rather than
/// mock that collaborator, these tests drive the <em>real</em> completion handler over hand-written
/// in-memory fakes — a shared single-match repository, a membership set spanning every role, a
/// membership-rating repository, a snapshot repository, a counting <see cref="IRatingEngine"/>, a
/// save-counting unit of work, and a mutable current-user accessor — so the count of
/// <see cref="IRatingEngine.UpdateRatings"/> invocations directly proves the single update is neither
/// fragmented, duplicated, nor omitted. No database and no mocking framework, per the Application-layer
/// testing strategy.
/// </para>
/// </summary>
[Trait("Feature", "live-tracking")]
public class FinaliseTrackedResultHandlerTests
{
    /// <summary>The role an acting user holds in the match's squad.</summary>
    public enum Actor
    {
        /// <summary>An active registered owner — permitted to finalise.</summary>
        Owner,

        /// <summary>An active registered admin — permitted to finalise.</summary>
        Admin,

        /// <summary>An active registered plain member — not permitted.</summary>
        Member,

        /// <summary>A once-admin membership that is now inactive — not permitted.</summary>
        InactiveAdmin,

        /// <summary>A user who holds no membership in the match's squad — not permitted.</summary>
        NonMember,
    }

    // ---- Success path -----------------------------------------------------------------------------

    [Fact]
    public void FinalisingAnInProgressMatchRecordsTheRichResultAndDrivesCompletionOnce()
    {
        FinaliseWorld world = FinaliseWorld.Build(MatchState.InProgress);
        // Seed a running score of Team A 2, Team B 1 from the effective event log.
        world.SeedGoal(world.TeamAId, 5);
        world.SeedGoal(world.TeamAId, 40);
        world.SeedGoal(world.TeamBId, 22);

        Result<FinaliseTrackedResultResult> result = world.Finalise(world.AdminUserId);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value!.AlreadyCompleted);

        // Completion was driven exactly once: the single rating update and the atomic commit each ran once.
        Assert.Equal(MatchState.Completed, world.Match.State);
        Assert.Equal(1, world.Engine.UpdateRatingsCallCount);
        Assert.Equal(1, world.UnitOfWork.SaveCallCount);

        // The Rich result recorded on the aggregate mirrors the running score, one score per working team.
        Assert.Equal(ResultFidelity.Rich, world.Match.RecordedResult!.Fidelity);
        Assert.Equal(2, ScoreFor(result.Value!.TeamScores, world.TeamAId));
        Assert.Equal(1, ScoreFor(result.Value!.TeamScores, world.TeamBId));
        Assert.Equal(world.Match.Teams.Count, result.Value!.TeamScores.Count);
    }

    [Fact]
    public void FinalisingWithNoEventsRecordsAZeroZeroRichResult()
    {
        FinaliseWorld world = FinaliseWorld.Build(MatchState.InProgress);

        Result<FinaliseTrackedResultResult> result = world.Finalise(world.OwnerUserId);

        Assert.True(result.IsSuccess);
        Assert.Equal(ResultFidelity.Rich, world.Match.RecordedResult!.Fidelity);
        Assert.All(result.Value!.TeamScores, score => Assert.Equal(0, score.Score));
        Assert.Equal(1, world.Engine.UpdateRatingsCallCount);
    }

    // ---- Exactly-one-rating-update (Requirement 8.3) ----------------------------------------------

    [Fact]
    public void ASecondFinaliseAppliesNoFurtherRatingUpdate()
    {
        FinaliseWorld world = FinaliseWorld.Build(MatchState.InProgress);
        world.SeedGoal(world.TeamAId, 12);

        // First finalise completes the match and applies the single rating update.
        Result<FinaliseTrackedResultResult> first = world.Finalise(world.AdminUserId);
        Assert.True(first.IsSuccess);
        Assert.False(first.Value!.AlreadyCompleted);
        Assert.Equal(MatchState.Completed, world.Match.State);
        Assert.Equal(1, world.Engine.UpdateRatingsCallCount);
        Assert.Equal(1, world.UnitOfWork.SaveCallCount);

        // A second finalise on the now-completed match records nothing and drives no completion: the
        // rating update stays applied exactly once total across both finalises (Requirement 8.3, 8.4).
        Result<FinaliseTrackedResultResult> second = world.Finalise(world.AdminUserId);
        Assert.False(second.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.LogSealed, second.Error!.Code);

        Assert.Equal(1, world.Engine.UpdateRatingsCallCount);
        Assert.Equal(1, world.UnitOfWork.SaveCallCount);
    }

    // ---- State failure paths (Requirement 8.4) ----------------------------------------------------

    [Fact]
    public void FinalisingAnAlreadyCompletedMatchIsRejectedNamingTheRequiredStateAndAppliesNoUpdate()
    {
        FinaliseWorld world = FinaliseWorld.Build(MatchState.Completed);

        Result<FinaliseTrackedResultResult> result = world.Finalise(world.AdminUserId);

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.LogSealed, result.Error!.Code);
        Assert.Contains(MatchState.InProgress.ToString(), result.Error!.Message);
        Assert.Equal(0, world.Engine.UpdateRatingsCallCount);
    }

    [Fact]
    public void FinalisingACancelledMatchIsRejectedNamingTheRequiredStateAndRecordsNoResult()
    {
        FinaliseWorld world = FinaliseWorld.Build(MatchState.Cancelled);

        Result<FinaliseTrackedResultResult> result = world.Finalise(world.AdminUserId);

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.LogSealed, result.Error!.Code);
        Assert.Contains(MatchState.InProgress.ToString(), result.Error!.Message);
        Assert.Null(world.Match.RecordedResult);
        Assert.Equal(0, world.Engine.UpdateRatingsCallCount);
    }

    [Theory]
    [InlineData(MatchState.Confirmed)]
    [InlineData(MatchState.TeamsRolled)]
    public void FinalisingBeforePlayIsRejectedNamingTheRequiredStateAndRecordsNoResult(MatchState state)
    {
        FinaliseWorld world = FinaliseWorld.Build(state);

        Result<FinaliseTrackedResultResult> result = world.Finalise(world.AdminUserId);

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.MatchNotStarted, result.Error!.Code);
        Assert.Contains(MatchState.InProgress.ToString(), result.Error!.Message);
        Assert.Null(world.Match.RecordedResult);
        Assert.Equal(0, world.Engine.UpdateRatingsCallCount);
    }

    // ---- Authorisation failure paths (existence-concealing Unauthorized) --------------------------

    [Theory]
    [InlineData(Actor.Member)]
    [InlineData(Actor.InactiveAdmin)]
    [InlineData(Actor.NonMember)]
    public void FinalisingAsANonAdminYieldsTheUniformUnauthorizedAndRecordsNoResult(Actor actor)
    {
        FinaliseWorld world = FinaliseWorld.Build(MatchState.InProgress);

        Result<FinaliseTrackedResultResult> result = world.Finalise(world.UserIdFor(actor));

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.Unauthorized, result.Error!.Code);
        Assert.Null(world.Match.RecordedResult);
        Assert.Equal(0, world.Engine.UpdateRatingsCallCount);
        Assert.Equal(0, world.UnitOfWork.SaveCallCount);
    }

    [Fact]
    public void FinalisingAMissingMatchYieldsTheUniformUnauthorized()
    {
        FinaliseWorld world = FinaliseWorld.Build(MatchState.InProgress);

        Result<FinaliseTrackedResultResult> result = world.FinaliseMatch(world.AdminUserId, Guid.NewGuid());

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.Unauthorized, result.Error!.Code);
        Assert.Equal(0, world.Engine.UpdateRatingsCallCount);
    }

    [Fact]
    public void FinalisingWithNoAuthenticatedSubjectYieldsTheUniformUnauthorized()
    {
        FinaliseWorld world = FinaliseWorld.Build(MatchState.InProgress);

        Result<FinaliseTrackedResultResult> result = world.Finalise(Guid.Empty);

        Assert.False(result.IsSuccess);
        Assert.Equal(LiveTrackingErrorCode.Unauthorized, result.Error!.Code);
        Assert.Equal(0, world.Engine.UpdateRatingsCallCount);
    }

    private static int ScoreFor(IReadOnlyList<TeamScore> scores, Guid teamId) =>
        scores.Single(s => s.TeamId == teamId).Score;

    /// <summary>
    /// Assembles the <see cref="FinaliseTrackedResultHandler"/> wired over the <em>real</em>
    /// match-lifecycle <see cref="CompleteMatchHandler"/> and hand-written in-memory fakes, together
    /// with a squad-scoped match staged in a chosen <see cref="MatchState"/> and a membership set
    /// spanning every authorisation role. It walks the match aggregate through its genuine lifecycle so
    /// the kickoff lineup, working teams, and participants are real, and pre-seeds a current rating for
    /// every participant so completion reads an established rating rather than seeding one.
    /// </summary>
    internal sealed class FinaliseWorld
    {
        private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);
        private static readonly DateTimeOffset MatchDay = Anchor.AddDays(7);

        private readonly FinaliseTrackedResultHandler _handler;
        private readonly FakeMatchEventRepository _events;
        private readonly Dictionary<Actor, Guid> _actorUserIds;

        private FinaliseWorld(
            FinaliseTrackedResultHandler handler,
            Match match,
            Guid squadId,
            FakeMatchEventRepository events,
            CountingRatingEngine engine,
            CountingUnitOfWork unitOfWork,
            MutableCurrentUserAccessor currentUser,
            Dictionary<Actor, Guid> actorUserIds,
            Guid teamAId,
            Guid teamBId)
        {
            _handler = handler;
            Match = match;
            SquadId = squadId;
            _events = events;
            Engine = engine;
            UnitOfWork = unitOfWork;
            CurrentUser = currentUser;
            _actorUserIds = actorUserIds;
            TeamAId = teamAId;
            TeamBId = teamBId;
        }

        public Match Match { get; }

        public Guid SquadId { get; }

        internal CountingRatingEngine Engine { get; }

        internal CountingUnitOfWork UnitOfWork { get; }

        internal MutableCurrentUserAccessor CurrentUser { get; }

        /// <summary>The working <c>MatchTeam.Id</c> of the first team (empty before teams are rolled).</summary>
        public Guid TeamAId { get; }

        /// <summary>The working <c>MatchTeam.Id</c> of the second team (empty before teams are rolled).</summary>
        public Guid TeamBId { get; }

        public Guid OwnerUserId => _actorUserIds[Actor.Owner];

        public Guid AdminUserId => _actorUserIds[Actor.Admin];

        /// <summary>Resolves the backing user id for <paramref name="actor"/>, or a fresh non-member id.</summary>
        public Guid UserIdFor(Actor actor) =>
            actor == Actor.NonMember ? Guid.NewGuid() : _actorUserIds[actor];

        /// <summary>Seeds one effective goal for <paramref name="scoringTeamId"/> at the given minute.</summary>
        public void SeedGoal(Guid scoringTeamId, int minute) =>
            _events.Seed(new GoalScoredEvent(
                Guid.CreateVersion7(), Match.Id, SquadId,
                MatchMinute.Create(minute).Value!, scoringTeamId, null, ownGoal: false));

        /// <summary>Runs the handler as <paramref name="actingUserId"/> against the world's match.</summary>
        public Result<FinaliseTrackedResultResult> Finalise(Guid actingUserId) =>
            FinaliseMatch(actingUserId, Match.Id);

        /// <summary>Runs the handler as <paramref name="actingUserId"/> against <paramref name="matchId"/>.</summary>
        public Result<FinaliseTrackedResultResult> FinaliseMatch(Guid actingUserId, Guid matchId)
        {
            CurrentUser.CurrentUserId = actingUserId == Guid.Empty ? null : actingUserId.ToString();
            return _handler
                .HandleAsync(new FinaliseTrackedResultCommand(matchId), CancellationToken.None)
                .GetAwaiter()
                .GetResult();
        }

        /// <summary>
        /// Builds a world with the match walked to <paramref name="state"/>. Ten participants are split
        /// into two teams of five (within the 5..8 lock rule); each participant is pre-rated so
        /// completion reads an established rating.
        /// </summary>
        public static FinaliseWorld Build(MatchState state)
        {
            Squad squad = Squad.Create("The Squad").Value!;
            squad.SetFeature(SquadFeature.LiveMatchTracking, enabled: true);
            Guid squadId = squad.Id;

            var actorUserIds = new Dictionary<Actor, Guid>();
            var authMemberships = new List<SquadMembership>();

            Guid ownerUserId = Guid.NewGuid();
            SquadMembership owner = SquadMembership.CreateOwner(squadId, ownerUserId, "Owner").Value!;
            actorUserIds[Actor.Owner] = ownerUserId;
            authMemberships.Add(owner);

            Guid adminUserId = Guid.NewGuid();
            SquadMembership admin = SquadMembership.CreateRegistered(squadId, adminUserId, "Admin").Value!;
            admin.PromoteToAdmin();
            actorUserIds[Actor.Admin] = adminUserId;
            authMemberships.Add(admin);

            Guid memberUserId = Guid.NewGuid();
            SquadMembership member = SquadMembership.CreateRegistered(squadId, memberUserId, "Member").Value!;
            actorUserIds[Actor.Member] = memberUserId;
            authMemberships.Add(member);

            Guid inactiveUserId = Guid.NewGuid();
            SquadMembership inactiveAdmin = SquadMembership.CreateRegistered(squadId, inactiveUserId, "Formerly Admin").Value!;
            inactiveAdmin.PromoteToAdmin();
            inactiveAdmin.Deactivate();
            actorUserIds[Actor.InactiveAdmin] = inactiveUserId;
            authMemberships.Add(inactiveAdmin);

            const int playerCount = 10;
            const int teamASize = 5;
            var players = new List<SquadMembership>(playerCount);
            for (var i = 0; i < playerCount; i++)
            {
                players.Add(SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {i + 1}").Value!);
            }

            Match match = Match.CreateDraft(Guid.CreateVersion7(), squadId, "Hackney Marshes", [MatchDay], Anchor).Value!;

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
                    var proposal = new List<ProposedTeam>
                    {
                        new("Reds", BibFlag: true, participantIds.Take(teamASize).ToList()),
                        new("Blues", BibFlag: false, participantIds.Skip(teamASize).ToList()),
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
                                var basic = new MatchResult(ResultFidelity.Basic, new[]
                                {
                                    new TeamScore(teamAId, 1),
                                    new TeamScore(teamBId, 0),
                                });
                                match.RecordResult(basic, liveTrackingEnabled: true);
                                match.Complete(Anchor.AddHours(2));
                            }

                            break;
                    }
                }
            }

            // Pre-rate every participant so completion reads an established rating (no cold-start seeding).
            var ratings = new FakeMembershipRatingRepository();
            foreach (SquadMembership player in players)
            {
                ratings.Seed(player.Id, new PlayerRating(25.0, 8.333));
            }

            var events = new FakeMatchEventRepository();
            var matches = new SingleFinaliseMatchRepository(match);
            var memberships = new FinaliseMembershipRepository(authMemberships);
            var squads = new SingleFinaliseSquadRepository(squad);
            var snapshots = new FakeSnapshotRepository();
            var engine = new CountingRatingEngine();
            var unitOfWork = new CountingUnitOfWork();
            var publisher = new NoopPublisher();
            var clock = new FakeTimeProvider(Anchor);
            var currentUser = new MutableCurrentUserAccessor { CurrentUserId = ownerUserId.ToString() };

            var completeMatch = new CompleteMatchHandler(
                matches,
                ratings,
                snapshots,
                memberships,
                squads,
                engine,
                unitOfWork,
                clock,
                publisher,
                NullLogger<CompleteMatchHandler>.Instance);

            var handler = new FinaliseTrackedResultHandler(matches, memberships, events, completeMatch, currentUser);

            return new FinaliseWorld(
                handler, match, squadId, events, engine, unitOfWork, currentUser, actorUserIds, teamAId, teamBId);
        }
    }

    // ---- Fakes (private to this test to avoid namespace-level collisions with sibling test files) --

    /// <summary>
    /// An append-only, in-memory <see cref="IMatchEventRepository"/>. The finalise handler reads the
    /// match's event log via <see cref="GetForMatchAsync"/> to project the running score; the append
    /// and squad-scan members are unused here and throw if called.
    /// </summary>
    private sealed class FakeMatchEventRepository : IMatchEventRepository
    {
        private readonly Dictionary<Guid, List<MatchEvent>> _byMatch = new();

        public void Seed(MatchEvent e)
        {
            if (!_byMatch.TryGetValue(e.MatchId, out List<MatchEvent>? list))
            {
                list = [];
                _byMatch[e.MatchId] = list;
            }

            list.Add(e);
        }

        public Task<IReadOnlyList<MatchEvent>> GetForMatchAsync(Guid matchId, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            IReadOnlyList<MatchEvent> events =
                _byMatch.TryGetValue(matchId, out List<MatchEvent>? list) ? list.ToList() : [];
            return Task.FromResult(events);
        }

        public Task<IReadOnlySet<Guid>> GetExistingEventIdsAsync(Guid matchId, CancellationToken ct) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public Task AppendAsync(IReadOnlyList<MatchEvent> events, CancellationToken ct) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public Task<IReadOnlyList<MatchEvent>> GetForSquadCompletedMatchesAsync(Guid squadId, CancellationToken ct) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");
    }

    /// <summary>
    /// In-memory <see cref="IMatchRepository"/> serving a single seeded match by identity (shared by the
    /// finalise and completion handlers so completion's in-place mutation is observed on re-load), or
    /// <see langword="null"/> for any other id (the existence-concealment path). The write and listing
    /// members are unused and throw if called.
    /// </summary>
    private sealed class SingleFinaliseMatchRepository(Match match) : IMatchRepository
    {
        public Task<Match?> GetByIdAsync(Guid matchId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(matchId == match.Id ? match : null);
        }

        public Task AddAsync(Match match, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Finalise does not add matches.");

        public Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Finalise does not list matches.");

        public Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Finalise does not list completed matches.");
    }

    /// <summary>
    /// In-memory <see cref="ISquadMembershipRepository"/> resolving the acting membership by backing
    /// user and squad (both handlers' authorisation gate) and listing the squad's memberships (read by
    /// completion to source skill tiers). Every other member is unused and throws if called.
    /// </summary>
    private sealed class FinaliseMembershipRepository(IReadOnlyList<SquadMembership> memberships) : ISquadMembershipRepository
    {
        public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(memberships.FirstOrDefault(m => m.UserId == userId && m.SquadId == squadId));
        }

        public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            IReadOnlyList<SquadMembership> result = memberships
                .Where(m => m.SquadId == squadId && (!activeOnly || m.State == MembershipState.Active))
                .ToList();
            return Task.FromResult(result);
        }

        public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public void RemovePermanently(SquadMembership membership) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");
    }

    /// <summary>
    /// In-memory <see cref="ISquadRepository"/> serving the single seeded squad by identity, read only
    /// to render the post-commit notification. Every other member is unused and throws.
    /// </summary>
    private sealed class SingleFinaliseSquadRepository(Squad squad) : ISquadRepository
    {
        public Task<Squad?> GetByIdAsync(Guid squadId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(squadId == squad.Id ? squad : null);
        }

        public Task AddAsync(Squad squad, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public Task<Squad?> GetByIdIncludingDeletedAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public Task<IReadOnlyList<Squad>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public Task<IReadOnlyList<Squad>> ListPurgeDueAsync(DateTimeOffset now, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public void RemovePermanently(Squad squad) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");
    }

    /// <summary>
    /// In-memory <see cref="IMembershipRatingRepository"/> that stores seeded ratings by membership and
    /// returns them on read; the completion handler mutates the returned entities in place.
    /// </summary>
    private sealed class FakeMembershipRatingRepository : IMembershipRatingRepository
    {
        private readonly Dictionary<Guid, MembershipRating> _byMembership = new();

        public void Seed(Guid squadMembershipId, PlayerRating rating) =>
            _byMembership[squadMembershipId] = MembershipRating.Create(squadMembershipId, rating);

        public Task<MembershipRating?> GetAsync(Guid squadMembershipId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(_byMembership.GetValueOrDefault(squadMembershipId));
        }

        public Task AddAsync(MembershipRating rating, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ArgumentNullException.ThrowIfNull(rating);
            _byMembership[rating.SquadMembershipId] = rating;
            return Task.CompletedTask;
        }
    }

    /// <summary>
    /// In-memory <see cref="IRepository{RatingSnapshot}"/> that captures every written snapshot. Only
    /// <c>AddAsync</c> is exercised; the other members throw if called.
    /// </summary>
    private sealed class FakeSnapshotRepository : IRepository<RatingSnapshot>
    {
        private readonly List<RatingSnapshot> _captured = new();

        public IReadOnlyList<RatingSnapshot> Captured => _captured;

        public Task AddAsync(RatingSnapshot entity, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ArgumentNullException.ThrowIfNull(entity);
            _captured.Add(entity);
            return Task.CompletedTask;
        }

        public Task<RatingSnapshot?> GetByIdAsync(Guid id, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public Task<IReadOnlyList<RatingSnapshot>> ListAsync(CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public Task<IReadOnlyList<RatingSnapshot>> ListChronologicalAsync(bool includeDeleted, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public void Remove(RatingSnapshot entity) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public void Restore(RatingSnapshot entity) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");
    }

    /// <summary>
    /// A stub <see cref="IRatingEngine"/> that counts its <see cref="UpdateRatings"/> invocations — the
    /// direct evidence that finalising drives the single rating update exactly once — and returns an
    /// output mirroring the outcome's team-and-player ordering with a deterministic μ shift. Only the
    /// two operations the completion handler uses are implemented; the rest throw if called.
    /// </summary>
    internal sealed class CountingRatingEngine : IRatingEngine
    {
        public int UpdateRatingsCallCount { get; private set; }

        public PitchMate.Domain.Rating.Result<PlayerRating> CreateRating(SkillTier? tier = null) =>
            PitchMate.Domain.Rating.Result<PlayerRating>.Ok(new PlayerRating(25.0, 8.333));

        public PitchMate.Domain.Rating.Result<RatingMatchUpdate> UpdateRatings(RatingMatchOutcome outcome)
        {
            UpdateRatingsCallCount++;

            IReadOnlyList<IReadOnlyList<PlayerRating>> teams = outcome.Teams
                .Select(team => (IReadOnlyList<PlayerRating>)team.Players
                    .Select(p => new PlayerRating(p.Rating.Mu + 1.0, p.Rating.Sigma))
                    .ToList())
                .ToList();

            return PitchMate.Domain.Rating.Result<RatingMatchUpdate>.Ok(new RatingMatchUpdate(teams));
        }

        public PitchMate.Domain.Rating.Result<RatingState> GetState(PlayerRating rating) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public PitchMate.Domain.Rating.Result<IReadOnlyList<PlayerRating>> Replay(
            IReadOnlyList<PlayerRating> initialRatings,
            IReadOnlyList<ReplayMatch> matches) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public PitchMate.Domain.Rating.Result<PlayerRating> DecayInactivity(PlayerRating rating, int inactiveDays) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");

        public PitchMate.Domain.Rating.Result<MatchPrediction> Predict(IReadOnlyList<TeamRoster> rosters) =>
            throw new NotSupportedException("Not exercised by the finalise handler under test.");
    }

    /// <summary>A no-op <see cref="INotificationPublisher"/> that returns success for the post-commit publish.</summary>
    private sealed class NoopPublisher : INotificationPublisher
    {
        public Task<NotifResult> PublishAsync(
            NotificationType type,
            Guid squadId,
            IReadOnlyCollection<Guid> directedTargetMembershipIds,
            NotificationContext context,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(NotifResult.Ok());
        }
    }
}
