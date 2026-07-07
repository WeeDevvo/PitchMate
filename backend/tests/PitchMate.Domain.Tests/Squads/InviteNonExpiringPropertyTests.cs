using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Tests.Squads;

/// <summary>
/// Property-based tests for non-expiring invites on <see cref="Invite"/> (squads-and-membership
/// design Property 26). A non-expiring invite has <see cref="Invite.ExpiresAt"/> == null and must
/// never be treated as expired at any clock instant, past or far future: while Active it reports
/// <see cref="InviteState.Active"/> and is redeemable everywhere; once revoked it reports
/// <see cref="InviteState.Revoked"/> (still never Expired) and is redeemable nowhere. Each property
/// runs at least 100 iterations over arbitrary <see cref="DateTimeOffset"/> instants.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class InviteNonExpiringPropertyTests
{
    private static readonly Guid SquadId = Guid.CreateVersion7();
    private const string TokenHash = "non-expiring-token-hash";

    // Feature: squads-and-membership, Property 26: A non-expiring invite is never treated as expired -
    // an Active invite with a null ExpiresAt reports EffectiveState(now) == Active for every clock
    // instant, never Expired.
    // Validates: Requirements 12.6
    [Property(MaxTest = 100)]
    [Trait("Property", "26")]
    public Property ActiveNonExpiringIsAlwaysActive() =>
        Prop.ForAll(Arb.From(InstantGen()), now =>
        {
            var invite = Invite.Create(SquadId, TokenHash, expiresAt: null);

            return invite.EffectiveState(now) == InviteState.Active;
        });

    // Feature: squads-and-membership, Property 26: A non-expiring invite is never treated as expired -
    // an Active invite with a null ExpiresAt is redeemable at every clock instant.
    // Validates: Requirements 12.6
    [Property(MaxTest = 100)]
    [Trait("Property", "26")]
    public Property ActiveNonExpiringIsAlwaysRedeemable() =>
        Prop.ForAll(Arb.From(InstantGen()), now =>
        {
            var invite = Invite.Create(SquadId, TokenHash, expiresAt: null);

            return invite.IsRedeemableAt(now);
        });

    // Feature: squads-and-membership, Property 26: A non-expiring invite is never treated as expired -
    // after Revoke, a non-expiring invite reports EffectiveState(now) == Revoked (never Expired) and
    // is not redeemable, confirming a null expiry is never treated as expired regardless of state.
    // Validates: Requirements 12.6
    [Property(MaxTest = 100)]
    [Trait("Property", "26")]
    public Property RevokedNonExpiringIsRevokedAndNotRedeemable() =>
        Prop.ForAll(Arb.From(InstantGen()), now =>
        {
            var invite = Invite.Create(SquadId, TokenHash, expiresAt: null);
            invite.Revoke();

            return invite.EffectiveState(now) == InviteState.Revoked
                && invite.EffectiveState(now) != InviteState.Expired
                && !invite.IsRedeemableAt(now);
        });

    /// <summary>The total number of whole days spanned by the <see cref="DateTimeOffset"/> range.</summary>
    private static readonly int MaxDayOffset =
        (int)(DateTimeOffset.MaxValue.Date - DateTimeOffset.MinValue.Date).TotalDays;

    /// <summary>
    /// Generates arbitrary clock instants across the whole <see cref="DateTimeOffset"/> range - the
    /// far past (year 1), the present, and the far future (year 9999) - so a null expiry is exercised
    /// against every kind of "now". A random day offset from the minimum date is combined with a
    /// random second-of-day for intra-day variety.
    /// </summary>
    private static Gen<DateTimeOffset> InstantGen() =>
        from days in Gen.Choose(0, MaxDayOffset)
        from seconds in Gen.Choose(0, 86_399)
        select DateTimeOffset.MinValue.AddDays(days).AddSeconds(seconds);
}
