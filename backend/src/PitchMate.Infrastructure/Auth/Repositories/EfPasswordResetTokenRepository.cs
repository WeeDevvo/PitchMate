using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Auth.Repositories;

/// <summary>
/// EF Core implementation of <see cref="IPasswordResetTokenRepository"/> over the shared
/// <see cref="PitchMateDbContext"/>. Only one-way token hashes are persisted; a presented
/// secret is matched by hashing it and looking up a currently redeemable row. The injected
/// <see cref="TimeProvider"/> supplies the instant used to judge expiry and to bound the
/// rolling rate-limit window.
/// <para>Validates: Requirements 12.3.</para>
/// </summary>
internal sealed class EfPasswordResetTokenRepository(PitchMateDbContext db, TimeProvider clock)
    : IPasswordResetTokenRepository
{
    /// <inheritdoc />
    public async Task AddAsync(PasswordResetToken token, CancellationToken ct)
        => await db.Set<PasswordResetToken>().AddAsync(token, ct);

    /// <inheritdoc />
    public Task<PasswordResetToken?> FindRedeemableByHashAsync(string tokenHash, CancellationToken ct)
    {
        // Redeemable == unredeemed (RedeemedAt is null) and unexpired (now < ExpiresAt),
        // mirroring PasswordResetToken.IsRedeemableAt against the injected clock.
        var now = clock.GetUtcNow();

        return db.Set<PasswordResetToken>()
            .FirstOrDefaultAsync(
                t => t.TokenHash == tokenHash && t.RedeemedAt == null && now < t.ExpiresAt,
                ct);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<PasswordResetToken>> ListUnredeemedForAuthIdentityAsync(
        Guid authIdentityId, CancellationToken ct)
        => await db.Set<PasswordResetToken>()
            .Where(t => t.AuthIdentityId == authIdentityId && t.RedeemedAt == null)
            .ToListAsync(ct);

    /// <inheritdoc />
    public Task<int> CountRequestsInWindowAsync(Guid authIdentityId, DateTimeOffset since, CancellationToken ct)
        // Counts reset tokens issued for the identity within the rolling window; CreatedAt is
        // stamped by the save pipeline at issuance, so it marks when the request was made.
        => db.Set<PasswordResetToken>()
            .CountAsync(t => t.AuthIdentityId == authIdentityId && t.CreatedAt >= since, ct);
}
