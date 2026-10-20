using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Auth.Repositories;

/// <summary>
/// EF Core implementation of <see cref="ITokenPurgeRepository"/> over the shared <see cref="PitchMateDbContext"/>.
/// Purges expired and spent tokens to satisfy UK GDPR data minimisation (Article 5(1)(e)).
/// </summary>
internal sealed class EfTokenPurgeRepository(PitchMateDbContext db) : ITokenPurgeRepository
{
    /// <inheritdoc />
    public async Task<int> PurgeExpiredTokensAsync(DateTimeOffset threshold, CancellationToken ct)
    {
        int count = 0;

        // 1. Email verification tokens
        List<EmailVerificationToken> verificationTokens = await db.Set<EmailVerificationToken>()
            .IgnoreQueryFilters()
            .Where(t => t.ExpiresAt < threshold || (t.RedeemedAt != null && t.RedeemedAt < threshold))
            .ToListAsync(ct);

        foreach (EmailVerificationToken token in verificationTokens)
        {
            db.Set<EmailVerificationToken>().Remove(token);
            db.MarkForHardDelete(token);
            count++;
        }

        // 2. Password reset tokens
        List<PasswordResetToken> resetTokens = await db.Set<PasswordResetToken>()
            .IgnoreQueryFilters()
            .Where(t => t.ExpiresAt < threshold || (t.RedeemedAt != null && t.RedeemedAt < threshold))
            .ToListAsync(ct);

        foreach (PasswordResetToken token in resetTokens)
        {
            db.Set<PasswordResetToken>().Remove(token);
            db.MarkForHardDelete(token);
            count++;
        }

        // 3. Refresh tokens
        List<RefreshToken> refreshTokens = await db.Set<RefreshToken>()
            .IgnoreQueryFilters()
            .Where(t => t.ExpiresAt < threshold || (t.Status != RefreshTokenStatus.Active && t.UpdatedAt < threshold))
            .ToListAsync(ct);

        foreach (RefreshToken token in refreshTokens)
        {
            db.Set<RefreshToken>().Remove(token);
            db.MarkForHardDelete(token);
            count++;
        }

        if (count > 0)
        {
            await db.SaveChangesAsync(ct);
        }

        return count;
    }
}
