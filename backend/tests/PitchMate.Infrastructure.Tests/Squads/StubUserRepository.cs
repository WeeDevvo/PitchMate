using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;

namespace PitchMate.Infrastructure.Tests.Squads;

/// <summary>
/// A minimal <see cref="IUserRepository"/> stub for the squad DB-invariant tests. The squad tables
/// carry no foreign key from <c>squad_membership.user_id</c> to the users table (a membership only
/// stores the backing user's identity), so these tests never create real <see cref="User"/> rows;
/// they always pass an explicit owner display name to <c>CreateSquadHandler</c>, which then never
/// consults this repository. It therefore returns <see langword="null"/> for every lookup and is
/// never expected to be called on the create path.
/// </summary>
public sealed class StubUserRepository : IUserRepository
{
    /// <inheritdoc />
    public Task<User?> GetByIdAsync(Guid id, CancellationToken ct) => Task.FromResult<User?>(null);

    /// <inheritdoc />
    public Task AddAsync(User user, CancellationToken ct) => Task.CompletedTask;
}
