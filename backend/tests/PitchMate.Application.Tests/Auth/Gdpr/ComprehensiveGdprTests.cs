using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Auth.Gdpr;
using PitchMate.Application.LiveTracking;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Notifications;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Auth;
using PitchMate.Domain.LiveTracking;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Notifications;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;
using MatchRating = PitchMate.Domain.Rating.Rating;

namespace PitchMate.Application.Tests.Auth.Gdpr;

public class ComprehensiveGdprTests
{
    private sealed class TokenPurgeRepositorySpy : ITokenPurgeRepository
    {
        public DateTimeOffset? RecordedThreshold { get; private set; }
        public int PurgeCountToReturn { get; set; } = 5;

        public Task<int> PurgeExpiredTokensAsync(DateTimeOffset threshold, CancellationToken ct)
        {
            RecordedThreshold = threshold;
            return Task.FromResult(PurgeCountToReturn);
        }
    }

    private sealed class FakeSquadRepository : ISquadRepository
    {
        private readonly Dictionary<Guid, Squad> _squads = new();
        public void Seed(Squad squad) => _squads[squad.Id] = squad;
        public Task<Squad?> GetByIdAsync(Guid id, CancellationToken ct) => Task.FromResult(_squads.GetValueOrDefault(id));
        public Task<Squad?> GetByIdIncludingDeletedAsync(Guid id, CancellationToken ct) => Task.FromResult(_squads.GetValueOrDefault(id));
        public Task AddAsync(Squad squad, CancellationToken ct) { _squads[squad.Id] = squad; return Task.CompletedTask; }
        public Task<IReadOnlyList<Squad>> ListForUserAsync(Guid userId, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<Squad>>(_squads.Values.ToList());
        public Task<IReadOnlyList<Squad>> ListPurgeDueAsync(DateTimeOffset now, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<Squad>>([]);
        public void RemovePermanently(Squad squad) => _squads.Remove(squad.Id);
    }

    private sealed class FakeSquadMembershipRepository : ISquadMembershipRepository
    {
        private readonly List<SquadMembership> _memberships = [];
        public void Seed(SquadMembership membership) => _memberships.Add(membership);
        public Task<SquadMembership?> GetByIdAsync(Guid id, CancellationToken ct) =>
            Task.FromResult(_memberships.FirstOrDefault(m => m.Id == id));
        public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken ct) =>
            Task.FromResult(_memberships.FirstOrDefault(m => m.SquadId == squadId && m.UserId == userId));
        public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<SquadMembership>>(_memberships.Where(m => m.UserId == userId).ToList());
        public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<SquadMembership>>(_memberships.Where(m => m.SquadId == squadId).ToList());
        public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken ct) =>
            Task.FromResult(_memberships.FirstOrDefault(m => m.SquadId == squadId && m.Role == SquadRole.Owner));
        public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken ct) =>
            Task.FromResult(false);
        public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken ct) =>
            Task.FromResult(false);
        public Task AddAsync(SquadMembership membership, CancellationToken ct) { _memberships.Add(membership); return Task.CompletedTask; }
        public void RemovePermanently(SquadMembership membership) => _memberships.Remove(membership);
    }

    private sealed class FakeMatchRepository : IMatchRepository
    {
        private readonly List<Match> _matches = [];
        public void Seed(Match match) => _matches.Add(match);
        public Task<Match?> GetByIdAsync(Guid id, CancellationToken ct) =>
            Task.FromResult(_matches.FirstOrDefault(m => m.Id == id));
        public Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<Match>>(_matches.Where(m => m.SquadId == squadId).ToList());
        public Task AddAsync(Match match, CancellationToken ct) { _matches.Add(match); return Task.CompletedTask; }
        public Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(Guid squadId, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<Match>>([]);
    }

    private sealed class FakeMembershipHistoryProbe : IMembershipHistoryProbe
    {
        public Task<bool> HasMatchHistoryAsync(Guid squadMembershipId, CancellationToken cancellationToken) =>
            Task.FromResult(false);
    }

    [Fact]
    public async Task ExportUserGdprDataHandler_ReturnsFullDataPackage()
    {
        var clock = new ErasureFakeClock();
        DateTimeOffset now = clock.GetUtcNow();

        var store = new GdprExportStore();
        var user = User.Create("John Doe", "john@example.com");
        store.SeedUser(user);
        var identity = AuthIdentity.ForExternal(user.Id, AuthProvider.Google, "google-sub-123");
        store.SeedIdentity(identity);

        var users = new GdprExportUserRepositoryFake(store);
        var authIdentities = new GdprExportAuthIdentityRepositoryFake(store);

        var squad = Squad.Create("Tuesday FC").Value!;
        var member = SquadMembership.CreateRegistered(squad.Id, user.Id, "Johnny").Value!;
        var squads = new FakeSquadRepository();
        squads.Seed(squad);

        var memberships = new FakeSquadMembershipRepository();
        memberships.Seed(member);

        var matches = new FakeMatchRepository();
        var match = Match.CreateDraft(Guid.NewGuid(), squad.Id, "Powerleague", [now.AddDays(1)], now).Value!;
        matches.Seed(match);

        var handler = new ExportUserGdprDataHandler(users, authIdentities, memberships, squads, matches, clock);

        var result = await handler.HandleAsync(new ExportUserGdprDataCommand(user.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var package = result.Value;
        Assert.NotNull(package);
        Assert.Equal(user.Id, package.Profile.UserId);
        Assert.Equal("John Doe", package.Profile.DisplayName);
        Assert.Equal("john@example.com", package.Profile.Email);
        Assert.Single(package.Profile.LinkedProviders);
        Assert.Single(package.Squads);
        Assert.Equal("Tuesday FC", package.Squads[0].SquadName);
        Assert.Equal("Member", package.Squads[0].Role);
        Assert.Equal(0, package.Stats.TotalMatchesPlayed);
    }

    [Fact]
    public async Task EraseUserHandler_FailsWhenSoleOwnerConstraintTriggered()
    {
        var users = new ErasureUserRepositoryFake();
        var authIdentities = new ErasureAuthIdentityRepositoryFake();
        var credentials = new ErasurePasswordCredentialRepositoryFake();
        var refreshTokens = new ErasureRefreshTokenStoreFake(new ErasureFakeClock());
        var unitOfWork = new ErasureUnitOfWorkFake();

        var user = User.Create("Owner Doe", "owner@example.com");
        users.Seed(user);

        var squad = Squad.Create("Owner Squad").Value!;
        var ownerMember = SquadMembership.CreateOwner(squad.Id, user.Id, "Owner Doe").Value!;

        var squads = new FakeSquadRepository();
        squads.Seed(squad);

        var memberships = new FakeSquadMembershipRepository();
        memberships.Seed(ownerMember);

        var history = new FakeMembershipHistoryProbe();
        var onErasedHandler = new OnUserErasedHandler(memberships, squads, history, unitOfWork);

        var handler = new EraseUserHandler(users, authIdentities, credentials, refreshTokens, unitOfWork, onErasedHandler);

        var result = await handler.HandleAsync(new EraseUserCommand(user.Id), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(AuthErrorCode.OwnerConstraint, result.Error!.Code);
        Assert.Equal(0, unitOfWork.SaveCount);
    }

    [Fact]
    public async Task PurgeExpiredTokensHandler_InvokesRepositoryWithCorrectThreshold()
    {
        var spy = new TokenPurgeRepositorySpy();
        var clock = new ErasureFakeClock(new DateTimeOffset(2025, 6, 1, 12, 0, 0, TimeSpan.Zero));
        var handler = new PurgeExpiredTokensHandler(spy, clock);

        var result = await handler.HandleAsync(CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(5, result.Value);
        DateTimeOffset expectedThreshold = clock.GetUtcNow().AddHours(-48);
        Assert.Equal(expectedThreshold, spy.RecordedThreshold);
    }

    private sealed class FakeRatingRepository : IMembershipRatingRepository
    {
        private readonly Dictionary<Guid, MembershipRating> _ratings = new();
        public void Seed(MembershipRating rating) => _ratings[rating.SquadMembershipId] = rating;
        public Task<MembershipRating?> GetAsync(Guid squadMembershipId, CancellationToken cancellationToken) =>
            Task.FromResult(_ratings.GetValueOrDefault(squadMembershipId));
        public Task AddAsync(MembershipRating rating, CancellationToken cancellationToken)
        {
            _ratings[rating.SquadMembershipId] = rating;
            return Task.CompletedTask;
        }
    }

    private sealed class FakeAvailabilityRepository : IAvailabilityRepository
    {
        private readonly Dictionary<(Guid MatchId, Guid MembershipId), AvailabilityResponse> _responses = new();
        public void Seed(AvailabilityResponse response) =>
            _responses[(response.MatchId, response.SquadMembershipId)] = response;
        public Task<AvailabilityResponse?> GetResponseAsync(Guid matchId, Guid squadMembershipId, CancellationToken cancellationToken) =>
            Task.FromResult(_responses.GetValueOrDefault((matchId, squadMembershipId)));
        public Task UpsertAsync(AvailabilityResponse response, CancellationToken cancellationToken) =>
            Task.CompletedTask;
        public Task RemoveAsync(AvailabilityResponse response, CancellationToken cancellationToken) =>
            Task.CompletedTask;
        public Task<IReadOnlyList<AvailabilityResponse>> ListResponsesAsync(Guid matchId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<AvailabilityResponse>>(
                _responses.Values.Where(r => r.MatchId == matchId).ToList());
    }

    private sealed class FakeMatchEventRepository : IMatchEventRepository
    {
        private readonly List<MatchEvent> _events = [];
        public void Seed(MatchEvent matchEvent) => _events.Add(matchEvent);
        public Task<IReadOnlySet<Guid>> GetExistingEventIdsAsync(Guid matchId, CancellationToken ct) =>
            Task.FromResult<IReadOnlySet<Guid>>(_events.Where(e => e.MatchId == matchId).Select(e => e.Id).ToHashSet());
        public Task AppendAsync(IReadOnlyList<MatchEvent> events, CancellationToken ct) => Task.CompletedTask;
        public Task<IReadOnlyList<MatchEvent>> GetForMatchAsync(Guid matchId, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<MatchEvent>>(_events.Where(e => e.MatchId == matchId).ToList());
        public Task<IReadOnlyList<MatchEvent>> GetForSquadCompletedMatchesAsync(Guid squadId, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<MatchEvent>>(_events.Where(e => e.SquadId == squadId).ToList());
    }

    private sealed class FakeGuestClaimRepository : IGuestClaimRepository
    {
        private readonly List<GuestClaim> _claims = [];
        public void Seed(GuestClaim claim) => _claims.Add(claim);
        public Task AddAsync(GuestClaim claim, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task<GuestClaim?> GetOpenForMembershipAsync(Guid membershipId, CancellationToken cancellationToken) =>
            Task.FromResult(_claims.FirstOrDefault(c => c.MembershipId == membershipId && c.IsOpen));
        public Task<GuestClaim?> FindByTokenHashAsync(string tokenHash, CancellationToken cancellationToken) =>
            Task.FromResult(_claims.FirstOrDefault(c => c.TokenHash == tokenHash));
        public Task<GuestClaim?> GetLatestCompletedForMembershipAsync(Guid membershipId, CancellationToken cancellationToken) =>
            Task.FromResult(_claims.FirstOrDefault(c => c.MembershipId == membershipId && c.State == GuestClaimState.Completed));
        public Task<IReadOnlyList<GuestClaim>> ListOpenForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<GuestClaim>>([]);
        public Task<IReadOnlyList<GuestClaim>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<GuestClaim>>(_claims.Where(c => c.TargetUserId == userId).ToList());
    }

    private sealed class FakeNotificationRepository : INotificationRepository
    {
        private readonly List<InAppNotification> _notifications = [];
        public List<Guid> RemovedMembershipIds { get; } = [];
        public void Seed(InAppNotification notification) => _notifications.Add(notification);
        public Task AddAsync(InAppNotification notification, CancellationToken ct) => Task.CompletedTask;
        public Task<IReadOnlyList<SquadMembership>> ListActiveRegisteredAsync(Guid squadId, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<SquadMembership>>([]);
        public Task<IReadOnlyList<SquadMembership>> ResolveRegisteredAsync(Guid squadId, IReadOnlyCollection<Guid> ids, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<SquadMembership>>([]);
        public Task<IReadOnlyDictionary<Guid, string>> ResolveRecipientEmailsAsync(Guid squadId, IReadOnlyCollection<Guid> membershipIds, CancellationToken ct) =>
            Task.FromResult<IReadOnlyDictionary<Guid, string>>(new Dictionary<Guid, string>());
        public Task<IReadOnlyList<InAppNotification>> ListForUserAsync(Guid userId, Guid? squadId, int limit, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<InAppNotification>>(_notifications.Take(limit).ToList());
        public Task<int> CountUnreadForUserAsync(Guid userId, Guid? squadId, CancellationToken ct) =>
            Task.FromResult(0);
        public Task<InAppNotification?> GetForUserAsync(Guid notificationId, Guid userId, CancellationToken ct) =>
            Task.FromResult<InAppNotification?>(null);
        public Task<IReadOnlyList<InAppNotification>> ListUnreadForUserAsync(Guid userId, Guid? squadId, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<InAppNotification>>([]);
        public Task<bool> UserHasMembershipInSquadAsync(Guid userId, Guid squadId, CancellationToken ct) =>
            Task.FromResult(false);
        public Task RemoveForUserAsync(Guid userId, CancellationToken ct) => Task.CompletedTask;
        public Task RemoveForMembershipAsync(Guid membershipId, CancellationToken ct)
        {
            RemovedMembershipIds.Add(membershipId);
            _notifications.RemoveAll(n => n.RecipientMembershipId == membershipId);
            return Task.CompletedTask;
        }
        public Task RemoveForSquadAsync(Guid squadId, CancellationToken ct) => Task.CompletedTask;
    }

    [Fact]
    public async Task ExportUserGdprDataHandler_ExportsPostMergeDataAndRichStats()
    {
        var clock = new ErasureFakeClock(new DateTimeOffset(2026, 5, 1, 10, 0, 0, TimeSpan.Zero));
        DateTimeOffset now = clock.GetUtcNow();

        var store = new GdprExportStore();
        var user = User.Create("Jordan Ellis", "jordan@example.com", emailVerified: true, avatarReference: "avatar-42");
        store.SeedUser(user);
        store.SeedIdentity(AuthIdentity.ForExternal(user.Id, AuthProvider.Google, "google-sub-42"));

        var squad = Squad.Create("Wednesday 5s").Value!;
        var targetMember = SquadMembership.CreateRegistered(squad.Id, user.Id, "Jordan").Value!;
        var teammates = Enumerable.Range(1, 9)
            .Select(i => SquadMembership.CreateGuest(squad.Id, $"Player {i}", SkillTier.Average, now).Value!)
            .ToList();

        var squads = new FakeSquadRepository();
        squads.Seed(squad);

        var memberships = new FakeSquadMembershipRepository();
        memberships.Seed(targetMember);

        var candidateDay = now.AddDays(1);
        var completedMatch = Match.CreateDraft(Guid.NewGuid(), squad.Id, "Goals Manchester", [candidateDay], now).Value!;
        var confirmableMembers = new[] { new ConfirmableMember(targetMember.Id, targetMember.DisplayName, false) }
            .Concat(teammates.Select(m => new ConfirmableMember(m.Id, m.DisplayName, true)))
            .ToList();
        var storedResponses = new List<AvailabilityResponse>();
        foreach (ConfirmableMember member in confirmableMembers)
        {
            storedResponses.Add(completedMatch.SubmitAvailability(
                member.SquadMembershipId,
                [candidateDay],
                now).Value!);
        }

        Assert.True(completedMatch.Confirm(candidateDay, confirmableMembers, storedResponses).IsSuccess);
        var teamAIds = new[] { targetMember.Id }.Concat(teammates.Take(4).Select(t => t.Id)).ToList();
        var teamBIds = teammates.Skip(4).Select(t => t.Id).ToList();
        Assert.True(completedMatch.ApplyTeamProposal(
        [
            new ProposedTeam("Bibs", true, teamAIds),
            new ProposedTeam("Non-Bibs", false, teamBIds),
        ]).IsSuccess);
        Assert.True(completedMatch.Lock().IsSuccess);
        var teamA = completedMatch.Teams.First(t => t.TeamName == "Bibs");
        var teamB = completedMatch.Teams.First(t => t.TeamName == "Non-Bibs");
        Assert.True(completedMatch.Start(now.AddDays(1)).IsSuccess);
        Assert.True(completedMatch.RecordResult(
            new MatchResult(ResultFidelity.Rich, [new TeamScore(teamA.Id, 2), new TeamScore(teamB.Id, 0)]),
            liveTrackingEnabled: true).IsSuccess);
        Assert.True(completedMatch.Complete(now.AddDays(1).AddHours(1)).IsSuccess);

        // Cancelled match in which user responded available — must NOT count toward TotalMatchesPlayed.
        var cancelledMatch = Match.CreateDraft(Guid.NewGuid(), squad.Id, "Powerleague", [now.AddDays(3)], now).Value!;
        var futureAvailability = cancelledMatch.SubmitAvailability(targetMember.Id, [now.AddDays(3)], now).Value!;
        Assert.True(cancelledMatch.Cancel().IsSuccess);

        var matches = new FakeMatchRepository();
        matches.Seed(completedMatch);
        matches.Seed(cancelledMatch);

        var ratings = new FakeRatingRepository();
        ratings.Seed(MembershipRating.Create(targetMember.Id, new MatchRating(27.5, 6.1)));

        var availability = new FakeAvailabilityRepository();
        availability.Seed(storedResponses[0]);
        availability.Seed(futureAvailability);

        var matchEvents = new FakeMatchEventRepository();
        matchEvents.Seed(new KeeperStintStartedEvent(
            Guid.CreateVersion7(), completedMatch.Id, squad.Id, MatchMinute.Create(0).Value!, targetMember.Id, teamA.Id));
        matchEvents.Seed(new GoalScoredEvent(
            Guid.CreateVersion7(), completedMatch.Id, squad.Id, MatchMinute.Create(15).Value!, teamA.Id, targetMember.Id, ownGoal: false));
        matchEvents.Seed(new GoalScoredEvent(
            Guid.CreateVersion7(), completedMatch.Id, squad.Id, MatchMinute.Create(40).Value!, teamA.Id, teammates[0].Id, ownGoal: false));

        var guestMembership = SquadMembership.CreateGuest(squad.Id, "Guest Jordan", SkillTier.Average, now).Value!;
        var claim = GuestClaim.Initiate(guestMembership.Id, "hash-1", now.AddDays(7));
        Assert.True(claim.Accept(user.Id, now).IsSuccess);
        var guestClaims = new FakeGuestClaimRepository();
        guestClaims.Seed(claim);

        var notification = InAppNotification.Create(
            squad.Id, targetMember.Id, NotificationType.MatchConfirmed, "Match Confirmed", "Wednesday 5s confirmed.").Value!;
        var notifications = new FakeNotificationRepository();
        notifications.Seed(notification);

        var handler = new ExportUserGdprDataHandler(
            new GdprExportUserRepositoryFake(store),
            new GdprExportAuthIdentityRepositoryFake(store),
            memberships,
            squads,
            matches,
            clock,
            ratings,
            availability,
            matchEvents,
            guestClaims,
            notifications);

        var result = await handler.HandleAsync(new ExportUserGdprDataCommand(user.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var pkg = result.Value!;
        Assert.Equal("avatar-42", pkg.Profile.AvatarReference);
        Assert.Single(pkg.Squads);
        Assert.Equal(27.5, pkg.Squads[0].RatingMu);
        Assert.Equal(6.1, pkg.Squads[0].RatingSigma);
        Assert.False(pkg.Squads[0].IsGuest);
        Assert.Null(pkg.Squads[0].SkillTier);
        Assert.Single(pkg.Matches);
        Assert.Equal("Goals Manchester", pkg.Matches[0].Location);
        Assert.Equal("Win", pkg.Matches[0].Outcome);
        Assert.Equal(1, pkg.Matches[0].GoalsScored);
        Assert.Equal(40, pkg.Matches[0].KeeperMinutes);
        Assert.Equal(1, pkg.Stats.TotalMatchesPlayed);
        Assert.Equal(1, pkg.Stats.Wins);
        Assert.Equal(1, pkg.Stats.GoalsScored);
        Assert.Equal(1, pkg.Stats.CleanSheets);
        Assert.Equal(40, pkg.Stats.KeeperMinutes);
        Assert.Equal(2, pkg.AvailabilityResponses.Count);
        Assert.Single(pkg.GuestClaims);
        Assert.Equal(GuestClaimState.Consented.ToString(), pkg.GuestClaims[0].State);
        Assert.Single(pkg.Notifications);
        Assert.Equal("Match Confirmed", pkg.Notifications[0].Title);
    }

    [Fact]
    public async Task OnUserErasedHandler_ScrubsConsentedGuestClaimAndRemovesMembershipNotifications()
    {
        var clock = new ErasureFakeClock(new DateTimeOffset(2026, 5, 1, 10, 0, 0, TimeSpan.Zero));
        DateTimeOffset now = clock.GetUtcNow();

        var userId = Guid.NewGuid();
        var squad = Squad.Create("Thursday FC").Value!;
        var membership = SquadMembership.CreateRegistered(squad.Id, userId, "Sam").Value!;
        var guest = SquadMembership.CreateGuest(squad.Id, "Guest Sam", SkillTier.Average, now).Value!;

        var claim = GuestClaim.Initiate(guest.Id, "claim-token-hash", now.AddDays(7));
        Assert.True(claim.Accept(userId, now).IsSuccess);

        var squads = new FakeSquadRepository();
        squads.Seed(squad);
        var memberships = new FakeSquadMembershipRepository();
        memberships.Seed(membership);
        var guestClaims = new FakeGuestClaimRepository();
        guestClaims.Seed(claim);

        var notifications = new FakeNotificationRepository();
        notifications.Seed(InAppNotification.Create(
            squad.Id, membership.Id, NotificationType.MatchConfirmed, "Match On", "See you at pitch 2.").Value!);
        var unitOfWork = new ErasureUnitOfWorkFake();
        var removeNotifications = new RemoveNotificationsForMembershipHandler(notifications, unitOfWork);

        var handler = new OnUserErasedHandler(
            memberships,
            squads,
            new FakeMembershipHistoryProbe(),
            unitOfWork,
            guestClaims,
            clock,
            removeNotifications);

        var result = await handler.HandleAsync(new OnUserErasedCommand(userId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(GuestClaimState.Cancelled, claim.State);
        Assert.Null(claim.TargetUserId);
        Assert.Contains(membership.Id, notifications.RemovedMembershipIds);
    }

    [Fact]
    public async Task OnUserErasedHandler_ScrubsConsentedGuestClaimEvenWithoutMemberships()
    {
        var clock = new ErasureFakeClock(new DateTimeOffset(2026, 5, 1, 10, 0, 0, TimeSpan.Zero));
        DateTimeOffset now = clock.GetUtcNow();

        var userId = Guid.NewGuid();
        var guestMembershipId = Guid.NewGuid();
        var claim = GuestClaim.Initiate(guestMembershipId, "pending-claim-hash", now.AddDays(7));
        Assert.True(claim.Accept(userId, now).IsSuccess);

        var guestClaims = new FakeGuestClaimRepository();
        guestClaims.Seed(claim);
        var unitOfWork = new ErasureUnitOfWorkFake();

        var handler = new OnUserErasedHandler(
            new FakeSquadMembershipRepository(),
            new FakeSquadRepository(),
            new FakeMembershipHistoryProbe(),
            unitOfWork,
            guestClaims,
            clock);

        var result = await handler.HandleAsync(new OnUserErasedCommand(userId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(GuestClaimState.Cancelled, claim.State);
        Assert.Null(claim.TargetUserId);
        Assert.Equal(1, unitOfWork.SaveCount);
    }
}
