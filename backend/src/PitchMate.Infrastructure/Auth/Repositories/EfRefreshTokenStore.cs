using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Auth.Repositories;

/// <summary>
/// EF Core implementation of <see cref="IRefreshTokenStore"/> (the refresh-token
/// revocation store) over the shared <see cref="PitchMateDbContext"/>. Only one-way
/// token hashes are persisted; an incoming secret is matched by hashing it and looking
/// up the stored hash. Lookups by family and by user support whole-family revocation on
/// reuse detection, sign-out, and password reset.
/// <para>Validates: Requirements 12.3.</para>
/// </summary>
internal sealed class EfRefreshTokenStore(PitchMateDbContext db) : IRefreshTokenStore
{
    /// <inheritdoc />
    public async Task AddAsync(RefreshToken token, CancellationToken ct)
        => await db.Set<RefreshToken>().AddAsync(token, ct);

    /// <inheritdoc />
    public Task<RefreshToken?> FindByHashAsync(string tokenHash, CancellationToken ct)
        // Returned regardless of status: the caller inspects the lifecycle state to detect
        // reuse of a rotated/revoked token.
        => db.Set<RefreshToken>()
            .FirstOrDefaultAsync(t => t.TokenHash == tokenHash, ct);

    /// <inheritdoc />
    public async Task<IReadOnlyList<RefreshToken>> ListFamilyAsync(Guid tokenFamilyId, CancellationToken ct)
        => await db.Set<RefreshToken>()
            .Where(t => t.TokenFamilyId == tokenFamilyId)
            .ToListAsync(ct);

    /// <inheritdoc />
    public async Task<IReadOnlyList<RefreshToken>> ListActiveForUserAsync(Guid userId, CancellationToken ct)
        // Every token still in the Active state for the user. Revoking these covers all of a
        // user's live sessions (e.g. on password reset); already rotated/revoked tokens need
        // no further action.
        => await db.Set<RefreshToken>()
            .Where(t => t.UserId == userId && t.Status == RefreshTokenStatus.Active)
            .ToListAsync(ct);
}
