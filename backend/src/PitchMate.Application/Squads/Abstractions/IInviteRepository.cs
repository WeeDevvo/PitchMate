using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.Abstractions;

/// <summary>
/// Invite-specific persistence operations that must run inside the database (token-hash matching,
/// active-invite counting for the per-squad cap). Declared in Application; implemented in
/// Infrastructure over the <c>PitchMateDbContext</c> (Requirement 19.2, 19.3).
/// </summary>
public interface IInviteRepository
{
    /// <summary>Stages an insert of <paramref name="invite"/>; the row is written on the unit-of-work commit.</summary>
    /// <param name="invite">The invite to add.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    Task AddAsync(Invite invite, CancellationToken cancellationToken);

    /// <summary>
    /// Retrieves the invite whose identity equals <paramref name="inviteId"/>, or
    /// <see langword="null"/> when none matches (Requirement 12.1, 12.4).
    /// </summary>
    /// <param name="inviteId">The invite identity to look up.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The matching invite, or <see langword="null"/>.</returns>
    Task<Invite?> GetByIdAsync(Guid inviteId, CancellationToken cancellationToken);

    /// <summary>
    /// Finds the invite whose stored one-way <see cref="Invite.TokenHash"/> equals
    /// <paramref name="tokenHash"/> at redemption, or <see langword="null"/> when none matches
    /// (Requirement 11.1, 12.2).
    /// </summary>
    /// <param name="tokenHash">The hash of the presented invite secret.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The matching invite, or <see langword="null"/>.</returns>
    Task<Invite?> FindByTokenHashAsync(string tokenHash, CancellationToken cancellationToken);

    /// <summary>
    /// Lists all invites for <paramref name="squadId"/> so they can be surfaced without any redeemable
    /// secret (Requirement 10.5). Returns an empty list when none exist.
    /// </summary>
    /// <param name="squadId">The squad whose invites are listed.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The squad's invites, or an empty list.</returns>
    Task<IReadOnlyList<Invite>> ListForSquadAsync(Guid squadId, CancellationToken cancellationToken);

    /// <summary>
    /// Counts the currently active (non-revoked, non-expired) invites for <paramref name="squadId"/>
    /// so the per-squad active-invite cap can be enforced before generating another
    /// (Requirement 10.6, 10.10).
    /// </summary>
    /// <param name="squadId">The squad whose active invites are counted.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The number of active invites in the squad.</returns>
    Task<int> CountActiveAsync(Guid squadId, CancellationToken cancellationToken);
}
