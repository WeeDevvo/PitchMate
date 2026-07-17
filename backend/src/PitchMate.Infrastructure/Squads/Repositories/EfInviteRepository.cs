using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Squads.Repositories;

/// <summary>
/// EF Core implementation of <see cref="IInviteRepository"/> over the shared
/// <see cref="PitchMateDbContext"/>. Matches a presented secret by its one-way hash and counts the
/// stored-active invites for the per-squad cap. Only <see cref="InviteState.Active"/> and
/// <see cref="InviteState.Revoked"/> are ever stored; <see cref="InviteState.Expired"/> is derived
/// against the clock and never persisted, so the active-invite count filters on the stored
/// <see cref="InviteState.Active"/> value and the generating use case rejects expired invites via
/// the clock.
/// <para>Validates: Requirements 10.5, 10.6, 10.10, 11.1, 12.2, 19.3.</para>
/// </summary>
internal sealed class EfInviteRepository(PitchMateDbContext db) : IInviteRepository
{
    /// <inheritdoc />
    public async Task AddAsync(Invite invite, CancellationToken cancellationToken)
        => await db.Set<Invite>().AddAsync(invite, cancellationToken);

    /// <inheritdoc />
    public Task<Invite?> GetByIdAsync(Guid inviteId, CancellationToken cancellationToken)
        => db.Set<Invite>().FirstOrDefaultAsync(invite => invite.Id == inviteId, cancellationToken);

    /// <inheritdoc />
    public Task<Invite?> FindByTokenHashAsync(string tokenHash, CancellationToken cancellationToken)
        // The unique index on token_hash guarantees a presented secret hashes to at most one invite
        // (Requirement 10.4, 11.1, 12.2).
        => db.Set<Invite>().FirstOrDefaultAsync(invite => invite.TokenHash == tokenHash, cancellationToken);

    /// <inheritdoc />
    public async Task<IReadOnlyList<Invite>> ListForSquadAsync(Guid squadId, CancellationToken cancellationToken)
        => await db.Set<Invite>()
            .Where(invite => invite.SquadId == squadId)
            .ToListAsync(cancellationToken);

    /// <inheritdoc />
    public Task<int> CountActiveAsync(Guid squadId, CancellationToken cancellationToken)
        // Count invites whose stored state is Active. Expired is derived from the clock and never
        // persisted, so a stored-Active-but-expired invite still counts here; the generating use
        // case enforces the cap against this count (Requirement 10.6, 10.10).
        => db.Set<Invite>()
            .CountAsync(
                invite => invite.SquadId == squadId && invite.State == InviteState.Active,
                cancellationToken);
}
