using PitchMate.Domain.Common;

namespace PitchMate.Domain.Squads;

/// <summary>
/// A revocable, expirable invite backing a shareable invite link and short code for one squad.
/// The redeemable secret is returned to the creating client exactly once; only its one-way
/// <see cref="TokenHash"/> is persisted, matched by hashing a presented secret and comparing in
/// fixed time (Requirement 10.1, 10.4).
/// <para>
/// Only <see cref="InviteState.Active"/> and <see cref="InviteState.Revoked"/> are stored;
/// <see cref="InviteState.Expired"/> is <b>derived</b> against the clock and never persisted
/// (Requirement 12.3, 12.6). An invite with no <see cref="ExpiresAt"/> never expires. Deriving
/// from <see cref="BaseEntity"/> supplies the GUID v7 key, audit fields (who/when created), and
/// soft-delete state (Requirement 19.5).
/// </para>
/// </summary>
public sealed class Invite : BaseEntity
{
    /// <summary>The maximum number of active invites permitted concurrently for a single squad (Requirement 10.6, 10.10).</summary>
    public const int MaxActivePerSquad = 25;

    /// <summary>The minimum validity period an expiring invite may be generated with (Requirement 10.9).</summary>
    public static readonly TimeSpan MinValidity = TimeSpan.FromHours(1);

    /// <summary>The maximum validity period an expiring invite may be generated with (Requirement 10.9).</summary>
    public static readonly TimeSpan MaxValidity = TimeSpan.FromDays(90);

    /// <summary>The validity period applied when a generation request supplies none (Requirement 10.2).</summary>
    public static readonly TimeSpan DefaultValidity = TimeSpan.FromDays(7);

    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private Invite()
    {
        TokenHash = string.Empty;
    }

    private Invite(Guid squadId, string tokenHash, DateTimeOffset? expiresAt)
    {
        SquadId = squadId;
        TokenHash = tokenHash;
        State = InviteState.Active;
        ExpiresAt = expiresAt;
    }

    /// <summary>The identity of the squad this invite grants membership to.</summary>
    public Guid SquadId { get; private set; }

    /// <summary>
    /// The one-way hash of the redeemable secret. The secret itself is returned to the creating
    /// client once and never persisted in recoverable form (Requirement 10.1, 10.4).
    /// </summary>
    public string TokenHash { get; private set; }

    /// <summary>
    /// The stored lifecycle state, drawn from <see cref="InviteState.Active"/> and
    /// <see cref="InviteState.Revoked"/>. <see cref="InviteState.Expired"/> is derived at read time
    /// and never stored (Requirement 12.3, 12.6).
    /// </summary>
    public InviteState State { get; private set; }

    /// <summary>
    /// The UTC instant at which the invite expires, or <see langword="null"/> for a non-expiring
    /// invite that is never treated as expired (Requirement 12.6).
    /// </summary>
    public DateTimeOffset? ExpiresAt { get; private set; }

    /// <summary>
    /// Creates an <see cref="InviteState.Active"/> invite for <paramref name="squadId"/> that
    /// persists only the supplied one-way <paramref name="tokenHash"/> (Requirement 10.1, 10.4).
    /// A <see langword="null"/> <paramref name="expiresAt"/> yields a non-expiring invite
    /// (Requirement 12.6); validity-range and non-expiring-policy checks are enforced by the
    /// generating use case (Requirement 10.2, 10.3, 10.9).
    /// </summary>
    /// <param name="squadId">The squad the invite grants membership to.</param>
    /// <param name="tokenHash">The one-way hash of the redeemable secret to persist.</param>
    /// <param name="expiresAt">The expiry instant, or <see langword="null"/> for a non-expiring invite.</param>
    /// <returns>A new active invite.</returns>
    public static Invite Create(Guid squadId, string tokenHash, DateTimeOffset? expiresAt) =>
        new(squadId, tokenHash, expiresAt);

    /// <summary>
    /// Revokes the invite by setting <see cref="InviteState.Revoked"/> (Requirement 12.1). Idempotent:
    /// revoking an already-revoked or (derived) expired invite is a no-op success that leaves the
    /// stored state unchanged (Requirement 12.4). Existing members are unaffected, since revocation
    /// touches only this invite.
    /// </summary>
    public void Revoke()
    {
        // Only an active, stored invite transitions; already-revoked (and derived-expired, which
        // remains stored as Active) invites are left as-is so revocation stays idempotent.
        if (State == InviteState.Active)
        {
            State = InviteState.Revoked;
        }
    }

    /// <summary>
    /// Returns the effective state against <paramref name="now"/>: a stored
    /// <see cref="InviteState.Revoked"/> stays revoked; an <see cref="InviteState.Active"/> invite
    /// reads as <see cref="InviteState.Expired"/> iff it has an <see cref="ExpiresAt"/> at or before
    /// <paramref name="now"/>; a non-expiring invite is never expired (Requirement 12.3, 12.6).
    /// </summary>
    /// <param name="now">The current instant from the clock.</param>
    public InviteState EffectiveState(DateTimeOffset now)
    {
        if (State == InviteState.Revoked)
        {
            return InviteState.Revoked;
        }

        if (ExpiresAt is { } expiresAt && expiresAt <= now)
        {
            return InviteState.Expired;
        }

        return InviteState.Active;
    }

    /// <summary>
    /// The single predicate that both join and reactivation consult: the invite is redeemable at
    /// <paramref name="now"/> iff it is stored <see cref="InviteState.Active"/> and either has no
    /// expiry or its expiry is strictly after <paramref name="now"/> (Requirement 9.1, 9.2, 11.1,
    /// 11.5, 12.2, 12.3).
    /// </summary>
    /// <param name="now">The current instant from the clock.</param>
    public bool IsRedeemableAt(DateTimeOffset now) =>
        State == InviteState.Active && (ExpiresAt is null || now < ExpiresAt);
}
