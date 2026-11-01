using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Auth.Gdpr;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Auth;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

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
}
