using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Auth.Repositories;

/// <summary>
/// EF Core implementation of <see cref="IEmailVerificationTokenRepository"/> over the
/// shared <see cref="PitchMateDbContext"/>. Only one-way token hashes are persisted; a
/// presented secret is matched by hashing it and looking up a currently redeemable row.
/// The injected <see cref="TimeProvider"/> supplies the instant used to judge expiry, so
/// "redeemable" means unredeemed and unexpired against the same clock the rest of the
/// system uses.
/// <para>Validates: Requirements 12.3.</para>
/// </summary>
internal sealed class EfEmailVerificationTokenRepository(PitchMateDbContext db, TimeProvider clock)
    : IEmailVerificationTokenRepository
{
    /// <inheritdoc />
    public async Task AddAsync(EmailVerificationToken token, CancellationToken ct)
        => await db.Set<EmailVerificationToken>().AddAsync(token, ct);

    /// <inheritdoc />
    public Task<EmailVerificationToken?> FindRedeemableByHashAsync(string tokenHash, CancellationToken ct)
    {
        // Redeemable == unredeemed (RedeemedAt is null) and unexpired (now < ExpiresAt),
        // mirroring EmailVerificationToken.IsRedeemableAt against the injected clock.
        var now = clock.GetUtcNow();

        return db.Set<EmailVerificationToken>()
            .FirstOrDefaultAsync(
                t => t.TokenHash == tokenHash && t.RedeemedAt == null && now < t.ExpiresAt,
                ct);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<EmailVerificationToken>> ListUnredeemedForUserAsync(Guid userId, CancellationToken ct)
        => await db.Set<EmailVerificationToken>()
            .Where(t => t.UserId == userId && t.RedeemedAt == null)
            .ToListAsync(ct);
}
