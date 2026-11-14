using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Auth.Gdpr;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;

namespace PitchMate.Api.Tests.Auth.Startup;

public sealed class DataRetentionPurgeHostedServiceTests
{
    private sealed class TokenPurgeSpy : ITokenPurgeRepository
    {
        public DateTimeOffset? Threshold { get; private set; }

        public Task<int> PurgeExpiredTokensAsync(DateTimeOffset olderThanUtc, CancellationToken cancellationToken)
        {
            Threshold = olderThanUtc;
            return Task.FromResult(3);
        }
    }

    private sealed class SquadRepositorySpy : ISquadRepository
    {
        public DateTimeOffset? PurgeNowChecked { get; private set; }

        public Task<Squad?> GetByIdAsync(Guid squadId, CancellationToken cancellationToken) => Task.FromResult<Squad?>(null);
        public Task<Squad?> GetByIdIncludingDeletedAsync(Guid squadId, CancellationToken cancellationToken) => Task.FromResult<Squad?>(null);
        public Task AddAsync(Squad squad, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task<IReadOnlyList<Squad>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Squad>>([]);
        public Task<IReadOnlyList<Squad>> ListPurgeDueAsync(DateTimeOffset now, CancellationToken cancellationToken)
        {
            PurgeNowChecked = now;
            return Task.FromResult<IReadOnlyList<Squad>>([]);
        }
        public void RemovePermanently(Squad squad) { }
    }

    private sealed class MembershipRepositoryStub : ISquadMembershipRepository
    {
        public Task<SquadMembership?> GetByIdAsync(Guid id, CancellationToken ct) => Task.FromResult<SquadMembership?>(null);
        public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken ct) => Task.FromResult<SquadMembership?>(null);
        public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<SquadMembership>>([]);
        public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<SquadMembership>>([]);
        public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken ct) => Task.FromResult<SquadMembership?>(null);
        public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken ct) => Task.FromResult(false);
        public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken ct) =>
            Task.FromResult(false);
        public Task AddAsync(SquadMembership membership, CancellationToken ct) => Task.CompletedTask;
        public void RemovePermanently(SquadMembership membership) { }
    }

    private sealed class UnitOfWorkStub : IUnitOfWork
    {
        public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) => Task.FromResult(0);
        public Task ExecuteInTransactionAsync(Func<CancellationToken, Task> action, CancellationToken cancellationToken = default) =>
            action(cancellationToken);
    }

    [Fact]
    public async Task RunPurgeCycleAsync_ExecutesTokenAndDueSquadPurges()
    {
        var clock = new FakeTimeProvider(new DateTimeOffset(2026, 5, 1, 12, 0, 0, TimeSpan.Zero));
        var tokenSpy = new TokenPurgeSpy();
        var squadSpy = new SquadRepositorySpy();

        var services = new ServiceCollection();
        services.AddSingleton<TimeProvider>(clock);
        services.AddSingleton<ITokenPurgeRepository>(tokenSpy);
        services.AddSingleton<ISquadRepository>(squadSpy);
        services.AddSingleton<ISquadMembershipRepository, MembershipRepositoryStub>();
        services.AddSingleton<IUnitOfWork, UnitOfWorkStub>();
        services.AddScoped<PurgeExpiredTokensHandler>();
        services.AddScoped<PurgeSquadHandler>();

        await using ServiceProvider provider = services.BuildServiceProvider();
        var hostedService = new DataRetentionPurgeHostedService(
            provider.GetRequiredService<IServiceScopeFactory>(),
            clock,
            NullLogger<DataRetentionPurgeHostedService>.Instance);

        await hostedService.RunPurgeCycleAsync(CancellationToken.None);

        Assert.Equal(clock.GetUtcNow().AddHours(-48), tokenSpy.Threshold);
        Assert.Equal(clock.GetUtcNow(), squadSpy.PurgeNowChecked);
    }
}
