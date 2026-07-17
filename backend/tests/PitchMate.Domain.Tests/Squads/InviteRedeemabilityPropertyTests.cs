using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Tests.Squads;

/// <summary>
/// Property-based tests for invite redeemability against the clock on <see cref="Invite"/>
/// (squads-and-membership design Property 25, in-memory portion). The entity exposes two clock-aware
/// reads that both join and reactivation consult: <see cref="Invite.IsRedeemableAt"/> and
/// <see cref="Invite.EffectiveState"/>. Over generated clock instants, expiry instants (including a
/// non-expiring null), and stored states (Active or Revoked), an invite is redeemable at an instant
/// iff it is stored <see cref="InviteState.Active"/> and either never expires or its expiry is
/// strictly after that instant; a revoked invite is never redeemable; and the two reads agree so
/// that redeemable holds exactly when the effective state is <see cref="InviteState.Active"/>. Each
/// property runs at least 100 iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class InviteRedeemabilityPropertyTests
{
    // Feature: squads-and-membership, Property 25: Redemption succeeds only for a redeemable invite -
    // IsRedeemableAt(now) is true if and only if the invite is stored Active and either has no expiry
    // or its expiry is strictly after now.
    // Validates: Requirements 9.2, 11.1, 11.2, 11.5, 12.2, 12.3
    [Property(MaxTest = 100)]
    [Trait("Property", "25")]
    public Property RedeemableIffStoredActiveAndNotYetExpired() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var invite = Build(scenario);

            var expected = !scenario.Revoked
                && (scenario.ExpiresAt is null || scenario.Now < scenario.ExpiresAt);

            return invite.IsRedeemableAt(scenario.Now) == expected;
        });

    // Feature: squads-and-membership, Property 25: Redemption succeeds only for a redeemable invite -
    // a revoked invite is never redeemable at any instant, regardless of its expiry configuration.
    // Validates: Requirements 12.2, 12.3
    [Property(MaxTest = 100)]
    [Trait("Property", "25")]
    public Property RevokedInviteIsNeverRedeemable() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var invite = Build(scenario);
            invite.Revoke();

            return !invite.IsRedeemableAt(scenario.Now);
        });

    // Feature: squads-and-membership, Property 25: Redemption succeeds only for a redeemable invite -
    // when a stored-Active invite is not redeemable because its expiry is at or before now, its
    // effective state reads as Expired; when it is redeemable, its effective state reads as Active.
    // Validates: Requirements 11.5, 12.2, 12.3
    [Property(MaxTest = 100)]
    [Trait("Property", "25")]
    public Property ExpiryDrivesEffectiveStateForActiveInvites() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            // Only consider stored-Active invites, where expiry alone decides redeemability.
            var invite = Build(scenario);
            if (scenario.Revoked)
            {
                return true; // vacuously satisfied; the revoked case is covered separately
            }

            var redeemable = invite.IsRedeemableAt(scenario.Now);
            var effective = invite.EffectiveState(scenario.Now);

            return redeemable
                ? effective == InviteState.Active
                : effective == InviteState.Expired;
        });

    // Feature: squads-and-membership, Property 25: Redemption succeeds only for a redeemable invite -
    // IsRedeemableAt and EffectiveState are consistent across all stored states and instants: the
    // invite is redeemable at an instant exactly when its effective state at that instant is Active.
    // Validates: Requirements 9.2, 11.1, 11.2, 11.5, 12.2, 12.3
    [Property(MaxTest = 100)]
    [Trait("Property", "25")]
    public Property RedeemableIffEffectiveStateActive() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var invite = Build(scenario);

            return invite.IsRedeemableAt(scenario.Now)
                == (invite.EffectiveState(scenario.Now) == InviteState.Active);
        });

    private sealed record Scenario(bool Revoked, DateTimeOffset Now, DateTimeOffset? ExpiresAt);

    /// <summary>Builds the invite in the scenario's stored state (Active, or Revoked when flagged).</summary>
    private static Invite Build(Scenario scenario)
    {
        var invite = Invite.Create(Guid.NewGuid(), "hash", scenario.ExpiresAt);
        if (scenario.Revoked)
        {
            invite.Revoke();
        }

        return invite;
    }

    private static Gen<Scenario> ScenarioGen() =>
        from revoked in Gen.Elements(false, true)
        from now in InstantGen()
        from expiresAt in ExpiryGen(now)
        select new Scenario(revoked, now, expiresAt);

    /// <summary>Generates a UTC instant across a wide range of ticks around the epoch.</summary>
    private static Gen<DateTimeOffset> InstantGen() =>
        from ticks in Gen.Choose(0, int.MaxValue)
        select new DateTimeOffset(2000, 1, 1, 0, 0, 0, TimeSpan.Zero).AddSeconds(ticks);

    /// <summary>
    /// Generates an expiry that is null (non-expiring), strictly before, exactly at, or strictly
    /// after <paramref name="now"/>, so the boundary condition around expiry is exercised.
    /// </summary>
    private static Gen<DateTimeOffset?> ExpiryGen(DateTimeOffset now) =>
        Gen.OneOf(
            Gen.Constant<DateTimeOffset?>(null),
            Gen.Constant<DateTimeOffset?>(now),
            from before in Gen.Choose(1, int.MaxValue)
            select (DateTimeOffset?)now.AddSeconds(-before),
            from after in Gen.Choose(1, int.MaxValue)
            select (DateTimeOffset?)now.AddSeconds(after));
}
