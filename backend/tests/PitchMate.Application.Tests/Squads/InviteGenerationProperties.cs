using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based tests for <see cref="GenerateInviteHandler"/> (squads-and-membership design
/// Properties 20, 21, 22, and 24). They drive the real handler against the in-memory squad fakes and a
/// controllable clock (no database), per the Application-layer testing strategy. Each property runs at
/// least 100 iterations. Accompanying unit tests pin the validity-range boundary behaviour
/// (Requirement 10.9).
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class InviteGenerationProperties
{
    /// <summary>A fixed UTC anchor the fake clock reads from unless a property generates its own instant.</summary>
    private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    // Feature: squads-and-membership, Property 20: Invite generation returns the secret once and
    // persists only its hash - on a successful generation the result carries the redeemable link and
    // code minted by the invite secret service (returned exactly once), while the persisted invite
    // carries only the one-way token hash and never the redeemable secret in recoverable form.
    // Validates: Requirements 10.1
    [Property(MaxTest = 200)]
    [Trait("Property", "20")]
    public Property Property20_GenerationReturnsSecretOnceAndPersistsOnlyItsHash() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(true, false)),
            Arb.From(InRangeValidityOrNullGen()),
            (actorIsOwner, validity) =>
            {
                var clock = new SquadFakeClock(Anchor);
                (SquadStore store, Guid squadId, Guid actingUserId) = SeedSquadWithActor(actorIsOwner);
                var secrets = new FakeInviteSecretService();

                GenerateInviteHandler handler = BuildHandler(store, clock, secrets, allowNonExpiring: false);

                Result<GenerateInviteResult> result = handler
                    .HandleAsync(new GenerateInviteCommand(actingUserId, squadId, validity), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                // An active owner or admin with an in-range (or defaulted) validity always succeeds.
                if (!result.IsSuccess)
                {
                    return false.ToProperty();
                }

                InviteSecret secret = secrets.LastGenerated!;
                bool oneInvite = store.Invites.Count == 1;
                Invite persisted = oneInvite ? store.Invites[0] : null!;

                // The redeemable link and code are surfaced once, straight from the secret service.
                bool secretReturnedOnce = secrets.GenerateCallCount == 1
                    && result.Value!.RedeemableLink == secret.RedeemableLink
                    && result.Value!.Code == secret.Code;

                // Only the one-way hash is persisted; the invite never exposes the redeemable secret.
                bool onlyHashPersisted = oneInvite
                    && persisted.TokenHash == secret.TokenHash
                    && persisted.TokenHash != secret.RedeemableLink
                    && persisted.TokenHash != secret.Code;

                return (secretReturnedOnce && onlyHashPersisted && store.SaveCallCount == 1).ToProperty();
            });

    // Feature: squads-and-membership, Property 21: Invite expiry is the clock instant plus the validity
    // period - for an expiring invite generated at clock instant N with validity V (1h..90d), the
    // created invite expires at exactly N + V; when no validity is supplied the default of 7 days
    // applies.
    // Validates: Requirements 10.2
    [Property(MaxTest = 200)]
    [Trait("Property", "21")]
    public Property Property21_InviteExpiryIsClockInstantPlusValidity() =>
        Prop.ForAll(
            Arb.From(NowGen()),
            Arb.From(InRangeValidityOrNullGen()),
            (now, validity) =>
            {
                var clock = new SquadFakeClock(now);
                (SquadStore store, Guid squadId, Guid actingUserId) = SeedSquadWithActor(actorIsOwner: true);

                GenerateInviteHandler handler = BuildHandler(store, clock, new FakeInviteSecretService(), allowNonExpiring: false);

                Result<GenerateInviteResult> result = handler
                    .HandleAsync(new GenerateInviteCommand(actingUserId, squadId, validity), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                TimeSpan effectiveValidity = validity ?? Invite.DefaultValidity;
                DateTimeOffset expectedExpiry = clock.GetUtcNow() + effectiveValidity;

                bool oneInvite = store.Invites.Count == 1;
                bool expiryMatches = oneInvite
                    && store.Invites[0].ExpiresAt == expectedExpiry
                    && result.Value!.ExpiresAt == expectedExpiry;

                return (result.IsSuccess && expiryMatches).ToProperty();
            });

    // Feature: squads-and-membership, Property 22: Non-expiring invites are permitted only by
    // configuration - a non-expiring request succeeds with a null expiry only when configuration allows
    // it; otherwise it alone is rejected with ExpiryRequired and no invite is created. Expiring requests
    // are accepted regardless of the configuration flag.
    // Validates: Requirements 10.3
    [Property(MaxTest = 200)]
    [Trait("Property", "22")]
    public Property Property22_NonExpiringInvitesArePermittedOnlyByConfiguration() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(true, false)),
            Arb.From(Gen.Elements(true, false)),
            Arb.From(InRangeValidityGen()),
            (allowNonExpiring, nonExpiring, validity) =>
            {
                var clock = new SquadFakeClock(Anchor);
                (SquadStore store, Guid squadId, Guid actingUserId) = SeedSquadWithActor(actorIsOwner: true);

                GenerateInviteHandler handler = BuildHandler(store, clock, new FakeInviteSecretService(), allowNonExpiring);

                Result<GenerateInviteResult> result = handler
                    .HandleAsync(new GenerateInviteCommand(actingUserId, squadId, validity, nonExpiring), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                if (nonExpiring && allowNonExpiring)
                {
                    // Permitted non-expiring invite: succeeds with a null expiry.
                    return (result.IsSuccess
                        && store.Invites.Count == 1
                        && store.Invites[0].ExpiresAt is null
                        && result.Value!.ExpiresAt is null
                        && store.SaveCallCount == 1).ToProperty();
                }

                if (nonExpiring)
                {
                    // Forbidden non-expiring invite: rejected with ExpiryRequired, nothing persisted.
                    return (!result.IsSuccess
                        && result.Error!.Code == SquadErrorCode.ExpiryRequired
                        && store.Invites.Count == 0
                        && store.SaveCallCount == 0).ToProperty();
                }

                // Expiring requests are accepted regardless of the non-expiring configuration flag.
                return (result.IsSuccess
                    && store.Invites.Count == 1
                    && store.Invites[0].ExpiresAt is not null
                    && store.SaveCallCount == 1).ToProperty();
            });

    // Feature: squads-and-membership, Property 24: At most 25 active invites per squad - when the squad
    // already holds the maximum number of active invites the generation is rejected with
    // InviteLimitReached and no invite is created; below the cap it succeeds and adds one invite.
    // Validates: Requirements 10.6, 10.10
    [Property(MaxTest = 200)]
    [Trait("Property", "24")]
    public Property Property24_AtMost25ActiveInvitesPerSquad() =>
        Prop.ForAll(
            Arb.From(Gen.Choose(0, 40)),
            existingActive =>
            {
                var clock = new SquadFakeClock(Anchor);
                (SquadStore store, Guid squadId, Guid actingUserId) = SeedSquadWithActor(actorIsOwner: true);

                // Seed the squad with the requested number of active (future-expiring) invites.
                for (int i = 0; i < existingActive; i++)
                {
                    store.AddCommittedInvite(
                        Invite.Create(squadId, $"seed-hash-{i}", clock.GetUtcNow() + TimeSpan.FromDays(30)));
                }

                GenerateInviteHandler handler = BuildHandler(store, clock, new FakeInviteSecretService(), allowNonExpiring: false);

                Result<GenerateInviteResult> result = handler
                    .HandleAsync(new GenerateInviteCommand(actingUserId, squadId), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                bool atOrAboveCap = existingActive >= Invite.MaxActivePerSquad;

                if (atOrAboveCap)
                {
                    // At the cap: rejected, no invite added, no commit.
                    return (!result.IsSuccess
                        && result.Error!.Code == SquadErrorCode.InviteLimitReached
                        && store.Invites.Count == existingActive
                        && store.SaveCallCount == 0).ToProperty();
                }

                // Below the cap: exactly one invite is added and committed.
                return (result.IsSuccess
                    && store.Invites.Count == existingActive + 1
                    && store.SaveCallCount == 1).ToProperty();
            });

    // ----- Unit tests: validity-range boundary behaviour (Requirement 10.9) -----

    [Theory]
    [Trait("Property", "21")]
    [InlineData(0, 59)]      // 59 minutes: below the 1-hour minimum
    [InlineData(91, 0)]      // 91 days: above the 90-day maximum
    public async Task Generation_WithValidityOutsideRange_IsRejectedWithNoInvite(int days, int minutes)
    {
        var clock = new SquadFakeClock(Anchor);
        (SquadStore store, Guid squadId, Guid actingUserId) = SeedSquadWithActor(actorIsOwner: true);
        GenerateInviteHandler handler = BuildHandler(store, clock, new FakeInviteSecretService(), allowNonExpiring: false);

        TimeSpan validity = TimeSpan.FromDays(days) + TimeSpan.FromMinutes(minutes);

        Result<GenerateInviteResult> result = await handler
            .HandleAsync(new GenerateInviteCommand(actingUserId, squadId, validity), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ValidationFailed, result.Error!.Code);
        Assert.Empty(store.Invites);
        Assert.Equal(0, store.SaveCallCount);
    }

    [Fact]
    [Trait("Property", "21")]
    public async Task Generation_WithValidityAtInclusiveBoundaries_Succeeds()
    {
        foreach (TimeSpan validity in new[] { Invite.MinValidity, Invite.MaxValidity })
        {
            var clock = new SquadFakeClock(Anchor);
            (SquadStore store, Guid squadId, Guid actingUserId) = SeedSquadWithActor(actorIsOwner: true);
            GenerateInviteHandler handler = BuildHandler(store, clock, new FakeInviteSecretService(), allowNonExpiring: false);

            Result<GenerateInviteResult> result = await handler
                .HandleAsync(new GenerateInviteCommand(actingUserId, squadId, validity), CancellationToken.None);

            Assert.True(result.IsSuccess);
            Assert.Single(store.Invites);
            Assert.Equal(clock.GetUtcNow() + validity, store.Invites[0].ExpiresAt);
        }
    }

    /// <summary>
    /// Seeds a committed squad with an active owner, and (when <paramref name="actorIsOwner"/> is
    /// <see langword="false"/>) an additional active admin, returning the store plus the squad and the
    /// acting user identity to drive the handler with.
    /// </summary>
    private static (SquadStore store, Guid squadId, Guid actingUserId) SeedSquadWithActor(bool actorIsOwner)
    {
        var store = new SquadStore();
        Squad squad = Squad.Create("The Squad").Value!;
        store.AddCommittedSquad(squad);

        Guid ownerUserId = Guid.NewGuid();
        SquadMembership owner = SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!;
        store.AddCommittedMembership(owner);

        if (actorIsOwner)
        {
            return (store, squad.Id, ownerUserId);
        }

        Guid adminUserId = Guid.NewGuid();
        SquadMembership admin = SquadMembership.CreateRegistered(squad.Id, adminUserId, "Admin").Value!;
        admin.PromoteToAdmin();
        store.AddCommittedMembership(admin);
        return (store, squad.Id, adminUserId);
    }

    /// <summary>Builds the handler over the supplied store, clock, secret service, and non-expiring policy.</summary>
    private static GenerateInviteHandler BuildHandler(
        SquadStore store,
        TimeProvider clock,
        FakeInviteSecretService secrets,
        bool allowNonExpiring) =>
        new(
            new FakeSquadMembershipRepository(store),
            new FakeInviteRepository(store, clock),
            secrets,
            new FakeSquadUnitOfWork(store),
            clock,
            new InviteOptions { AllowNonExpiringInvites = allowNonExpiring });

    /// <summary>An in-range validity period: 1 hour to 90 days inclusive.</summary>
    private static Gen<TimeSpan> InRangeValidityGen() =>
        from seconds in Gen.Choose((int)Invite.MinValidity.TotalSeconds, (int)Invite.MaxValidity.TotalSeconds)
        select TimeSpan.FromSeconds(seconds);

    /// <summary>An in-range validity period or <see langword="null"/> to exercise the 7-day default.</summary>
    private static Gen<TimeSpan?> InRangeValidityOrNullGen() =>
        Gen.OneOf(
            Gen.Constant<TimeSpan?>(null),
            InRangeValidityGen().Select(v => (TimeSpan?)v));

    /// <summary>A UTC clock instant within a bounded window around the anchor.</summary>
    private static Gen<DateTimeOffset> NowGen() =>
        from minutes in Gen.Choose(-5_000_000, 5_000_000)
        select Anchor.AddMinutes(minutes);
}
